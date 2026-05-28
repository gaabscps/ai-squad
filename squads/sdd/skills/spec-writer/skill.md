---
name: spec-writer
description: Phase 1 entry point. Interactive spec-writing session — selects planned_phases, drafts and approves Spec, hands off to next Phase.
---

# Spec Writer — Phase 1 (Specify)

The Skill that turns a feature request into an approved Spec, working interactively with the human. Owns Session creation, `task_id` generation, and `planned_phases` selection.

## Hard rule — fresh-start mode is ALWAYS interactive (read this BEFORE step 1)

**This Skill NEVER infers `auto_approved_by: pm`, `pipeline_mode`, or `planned_phases` from prior `.agent-session/FEAT-XXX/session.yml` files.** Period.

- PM bypass (`auto_approved_by=pm`) is set EXCLUSIVELY by the `/pm` Skill when IT invokes this Skill in the same turn. If you are reading this in response to a direct `/spec-writer` user invocation, PM bypass is **OFF**, regardless of what any prior Session in `.agent-session/` looks like.
- Reading prior `session.yml` files is allowed ONLY for one purpose: computing the next `FEAT-NNN` increment (step 1). Any other field — `auto_approved_by`, `pipeline_mode`, `planned_phases`, `phase_history`, `notes` — MUST NOT influence the current Session's behavior.
- If you find yourself reasoning "the last 3 Sessions in this repo had `auto_approved_by: pm`, so I'll do the same" — STOP. That reasoning is forbidden. The user's intent for *this* invocation is the only authority. Run `AskUserQuestion` for steps 2 and 2.5 regardless.
- A human running `/spec-writer` directly expects to be asked questions. Skipping them silently breaks trust and removes their control over scope. There is no shortcut here, even if a prior Session looked "similar".

This rule supersedes any pattern-matching the model performs on the repo history. Treat it as a precondition for entering step 1.

## When to invoke
- `/spec-writer` — fresh start (creates new Session, auto-generates `task_id`).
- `/spec-writer "<feature pitch>"` — fresh start with the human's pitch as first input.
- `/spec-writer FEAT-NNN` — resume an existing Spec session.
- `/spec-writer FEAT-NNN --plan="specify,plan,tasks"` — power-user flag override of the interactive checkbox.

## Refuse when
- Invoked with `FEAT-NNN` and no Session exists at `.agent-session/<task_id>/` → message: `"No Session at .agent-session/<task_id>/. Start fresh with /spec-writer (no task_id)."`
- Existing Session is in terminal state (`current_phase: paused | done | escalated`) → message: `"Session <task_id> is <state>. Run /ship FEAT-NNN to clean up, or /orchestrator FEAT-NNN --resume to continue Phase 4."`
- `.agent-session/` exists but is NOT in repo's `.gitignore` → message: `"`.agent-session/` must be gitignored. Add it to .gitignore before continuing."`
- `session.yml` has `schema_version` higher than what this Skill knows → message: `"Session schema_version <N> is newer than this Skill's <M>. Upgrade ai-squad before continuing."`

## Inputs (preconditions)
- Fresh start: none (this Skill creates the Session).
- Resume: existing `.agent-session/<task_id>/session.yml` with `current_phase: specify`.

## Steps

### 1. Resolve `task_id` and Session
1. If invoked with explicit `FEAT-NNN`: use it; check Session existence (resume vs refuse per matrix).
2. If no explicit `task_id`: scan `.agent-session/FEAT-*/` directories, increment from highest existing → new `FEAT-NNN` (3-digit zero-padded; expand to 4 digits past `FEAT-999`).
3. Verify `.agent-session/` is in `.gitignore` (refuse if not).
4. **Read constraint (per the top-of-file Hard rule):** when scanning prior `FEAT-*/` directories for step 2 above, the ONLY field you may read from any prior `session.yml` is the directory/file name itself for ID computation. Do NOT open prior `session.yml` content. Do NOT inspect `auto_approved_by`, `pipeline_mode`, `planned_phases`, `phase_history`, or `notes` from any prior Session. Treat prior `.agent-session/FEAT-*/` directories as opaque ID markers, nothing else. If you need any other state from a prior Session, that's a `--resume` flow (item 1 above) on that specific FEAT-ID — never an inference from history.

