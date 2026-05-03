---
name: designer
description: Phase 2 entry point. Conducts an interactive design session with the human — reads the approved Spec, proposes architecture / UX / system design decisions, refines them with the human, and writes the approved `plan.md`. Surfaces a guided next-step message based on `planned_phases`.
---

# Designer (skill stub)

> Stub. Full role instructions will be written when the Skills get expanded.

**Phase:** 2 of 4 (Plan).
**Mode:** interactive (human in-the-loop).
**Inputs:** approved Spec at `.agent-session/<task_id>/spec.md`.
**Output:** approved Plan at `.agent-session/<task_id>/plan.md` (template at `templates/plan.md`).

## On entry

1. Verify Session exists at `.agent-session/<task_id>/` (recovery flow per `docs/concepts/session.md`).
2. Verify `plan` is in the Session's `planned_phases`. If not, refuse with: `"Plan was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
3. Verify Spec is `status: approved` and has no `[NEEDS CLARIFICATION]` items remaining.
4. Begin interactive Plan drafting.

## Handoff (after Plan status: approved)

The guided next-step message depends on `planned_phases`:

- If Tasks is planned next: `"Plan approved. Next: run /task-builder to start Phase 3 (Tasks)."`
- If Tasks is skipped but Implementation is planned: `"Plan approved. Tasks was not planned. Next: /orchestrator."`
- If neither is planned: `"Plan approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-XXX."`

## Why a Skill (not a Subagent)

Phase 2 has the human in-the-loop refining design decisions. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `docs/concepts/skill-vs-subagent.md`).
