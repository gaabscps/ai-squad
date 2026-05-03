---
name: orchestrator
description: Phase 4 entry point. Reads approved Spec + Plan + Tasks (any may be absent if not in planned_phases), manages session state, dispatches Subagents (dev → code-reviewer ‖ logic-reviewer → qa, with fan-out per task), enforces per-task loop caps, emits a single human-readable handoff at the end. Routes to blocker-specialist on escalation. Supports --resume from paused or escalated state.
---

# Orchestrator — Phase 4 (Implementation)

The Skill that runs the autonomous Implementation Pipeline. Dispatches the 5 Subagents (dev, code-reviewer, logic-reviewer, qa, blocker-specialist), enforces caps, emits one handoff. Runs without the human in-the-loop until handoff.

## When to invoke
- `/orchestrator FEAT-XXX` — fresh start of Phase 4 (Tasks must be approved OR auto-derived from Spec/Plan).
- `/orchestrator FEAT-XXX --resume` — resume from `paused` (planned but not started) OR from `escalated` (per-task state preserved). Default behavior when re-invoked on existing Session.
- `/orchestrator FEAT-XXX --restart` — wipes `.agent-session/<task_id>/inputs/` and `outputs/` (preserves spec.md/plan.md/tasks.md). Used when human edits invalidated prior work.

## Refuse when
- `implementation` not in `planned_phases` → message: `"Implementation was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec not `status: approved` → message: `"Spec must be approved before /orchestrator."`
- Plan in `planned_phases` but Plan not `status: approved` → same for Tasks.

## Inputs (preconditions)
- `.agent-session/<task_id>/spec.md` (status: approved) — always required.
- `.agent-session/<task_id>/plan.md` (status: approved) — IF `plan` in `planned_phases`.
- `.agent-session/<task_id>/tasks.md` (status: approved) — IF `tasks` in `planned_phases`.
- If Plan or Tasks were skipped: orchestrator auto-derives a minimal structure from the Spec.

## Steps (per-task pipeline, async across tasks)
1. Read Spec/Plan/Tasks; populate `task_states` map in `session.yml`.
2. For each task in `tasks.md`:
   1. Build Work Packet with `task_id`, `scope_files`, `ac_scope`, `dispatch_id`.
   2. Dispatch `dev` Subagent (fan-out across `[P]` tasks with disjoint `Files:`).
   3. On `dev` Output Packet `status: done`: dispatch `code-reviewer` ‖ `logic-reviewer` in parallel.
   4. If reviewers return findings: loop back to `dev` (cap: `review_loops_max: 3`).
   5. If reviewers conflict on same `file:line`: cascade to `blocker-specialist`.
   6. On reviewers clean: dispatch `qa`.
   7. On `qa` fail: loop to `dev` (cap: `qa_loops_max: 2`, skips reviewers).
   8. On any cap hit OR `status: blocked`: cascade to `blocker-specialist` (cap: `blocker_calls_max: 2`).
3. (TODO Phase 3: progress detection via `last_diff_hash`/`last_findings_hash`, evidence aggregation, `escalation_metrics` computation.)
4. When all tasks reach `done` OR `pending_human`: emit handoff (no further dispatches).

## Output
- Per dispatch: Work Packets at `inputs/<dispatch_id>.json`, Output Packets at `outputs/<dispatch_id>.json`.
- Per task: state machine in `session.yml` (`task_states[T-XXX]`).
- Final: human-readable handoff (Markdown) printed to console, with full evidence trail and `escalation_metrics`.

## Handoff (end of Pipeline — three shapes per `docs/concepts/pipeline.md`)
- **Uniform success** (all tasks `done`): `"Implementation done. When ready, run /ship FEAT-XXX to clean up the session."`
- **Mixed status** (some `pending_human`): `"Partial completion. <N> tasks done, <M> tasks awaiting human decision. After resolving the blockers and editing artifacts, choose: /orchestrator FEAT-XXX --resume (default — preserves done tasks) | /orchestrator FEAT-XXX --restart (only if prior work is invalidated)."`
- **Full escalate** (all tasks `pending_human`): `"Pipeline escalated. All tasks blocked. See decision memos at .agent-session/<task_id>/decisions/ and resolve before /orchestrator FEAT-XXX --resume."`

## Failure modes
- (TODO Phase 3: orchestrator process killed mid-dispatch, Output Packet schema validation failure, Subagent timeout, fan-out `scope_files` collision detection.)

## Why a Skill (not a Subagent)
Subagents in Claude Code cannot spawn other Subagents. The orchestrator must run in the main session to dispatch the workers. Also satisfies "dispatches Subagents" criterion (see `docs/concepts/skill-vs-subagent.md`).