### 2. Plan the Phases (fresh start only)

**MANDATORY — runs on every fresh-start invocation. NEVER skipped by PM bypass.** `planned_phases` is user intent about which Phases will run, NOT an automatable inference. PM bypass (`auto_approved_by=pm`, detected at step 6.5) governs APPROVAL gates only (steps 6.5 and 7) — it does NOT cover intent collection. If you find yourself about to auto-pick `planned_phases` because a previous Session in `.agent-session/` did it that way: STOP and run `AskUserQuestion` regardless. The user may want a different shape this time.

Use `AskUserQuestion` with checkbox. **Default = planning only (Specify + Plan + Tasks); Implementation UNCHECKED by default** — recommended path is to run Implementation in a separate session via `/orchestrator FEAT-NNN --resume` for (a) clean per-phase cost attribution in `report.html`, and (b) structural prevention of PM-mode inference from planning history (a recurring bug class — see commits `4a06ff9`, `d91c0a4`).

```
Which Phases will this Session run? (Recommended: leave Implementation UNCHECKED and run it in a fresh `--resume` session.)
[x] Specify (always; you are here)
[x] Plan
[x] Tasks
[ ] Implementation  — opt-in only; checking this runs everything in this session and gives an APPROXIMATE planning/orchestration cost split (timestamp-bracketed, not session-isolated).
```

Save selection to `session.yml.planned_phases` (atomic write: tmp + rename). Power-user flag `--plan="specify,plan,tasks,implementation"` bypasses the prompt with explicit semantics (use it to opt into single-session implementation).

### 2.5. Pipeline mode selection (fresh start only)

**MANDATORY — runs on every fresh-start invocation. NEVER skipped by PM bypass.** `pipeline_mode` is user intent about scope of the change, NOT an inference from "this looks visually medium-sized" or from prior Sessions. PM bypass governs APPROVAL gates only (steps 6.5/7) — intent collection is always interactive. If you find yourself about to auto-pick `standard` because the feature looks non-trivial, or auto-pick from a prior Session's mode: STOP and run `AskUserQuestion` regardless. The user is the only authority on whether this is a `lite` or `standard` change.

Use `AskUserQuestion` (binary):

```
What's the scope of this change?

[ ] Small change (lite mode)
    Fix, small refactor, doc/copy change, or single-purpose feature.
    Downstream effects:
      - task-builder caps total tasks at 2
      - task-builder auto-skips logic-reviewer for single-purpose tasks
      - orchestrator caps fan-out at 1 (sequential tasks)
      - orchestrator clamps tier ceiling to T2 (cheap dispatch by default)
    Quality unchanged: logic-gap sweep, edge-case categories, audit-gate all still mandatory.

[ ] Standard or larger (default)
    All Phases run with full rigor, fan-out, and per-task tier calibration.
```

Save selection to `session.yml.pipeline_mode` (atomic write: tmp + rename). Valid values: `lite`, `standard`. Power-user flag `--mode=lite|standard` bypasses the prompt with the same semantics.

**Recommendation surfaced after the answer:** if `lite` selected and `planned_phases` still includes `plan`, print a short note: `"Lite mode typically skips the Plan Phase. Current planned_phases keeps it — that's fine if you have a real architecture decision to capture; otherwise re-run /spec-writer with --plan='specify,tasks,implementation' to drop it."` Do not auto-mutate `planned_phases`; respect the user's earlier choice.

### 3. Capture initial pitch (if not provided)
If the human didn't pass a pitch in the invocation, ask in chat (free-form, generative — not `AskUserQuestion`): `"What's the feature? One paragraph — problem, who it's for, what success looks like."`

