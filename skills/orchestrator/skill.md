---
name: orchestrator
description: Phase 4 entry point. Reads approved Spec + Plan + Tasks (any may be absent if not in planned_phases), manages session state, dispatches Subagents (dev → code-reviewer ‖ logic-reviewer → qa, with fan-out per task), enforces per-task loop caps, emits a single human-readable handoff at the end. Routes to blocker-specialist on escalation. Supports --resume from paused or escalated state.
---

# Orchestrator (skill stub)

> Stub. Full role instructions will be written when the Skills get expanded.

**Phase:** 4 of 4 (Implementation).
**Mode:** autonomous (human absent until handoff).

## Inputs

- Approved Spec at `.agent-session/<task_id>/spec.md` (always required)
- Approved Plan at `.agent-session/<task_id>/plan.md` (if Phase 2 was in `planned_phases`)
- Approved Tasks at `.agent-session/<task_id>/tasks.md` (if Phase 3 was in `planned_phases`)

If Plan or Tasks were not planned, orchestrator auto-derives a minimal structure from the Spec.

## Invocation modes

- `/orchestrator FEAT-XXX` — fresh start of Phase 4 (Session must be in `tasks` or `plan` or `specify` phase with Implementation in `planned_phases`).
- `/orchestrator FEAT-XXX --resume` — resume from `paused` (planned but not yet started) OR from `escalated` (resume after human resolved blockers; per-task state preserved). Default behavior when re-invoked on existing Session.
- `/orchestrator FEAT-XXX --restart` — wipes `.agent-session/<task_id>/inputs/` and `outputs/` (preserves spec.md/plan.md/tasks.md). Starts Phase 4 from scratch. Used when human's edits invalidated prior work.

## Dispatches

Subagents (in `agents/`): `dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`.

## Why a Skill (not a Subagent)

Subagents in Claude Code cannot spawn other Subagents. The orchestrator must run in the main session to dispatch the workers.

## Handoff (end of Phase 4)

Emits a Markdown summary message (uniform success, mixed status, or full escalate per `docs/concepts/pipeline.md`) and instructs:

```
Implementation done. When ready, run /ship FEAT-XXX to clean up the session.
```

For mixed status (some tasks pending_human):

```
Partial completion. <N> tasks done, <M> tasks awaiting human decision (see details above).
After resolving the blockers and editing artifacts, choose:
  /orchestrator FEAT-XXX --resume  (default — preserves done tasks)
  /orchestrator FEAT-XXX --restart (only if prior work is invalidated)
```

## Refusal conditions

- Refuses if Implementation is not in `planned_phases` (with helpful message: edit session.yml or restart).
- Refuses if Spec is not `status: approved`.
- Refuses if Plan is in `planned_phases` but Plan is not `status: approved` (same for Tasks).
