---
name: task-builder
description: Phase 3 entry point. Conducts an interactive task-decomposition session with the human — reads the approved Spec and Plan, proposes a granular task breakdown (with file scope, AC coverage, parallelization markers), refines with the human, writes the approved `tasks.md`. Surfaces a guided next-step message based on `planned_phases`.
---

# Task Builder (skill stub)

> Stub. Full role instructions will be written when the Skills get expanded.

**Phase:** 3 of 4 (Tasks).
**Mode:** interactive (human in-the-loop).
**Inputs:** approved Spec at `.agent-session/<task_id>/spec.md` AND approved Plan at `.agent-session/<task_id>/plan.md` (or auto-derived stub if Plan was not in `planned_phases`).
**Output:** approved Tasks at `.agent-session/<task_id>/tasks.md` (template at `templates/tasks.md`).
**Format:** each task carries `T-XXX` ID, optional `[P]` parallelization marker, `[US-XXX]` user story reference, `Files:` (becomes `scope_files` in Work Packets), `AC covered:` (becomes `ac_scope` in Work Packets). Style inspired by GitHub Spec Kit's tasks template.

## On entry

1. Verify Session exists at `.agent-session/<task_id>/` (recovery flow per `docs/concepts/session.md`).
2. Verify `tasks` is in the Session's `planned_phases`. If not, refuse with: `"Tasks was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
3. Verify Spec is `status: approved`. If Plan was planned, verify Plan is `status: approved` too.
4. Begin interactive Tasks drafting.

## Handoff (after Tasks status: approved)

The guided next-step message depends on `planned_phases`:

- If Implementation is planned next: `"Tasks approved. Next: run /orchestrator to start Phase 4 (autonomous Implementation)."`
- If Implementation is not planned: `"Tasks approved. Implementation was not planned for this Session — Session is now paused. To execute later: /orchestrator FEAT-XXX --resume. To clean up without executing: /ship FEAT-XXX."`

## Why a Skill (not a Subagent)

Phase 3 has the human in-the-loop reviewing decomposition. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents".
