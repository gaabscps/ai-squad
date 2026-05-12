---
name: designer
description: Phase 2 entry point. Interactive design session — reads approved Spec, proposes architecture decisions, writes approved `plan.md`.
---

# Designer — Phase 2 (Plan)

The Skill that turns an approved Spec into an approved Plan: architecture, data model, API/contracts, UX surface, risks. Interactive with the human.

## When to invoke
- `/designer` — after Spec approved and `plan` is in `planned_phases` (auto-detects `task_id` from current Session).
- `/designer FEAT-NNN` — explicit `task_id`.
- `/designer FEAT-NNN --rewrite` — discard existing Plan and start over (only allowed if Plan is `status: approved`).

## Refuse when
- `plan` not in `planned_phases` → message: `"Plan was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec is not `status: approved` → message: `"Spec must be approved before /designer. Run /spec-writer FEAT-NNN to finish it."`
- Spec has unresolved `[NEEDS CLARIFICATION]` items → message: `"Spec has open clarifications. Resolve them before /designer."`
- Existing Plan is `status: approved` and `--rewrite` not passed → message: `"Plan already approved. Use --rewrite to start over (discards existing Plan)."`
- `session.yml.schema_version` higher than this Skill knows → message: `"Session schema_version <N> newer than this Skill's <M>. Upgrade ai-squad."`

## Inputs (preconditions)
- `.agent-session/<task_id>/session.yml` with `plan` in `planned_phases`.
- `.agent-session/<task_id>/spec.md` with `status: approved` and zero `[NEEDS CLARIFICATION]`.

## Steps

### 1. Resolve Session and Spec
1. Determine `task_id` (explicit arg or current Session from `session.yml`).
2. Read approved Spec; extract the full set of `AC-XXX` IDs from all User Stories — this is the **AC universe** the Plan must cover.

### 2. Generate first draft (Hybrid drafting — Spec Kit/Kiro pattern)
Produce a full draft of `plan.md` from `squads/sdd/templates/plan.md`, populated from the Spec:
- Fill Architecture decisions, Data model, API surface (and UX surface if Spec has visual surface) with the most defensible choice given the Spec and `project_context`.
- **Tag every decision inline with the AC IDs it covers** — `Decision X — uses REST over gRPC (covers: AC-001, AC-003).` (Kiro forward-traceability pattern.)
- For uncertain decisions: insert `[NEEDS CLARIFICATION] <specific question>` markers (cap: 3).
- **Auto-populate Risks** by fixed categories (STRIDE + ATAM lineage): `Security`, `Performance`, `Migration / data`, `Backwards compatibility`, `Regulatory / compliance`. Derive at least one concrete risk per category from Spec content; if none applies, write `(none — <one-line reason>)` to make the consideration explicit.
- Generate the **AC Coverage Map** section at the end of the Plan: every AC → Plan section(s) that cover it.
- Write to `.agent-session/<task_id>/plan.md` (atomic write; `status: draft`).

### 3. Record alternatives (MADR-style, post-hoc — not interactive)
For any decision where alternatives were considered, append to `## Notes` using MADR format:
- `Decision: <chosen>` — `Alternatives considered: <X (rejected because Y)>, <Z (rejected because W)>.`
- **Do NOT prompt the human at branching points.** Spec Kit + Kiro + Nygard ADR converge on commit-then-document; interactive choice at every fork creates friction without quality gain.

### 4. Clarification pass (one ambiguity at a time)
For each `[NEEDS CLARIFICATION]` (cap of 3, same convention as spec-writer):
- Use `AskUserQuestion` with 2-3 enumerable resolution options + an "Other" free-form fallback.
- On answer: replace marker with resolved text; atomic write `plan.md`; recompute AC Coverage Map.
- When all resolved: proceed to step 5.