### 4. Generate first draft (Hybrid drafting — Spec Kit style)
Produce a full draft of `spec.md` from `squads/sdd/templates/spec.md`, populated from the pitch:
- Fill all sections you can confidently infer (Problem, Goal, Constraints, Notes).
- For uncertain sections: insert `[NEEDS CLARIFICATION] <specific question>` markers (hard cap: 3 — see step 5).
- Generate at least one `US-001 [P1]` from the pitch.
- **Lite mode constraint** (`session.yml.pipeline_mode == "lite"`): generate **exactly one** `US-001 [P1]`. If the pitch implies multiple stories, surface this via chat: `"Lite mode allows only one US. The pitch suggests N stories — pick the most important one for this Session, or switch to standard mode."` Standard mode: 1-3 USs as appropriate from the pitch.
- **Edge-case coverage (mandatory):** for every US-XXX with code-touching ACs, enumerate ACs covering all four categories: **empty state**, **error state**, **concurrent action**, **partial failure**. If a category is genuinely N/A for a US, write `AC-NNN: N/A — <one-line reason>` explicitly (silent omission becomes a finding in step 6.7).
- Write to `.agent-session/<task_id>/spec.md` (atomic write; `status: draft`).
- Save Spec title to `session.yml.feature_name` for human-readable reference.

### 5. Clarification pass (one ambiguity at a time)
For each `[NEEDS CLARIFICATION]` (max 3 — if more would emerge, ask the human to pick the 3 most important; the rest become `## Open Questions` entries):
- **Research dispatch trigger:** if the clarification touches **external API integration**, **concurrency / race conditions**, **security mechanisms** (auth, sessions, secrets, crypto), or **data migration**, dispatch an `Explore` agent (single research pass — one dispatch, synthesize, decide; do NOT loop) BEFORE asking the human. Check how Anthropic / Claude Code / industry literature treats the case. The research result becomes evidence in the spec's `## Constraints` or `## Notes` section. Skip this trigger for purely UX/copy/scope questions.
- Use `AskUserQuestion` with 2-3 enumerable resolution options + an "Other" free-form fallback. Options should reflect research findings when applicable.
- On answer: replace the marker with the resolved text; atomic write `spec.md`.
- When all resolved: proceed to step 6.

### 6. Section-by-section refinement (only when the human asks)
The human may want to refine any section. Conventions for picking the right tool:
- Enumerable decision (priority P1/P2/P3, "Add another US?" yes/no, pick from 2-3 options) → `AskUserQuestion`.
- Generative decision (rewrite a US's prose, refine a Constraint's wording) → free-form chat.
- After every accepted change to a major section (Problem, Goal, any US, NFR, SC): atomic write of the full `spec.md`.

### 6.4. Logic-gap sweep (mandatory — runs before 6.5 and 7)

Before any approval path, the spec-writer MUST perform an explicit self-critique sweep. This is the single highest-leverage step for shortening Phase 4 wall-clock: every gap caught here saves a `review_loops_max=3` or `qa_loops_max=2` cascade downstream.

Answer each item literally (do not skip):

1. **What would reviewer / QA flag?** Imagine the `code-reviewer`, `logic-reviewer`, and `qa` subagents reading this spec. What ambiguities, missing ACs, or under-specified edge cases would they cite? List concretely.
2. **Edge-case coverage** — confirm every US-XXX with code-touching ACs has ACs for **empty / error / concurrent / partial-failure** OR explicit `N/A — <reason>`.
3. **Out of Scope explicit** — anything a reasonable reviewer might assume is in scope but is NOT must be named. Silent exclusion is a gap.
4. **Non-functional constraints** — perf, security, compliance, observability called out where applicable. "Fast" / "secure" / "scalable" without a measurable definition is a gap.
5. **Term definitions** — every domain term used in ACs must be defined (in `## Notes` or inline). Undefined terms cause downstream agents to guess.

If the sweep finds gaps: patch `spec.md` inline (atomic write), re-run the sweep until zero gaps remain. Gaps are RESOLVED in the spec, never deferred to follow-ups. Only after zero gaps remain proceed to step 6.5 (PM mode) or step 7 (human mode).

