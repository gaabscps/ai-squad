---
name: spec-writer
description: Phase 1 entry point. Asks the human which Phases this Session will run (interactive checkbox via AskUserQuestion), then conducts an interactive spec-writing session — drafts a Spec from `templates/spec.md`, refines with the human, gets explicit approval, hands off to the next planned Phase.
---

# Spec Writer — Phase 1 (Specify)

The Skill that turns a feature request into an approved Spec, working interactively with the human. Owns Session creation and `planned_phases` selection.

## When to invoke
- `/spec-writer` — fresh start (creates new Session, generates `task_id` if not given).
- `/spec-writer FEAT-XXX` — resume an existing Spec session.
- `/spec-writer FEAT-XXX --plan="specify,plan,tasks"` — power-user override of the interactive checkbox.

## Refuse when
- Invoked with `--resume` and no Session exists for the given `task_id` → message: `"No Session at .agent-session/<task_id>/. Start fresh with /spec-writer FEAT-XXX (no --resume) or check task_id."`
- (TODO Phase 2: full refusal matrix — concurrent edit lockfile, schema_version mismatch, gitignore missing.)

## Inputs (preconditions)
- Fresh start: none (this Skill creates the Session).
- Resume: existing `.agent-session/<task_id>/session.yml` with `current_phase: specify`.

## Steps
1. Determine `task_id` (from argument or auto-generate `FEAT-XXX`).
2. Check for existing Session at `.agent-session/<task_id>/session.yml` (recovery flow per `docs/concepts/session.md`).
3. If new Session: ask `planned_phases` via `AskUserQuestion` (default all 4 checked, including Implementation):
   ```
   Which Phases will this Session run?
   [x] Specify (always; you are here)
   [x] Plan
   [x] Tasks
   [x] Implementation
   ```
4. Save selection to `session.yml` (atomic write: tmp + rename).
5. (TODO Phase 2: detailed Spec drafting flow — section-by-section, EARS validation, `[NEEDS CLARIFICATION]` cap of 3.)
6. On human approval, set Spec `status: approved` and update `session.yml`.

## Output
- Path: `.agent-session/<task_id>/spec.md` (template at `templates/spec.md`).
- Status field: `draft` → `approved` (no mid-state; either being written or approved).
- Atomic write: tmp + rename.

## Handoff (dynamic, based on planned_phases)
- If `plan` planned next: `"Spec approved. Next: run /designer to start Phase 2 (Plan)."`
- If `plan` skipped, `tasks` planned: `"Spec approved. Plan was not planned. Next: /task-builder."`
- If `plan` and `tasks` skipped, `implementation` planned: `"Spec approved. Plan and Tasks were not planned. Next: /orchestrator."`
- If only `specify` planned: `"Spec approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-XXX."`

## Failure modes
- (TODO Phase 2: human abandons mid-Session, AskUserQuestion timeout, schema_version mismatch, partial spec.md write.)

## Why a Skill (not a Subagent)
Phase 1 has the human in-the-loop refining the Spec. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `docs/concepts/skill-vs-subagent.md`).