### 5. Section-by-section refinement (only when the human asks)
- Enumerable decision ("swap REST for gRPC?", "Postgres or DynamoDB?") → `AskUserQuestion`.
- Generative refinement (rewrite a Risk's mitigation, expand a Data model entity) → free-form chat.
- After every accepted change to a major section: atomic write of full `plan.md` AND auto-recompute AC Coverage Map.

### 6. AC coverage gate (designer-specific hard gate)
Before approval: every AC in the Spec MUST be covered by at least one Plan section (per inline tags + final matrix). If gaps exist:

**PM-mode branch (when `session.yml.auto_approved_by == "pm"`):** insert a `[NEEDS CLARIFICATION]` marker into `plan.md` (atomic tmp + rename) naming every uncovered AC before exiting this step. Example marker: `[NEEDS CLARIFICATION] AC coverage gap: AC-007, AC-012 not covered by any Plan decision. Add a decision or move to Decisions deferred to Implementation with a one-line reason.` Then proceed to Step 6.5 — the bypass step will detect the marker and refuse autonomous approval.

**Interactive branch (normal run):** print the uncovered ACs. Refuse to proceed to approval until the human either (a) adds a Plan decision that covers them, or (b) explicitly moves them to `## Decisions deferred to Implementation` with a one-line reason.

### 6.5. PM-mode approval gate check (bypass — runs before Step 7)

> Canonical source of truth: `shared/concepts/pm-bypass.md` — the logic below is the verbatim insertion mandated for `designer`.

```
1. Read session.yml.auto_approved_by.
2. IF auto_approved_by != "pm"  (strict equality, case-sensitive, must be string)
      → Proceed to the normal interactive AskUserQuestion approval gate (Step 7). Stop here.

3. Scan the artifact for any [NEEDS CLARIFICATION] markers.
   IF one or more markers remain:
      → REFUSE bypass. Do NOT approve.
      → Attempt to append to session.yml.notes (atomic tmp + rename):
           - kind: pm_escalation
             timestamp: <ISO8601-now>
             phase: "plan"
             artifact_path: ".agent-session/<task_id>/plan.md"
             open_questions: [<one entry per NEEDS CLARIFICATION block>]
        If the append fails, retry exactly once. If the second attempt
        also fails, raise (do NOT swallow the error silently) — the
        PM persona must be informed that the escalation record could
        not be persisted.
      → Surface to PM persona: "Approval blocked — open questions must be resolved before autonomous approval."
      → Exit the bypass step; leave artifact status unchanged.

4. No markers remain. Approve the artifact in this exact order:

   Ordering invariant: evidence MUST land in session.yml before the
   artifact is marked approved. This ensures that if the artifact write
   fails, the audit trail is still present and no ghost-approval exists.

   a. Check for re-entry / partial-write repair:
      - IF session.yml already contains phase_history.plan.approved_by == "pm"
        AND plan.md frontmatter status == "approved":
          REFUSE (raise). A phase that has already been PM-approved AND
          whose artifact is already marked approved MUST NOT be re-approved
          silently; the PM session should not re-run an already-approved phase.
      - IF session.yml already contains phase_history.plan.approved_by == "pm"
        AND plan.md frontmatter status != "approved":
          Partial-write repair path. A previous run crashed after writing
          session.yml (step 4.b) but before writing plan.md (step 4.c).
          Do NOT raise. Skip step 4.b (session.yml already has the evidence).
          Proceed directly to step 4.c to complete the idempotent artifact
          write, then continue to step 4.d.
      - IF session.yml does NOT contain phase_history.plan.approved_by:
          Continue to step 4.b (normal path).

   b. Perform a single atomic read-modify-write on session.yml (one
      tmp + rename) that writes ALL of the following keys together:
        - phase_history.plan.approved_by: "pm"
        - notes: append the pm_decision entry below
        - current_phase: advance to the next phase per planned_phases
      If session.yml.notes is absent, initialize it as an empty list
      before appending. This single atomic mutation guarantees that
      phase_history, the pm_decision evidence, and current_phase are
      always consistent — there is no partial-write window where one
      exists without the other, which would trigger a false AC-017
      audit violation.

   c. Write status: approved to the artifact's frontmatter (plan.md).

   d. Skip the AskUserQuestion approval gate entirely (do not execute Step 7).
   e. Continue to the Handoff step.
```

**`pm_decision` entry shape** (appended to `session.yml.notes`):

```yaml
- kind: pm_decision
  timestamp: "2026-05-11T05:42:00Z"   # ISO8601, UTC
  phase: "plan"
  artifact_path: ".agent-session/<task_id>/plan.md"
  gate_applied: "auto_approved_by=pm"
```

**Phase-specific notes for designer:**
- `[NEEDS CLARIFICATION]` marker ownership: designer MUST insert the marker into `plan.md` in Step 6 (AC coverage gate) — BEFORE reaching Step 6.5. The scan in step 3 above is the audit check — not the producer of the marker. AC coverage gaps are detected and marked in Step 6; the bypass step only verifies absence.
- `phase` value in `pm_decision`: `"plan"`.
- `artifact_path`: `.agent-session/<task_id>/plan.md`.

### 7. Final approval gate (Hybrid: checklist + AskUserQuestion — Kiro/Spec Kit pattern)
1. Print visual checklist summary:
   ```
   Plan ready for approval:
   [x] Architecture decisions: N
   [x] Data model entities: N
   [x] API surface: N endpoints (or none)
   [x] UX surface: N screens (or none — backend-only)
   [x] Risks: 5/5 categories addressed (security, perf, migration, compat, regulatory)
   [x] AC Coverage: N/N ACs covered (zero gaps)
   [x] Alternatives recorded in Notes: N decisions
   [x] Zero NEEDS CLARIFICATION items
   ```
2. `AskUserQuestion` binary (Kiro mandate — explicit affirmative required):
   ```
   Approve this Plan?
   [ ] Yes, approve and proceed
   [ ] No, more changes needed
   ```
3. On `Yes`: set `status: approved` in `plan.md` frontmatter (atomic write); update `session.yml` (`current_phase` advances per `planned_phases`); populate `phase_history.plan`.
4. On `No`: return to step 5.

## Output
- Path: `.agent-session/<task_id>/plan.md` (template at `squads/sdd/templates/plan.md`).
- Status field: `draft` → `approved` (no `in-progress` mid-state).
- Atomic write: tmp + rename, on every accepted section change AND on final approval.
- Required sections at approval: Architecture, Data model, API surface, UX (if applicable), Risks (5 categories), AC Coverage Map. Notes optional but holds MADR alternatives.

## Handoff (auto-advance when next Phase is planned)
After approval, check `planned_phases` and **auto-invoke the next Skill** — the human's approval IS the gate; no second manual step needed.
- If `tasks` planned next: print `"Plan approved. Advancing to Phase 3 (Tasks)..."` → invoke `/task-builder`.
- If `tasks` skipped but `implementation` planned: print `"Plan approved. Tasks was not planned. Advancing to Phase 4 (Implementation)..."` → invoke `/orchestrator`.
- If neither planned: `"Plan approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-NNN."`

## Failure modes
- **Human abandons mid-Session:** state on disk reflects last atomic write (per-section). Next `/designer FEAT-NNN` resumes from there.
- **AskUserQuestion timeout / no answer:** Session paused; no state change. Next `/designer FEAT-NNN` re-prompts the same question.
- **Partial `plan.md` write:** atomic write (tmp + rename) makes this impossible.
- **Spec edited externally during design:** designer is read-only on Spec. On next refinement turn, mtime check; if Spec changed, warn: `"Spec changed since draft. Re-read and regenerate AC Coverage Map?"`.
- **More than 3 `[NEEDS CLARIFICATION]` would emerge:** spec-writer convention applies — ask the human to pick the 3 most important; the rest go to `## Decisions deferred to Implementation`.
- **AC coverage gap at approval gate:** refuse approval, list gaps, return to step 5 or 6.
- **Architecture decisions conflict during refinement** (e.g., two decisions cover the same AC differently): chat-flag the conflict; let human resolve; re-tag affected ACs in both decisions.

## Why a Skill (not a Subagent)
Phase 2 has the human in-the-loop refining design decisions. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `shared/concepts/skill-vs-subagent.md`).