### 6.5. PM-mode approval gate check (bypass — runs before Step 7)

Canonical source of truth: `shared/concepts/pm-bypass.md` — the logic below is the verbatim insertion mandated for `spec-writer`.

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
             phase: "specify"
             artifact_path: ".agent-session/<task_id>/spec.md"
             open_questions: [<one entry per NEEDS CLARIFICATION block>]
        If the append fails, retry exactly once. If the second attempt
        also fails, raise (do NOT swallow the error silently) — the
        PM persona must be informed that the escalation record could
        not be persisted.
      → Surface to PM persona: "Approval blocked — open questions must be resolved before autonomous approval."
      → Exit the bypass step; leave artifact status unchanged.

4. No markers remain. Approve the artifact in this exact order:

   **Ordering invariant:** evidence MUST land in session.yml before the
   artifact is marked approved. This ensures that if the artifact write
   fails, the audit trail is still present and no ghost-approval exists.

   a. Check for re-entry / partial-write repair:
      - IF session.yml already contains phase_history.specify.approved_by == "pm"
        AND spec.md frontmatter status == "approved":
          REFUSE (raise). A phase that has already been PM-approved AND
          whose artifact is already marked approved MUST NOT be re-approved
          silently; the PM session should not re-run an already-approved phase.
      - IF session.yml already contains phase_history.specify.approved_by == "pm"
        AND spec.md frontmatter status != "approved":
          **Partial-write repair path.** A previous run crashed after writing
          session.yml (step 4.b) but before writing spec.md (step 4.c).
          Do NOT raise. Skip steps 4.b and 4.b'' (session.yml already has the
          evidence). Proceed directly to step 4.c to complete the idempotent
          artifact write, then continue to step 4.d.
      - IF session.yml does NOT contain phase_history.specify.approved_by:
          Continue to step 4.b (normal path).

   b. Perform a single atomic read-modify-write on session.yml (one
      tmp + rename) that writes ALL of the following keys together:
        - phase_history.specify.approved_by: "pm"
        - notes: append the pm_decision entry below
        - current_phase: advance to the next phase per session.yml.planned_phases
      If session.yml.notes is absent, initialize it as an empty list
      before appending. This single atomic mutation guarantees that
      phase_history, the pm_decision evidence, and current_phase are
      always consistent — there is no partial-write window where one
      exists without the others, which would trigger a false AC-017
      audit violation.

      **current_phase advancement rule (step 4.b''):** read
      session.yml.planned_phases (ordered list); find "specify"; set
      current_phase to the next entry. If "specify" is the last planned
      phase, set current_phase to "done".

   c. Write status: approved to the artifact's frontmatter (spec.md).

   d. Skip the AskUserQuestion approval gate entirely (do not execute Step 7).
   e. Continue to the next step in the Skill's run procedure.
```

**`pm_decision` entry shape** (appended to `session.yml.notes`):

```yaml
- kind: pm_decision
  timestamp: "<ISO8601-timestamp>"     # ISO8601, UTC
  phase: "specify"
  artifact_path: ".agent-session/<task_id>/spec.md"
  gate_applied: "auto_approved_by=pm"
