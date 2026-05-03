---
name: spec-writer
description: Phase 1 entry point. Asks the human which Phases this Session will run (interactive checkbox via AskUserQuestion), then conducts an interactive spec-writing session — drafts a Spec from `squads/sdd/templates/spec.md`, refines with the human, gets explicit approval, hands off to the next planned Phase.
---

# Spec Writer — Phase 1 (Specify)

The Skill that turns a feature request into an approved Spec, working interactively with the human. Owns Session creation, `task_id` generation, and `planned_phases` selection.

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

### 2. Plan the Phases (fresh start only)
Use `AskUserQuestion` with checkbox. Default all 4 checked, including Implementation:
```
Which Phases will this Session run?
[x] Specify (always; you are here)
[x] Plan
[x] Tasks
[x] Implementation
```
Save selection to `session.yml.planned_phases` (atomic write: tmp + rename). Power-user flag `--plan="specify,plan,tasks"` bypasses the prompt with the same selection semantics.

### 3. Capture initial pitch (if not provided)
If the human didn't pass a pitch in the invocation, ask in chat (free-form, generative — not `AskUserQuestion`): `"What's the feature? One paragraph — problem, who it's for, what success looks like."`

### 4. Generate first draft (Hybrid drafting — Spec Kit style)
Produce a full draft of `spec.md` from `squads/sdd/templates/spec.md`, populated from the pitch:
- Fill all sections you can confidently infer (Problem, Goal, Constraints, Notes).
- For uncertain sections: insert `[NEEDS CLARIFICATION] <specific question>` markers (hard cap: 3 — see step 5).
- Generate at least one `US-001 [P1]` from the pitch.
- Write to `.agent-session/<task_id>/spec.md` (atomic write; `status: draft`).
- Save Spec title to `session.yml.feature_name` for human-readable reference.

### 5. Clarification pass (one ambiguity at a time)
For each `[NEEDS CLARIFICATION]` (max 3 — if more would emerge, ask the human to pick the 3 most important; the rest become `## Open Questions` entries):
- Use `AskUserQuestion` with 2-3 enumerable resolution options + an "Other" free-form fallback.
- On answer: replace the marker with the resolved text; atomic write `spec.md`.
- When all resolved: proceed to step 6.

### 6. Section-by-section refinement (only when the human asks)
The human may want to refine any section. Conventions for picking the right tool:
- Enumerable decision (priority P1/P2/P3, "Add another US?" yes/no, pick from 2-3 options) → `AskUserQuestion`.
- Generative decision (rewrite a US's prose, refine a Constraint's wording) → free-form chat.
- After every accepted change to a major section (Problem, Goal, any US, NFR, SC): atomic write of the full `spec.md`.

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

## Handoff (dynamic, based on planned_phases)
- If `plan` planned next: `"Spec approved. Next: run /designer to start Phase 2 (Plan)."`
- If `plan` skipped, `tasks` planned: `"Spec approved. Plan was not planned. Next: /task-builder."`
- If `plan` and `tasks` skipped, `implementation` planned: `"Spec approved. Plan and Tasks were not planned. Next: /orchestrator."`
- If only `specify` planned: `"Spec approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-NNN."`

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
