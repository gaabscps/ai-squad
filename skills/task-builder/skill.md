---
name: task-builder
description: Phase 3 entry point. Conducts an interactive task-decomposition session with the human — reads the approved Spec and Plan, proposes a granular task breakdown (with file scope, AC coverage, parallelization markers), refines with the human, writes the approved `tasks.md`. Surfaces a guided next-step message based on `planned_phases`.
---

# Task Builder — Phase 3 (Tasks)

The Skill that turns an approved Spec + Plan into an approved Tasks list: granular `T-XXX` units with file scope, AC coverage, and `[P]` parallelization markers. Interactive with the human. Style inspired by GitHub Spec Kit's tasks template.

## When to invoke
- `/task-builder` — after Spec+Plan approved and `tasks` is in `planned_phases`.
- `/task-builder FEAT-XXX` — explicit `task_id`.

## Refuse when
- `tasks` not in `planned_phases` → message: `"Tasks was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec not `status: approved` → message: `"Spec must be approved before /task-builder."`
- Plan in `planned_phases` but Plan not `status: approved` → message: `"Plan must be approved before /task-builder. Run /designer FEAT-XXX to finish it."`

## Inputs (preconditions)
- `.agent-session/<task_id>/session.yml` with `tasks` in `planned_phases`.
- `.agent-session/<task_id>/spec.md` (status: approved).
- `.agent-session/<task_id>/plan.md` (status: approved) — IF `plan` is in `planned_phases`. Auto-derived stub if Plan was skipped.

## Steps
1. Verify Session and refusal conditions.
2. Read approved Spec (and Plan if present).
3. (TODO Phase 2: task decomposition heuristics — Spec Kit-style `T-XXX` format, `[P]` marker rules for write-disjoint scope, AC coverage validation.)
4. On human approval, set Tasks `status: approved` and update `session.yml`.

## Output
- Path: `.agent-session/<task_id>/tasks.md` (template at `templates/tasks.md`).
- Format: each task carries `T-XXX` ID, optional `[P]` parallelization marker, `[US-XXX]` user story reference, `Files:` (becomes `scope_files` in Work Packets), `AC covered:` (becomes `ac_scope` in Work Packets).
- Atomic write: tmp + rename.

## Handoff (dynamic, based on planned_phases)
- If `implementation` planned next: `"Tasks approved. Next: run /orchestrator to start Phase 4 (autonomous Implementation)."`
- If `implementation` not planned: `"Tasks approved. Implementation was not planned for this Session — Session is now paused. To execute later: /orchestrator FEAT-XXX --resume. To clean up without executing: /ship FEAT-XXX."`

## Failure modes
- (TODO Phase 2: human abandons mid-Session, `[P]` markers on overlapping `Files:`, AC coverage gaps, `T-XXX` ID collisions.)

## Why a Skill (not a Subagent)
Phase 3 has the human in-the-loop reviewing decomposition. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents".