```

**Phase-specific notes for spec-writer:**
- `[NEEDS CLARIFICATION]` marker ownership: spec-writer MUST insert the marker into `spec.md` BEFORE reaching Step 6.5. The scan in step 3 above is the audit check — not the producer of the marker.
- `phase` value in `pm_decision`: `"specify"`.
- `artifact_path`: `.agent-session/<task_id>/spec.md`.

### 7. Final approval gate (Hybrid: checklist + AskUserQuestion)
Trigger when the human signals "done" OR when zero `[NEEDS CLARIFICATION]` markers remain AND at least one `US-XXX` is present:
1. Print a visual checklist summary (Spec Kit pattern):
   ```
   Spec ready for approval:
   [x] Problem stated
   [x] Goal stated
   [x] N User Stories (P1: X, P2: Y, P3: Z)
   [x] N NFRs / N Success Criteria
   [x] Out of Scope explicit
   [x] Zero NEEDS CLARIFICATION items
   ```
2. Use `AskUserQuestion` with binary choice (Kiro pattern — explicit affirmative mandated):
   ```
   Approve this Spec?
   [ ] Yes, approve and proceed
   [ ] No, more changes needed
   ```
3. On `Yes`: set `status: approved` in `spec.md` frontmatter (atomic write); update `session.yml` (`current_phase` advances per `planned_phases`); populate `phase_history.specify`.
4. On `No`: return to step 6.

## Output
- Path: `.agent-session/<task_id>/spec.md` (template at `squads/sdd/templates/spec.md`).
- Status field: `draft` → `approved` (no `in-progress` mid-state).
- Atomic write: tmp + rename, on every accepted section change AND on final approval.
- Session updates: `session.yml.feature_name` populated at step 4; `phase_history.specify` populated at approval; `current_phase` advances at approval.

## Handoff (auto-advance when next Phase is planned)
After approval, check `planned_phases` and **auto-invoke the next Skill** — the human's approval IS the gate; no second manual step needed.
- If `plan` planned next: print `"Spec approved. Advancing to Phase 2 (Plan)..."` → invoke `/designer`.
- If `plan` skipped, `tasks` planned: print `"Spec approved. Plan was not planned. Advancing to Phase 3 (Tasks)..."` → invoke `/task-builder`.
- If `plan` and `tasks` skipped, `implementation` planned: print `"Spec approved. Plan and Tasks were not planned. Advancing to Phase 4 (Implementation)..."` → invoke `/orchestrator`.
- If only `specify` planned: `"Spec approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-NNN."`

## Hard rules

- **Never** infer `auto_approved_by`, `pipeline_mode`, or `planned_phases` from prior `.agent-session/` Sessions. PM bypass is set ONLY by the `/pm` Skill in the same invocation. (See top-of-file Hard rule and step 1 item 4.)
- **Never** auto-set `auto_approved_by: pm` in `session.yml` when this Skill is invoked directly by the user. Only `/pm` writes that field.
- **Never** skip steps 2 (`planned_phases`) and 2.5 (`pipeline_mode`) `AskUserQuestion` prompts on a fresh-start invocation. These are intent collection, not approval — PM bypass does not apply.
- **Always** ask the user via `AskUserQuestion` for `planned_phases` and `pipeline_mode`, even if a prior Session in the same repo answered them differently. Each Session is independent.
- **Always** treat prior `.agent-session/FEAT-*/` directories as opaque ID markers (for `FEAT-NNN` increment only). Their internal state belongs to those Sessions, not this one.
- **Never** open a prior `session.yml` for "context" or "to match the existing pattern". If you find yourself wanting to do this, you have lost; STOP and just ask the user.

## Failure modes
- **Human abandons mid-Session:** state on disk reflects last atomic write (per-section). Next `/spec-writer FEAT-NNN` resumes from there.
- **AskUserQuestion timeout / human answers nothing:** session paused; no state change. Next `/spec-writer FEAT-NNN` re-prompts the same question.
- **Partial `spec.md` write:** atomic write (tmp + rename) makes this impossible — either the previous version or the new version is on disk, never a half-written file.
- **`schema_version` mismatch on resume:** refuse per refusal matrix; human upgrades ai-squad or manually edits `session.yml`.
- **More than 3 `[NEEDS CLARIFICATION]` would emerge during drafting:** spec-writer asks the human to pick the 3 most important via `AskUserQuestion`; remaining items become `## Open Questions` entries (post-approval refinement, not Spec-blocking).
- **Human tries to approve while open `[NEEDS CLARIFICATION]` exist:** refuse the approval gate; list the open items; return to step 5.
- (TODO Phase 2 if needed: concurrent-edit lockfile — only add if real conflict observed in practice.)

## Why a Skill (not a Subagent)
Phase 1 has the human in-the-loop refining the Spec. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `shared/concepts/skill-vs-subagent.md`).
