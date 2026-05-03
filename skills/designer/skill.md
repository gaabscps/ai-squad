---
name: designer
description: Phase 2 entry point. Conducts an interactive design session with the human — reads the approved Spec, proposes architecture / UX / system design decisions, refines them with the human, and writes the approved `plan.md`. Surfaces a guided next-step message based on `planned_phases`.
---

# Designer — Phase 2 (Plan)

The Skill that turns an approved Spec into an approved Plan: architecture, data model, API/contracts, UX surface, risks. Interactive with the human.

## When to invoke
- `/designer` — after Spec approved and `plan` is in `planned_phases`.
- `/designer FEAT-XXX` — explicit `task_id` (otherwise inferred from current Session).

## Refuse when
- `plan` not in `planned_phases` → message: `"Plan was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec is not `status: approved` → message: `"Spec must be approved before /designer. Run /spec-writer FEAT-XXX to finish it."`
- Spec has unresolved `[NEEDS CLARIFICATION]` items → message: `"Spec has open clarifications. Resolve them before /designer."`

## Inputs (preconditions)
- `.agent-session/<task_id>/session.yml` with `plan` in `planned_phases`.
- `.agent-session/<task_id>/spec.md` with `status: approved` and zero `[NEEDS CLARIFICATION]` items.

## Steps
1. Verify Session and `planned_phases` (refusal conditions above).
2. Read approved Spec.
3. (TODO Phase 2: detailed Plan drafting flow — architecture options, data model, API surface, UX surface, risks; one section at a time with the human.)
4. On human approval, set Plan `status: approved` and update `session.yml`.

## Output
- Path: `.agent-session/<task_id>/plan.md` (template at `templates/plan.md`).
- Status field: `draft` → `approved`.
- Atomic write: tmp + rename.

## Handoff (dynamic, based on planned_phases)
- If `tasks` planned next: `"Plan approved. Next: run /task-builder to start Phase 3 (Tasks)."`
- If `tasks` skipped but `implementation` planned: `"Plan approved. Tasks was not planned. Next: /orchestrator."`
- If neither planned: `"Plan approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-XXX."`

## Failure modes
- (TODO Phase 2: human abandons mid-Session, partial plan.md write, design contradicts Spec.)

## Why a Skill (not a Subagent)
Phase 2 has the human in-the-loop refining design decisions. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `docs/concepts/skill-vs-subagent.md`).
