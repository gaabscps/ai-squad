---
name: orchestrator
description: Phase 4 entry point. Reads approved Spec + Plan + Tasks (any may be absent if not in planned_phases), manages session state, dispatches Subagents (dev → code-reviewer ‖ logic-reviewer → qa, with fan-out per task), enforces per-task loop caps, emits a single human-readable handoff at the end. Routes to blocker-specialist on escalation. Supports --resume from paused or escalated state.
---

# Orchestrator — Phase 4 (Implementation)

The Skill that runs the autonomous Implementation Pipeline. Dispatches the 5 Subagents (dev, code-reviewer, logic-reviewer, qa, blocker-specialist) via Claude Code's `Task` tool, enforces caps, and emits one handoff. Runs without the human in-the-loop until handoff.

**Sole writer invariant:** in Phase 4, the orchestrator is the only Skill that writes `session.yml`. Subagents return Output Packets; the orchestrator reads them, merges state, and atomically rewrites `session.yml` (tmp + rename). This eliminates concurrent-write races without file locks (Buck2's single-coordinator pattern).

## When to invoke
- `/orchestrator FEAT-NNN` — fresh start of Phase 4.
- `/orchestrator FEAT-NNN --resume` — resume from `paused` (planned but not started) OR from `escalated` (per-task state preserved). Default behavior when re-invoked on an existing Session.
- `/orchestrator FEAT-NNN --restart` — wipes `.agent-session/<task_id>/inputs/` and `outputs/` (preserves spec/plan/tasks). Used when human edits invalidated prior work.

## Refuse when
- `implementation` not in `planned_phases` → message: `"Implementation was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec not `status: approved` → message: `"Spec must be approved before /orchestrator."`
- Plan in `planned_phases` but not `status: approved` → message: `"Plan must be approved before /orchestrator."`
- Tasks in `planned_phases` but not `status: approved` → message: `"Tasks must be approved before /orchestrator. Run /task-builder FEAT-NNN to finish them."`
- `session.yml.schema_version` higher than this Skill knows → message: `"Session schema_version <N> newer than this Skill's <M>. Upgrade ai-squad."`

## Inputs (preconditions)
- `.agent-session/<task_id>/spec.md` (status: approved) — always required.
- `.agent-session/<task_id>/plan.md` (status: approved) — IF `plan` in `planned_phases`.
- `.agent-session/<task_id>/tasks.md` (status: approved) — IF `tasks` in `planned_phases`.
- If Plan or Tasks were skipped: orchestrator auto-derives a minimal structure from the Spec (single-task default; flat AC coverage).

## Steps

### 1. Resolve Session and read inputs
1. Determine `task_id` (explicit arg or current Session from `session.yml`).
2. Read approved Spec/Plan/Tasks (auto-derive if Plan/Tasks were skipped per `planned_phases`).
3. Initialize `task_states` map in `session.yml` with one entry per `T-XXX` (state=`pending`, loops=0, hashes=null) — fresh start only; `--resume` preserves existing entries.
4. Set `pipeline_started_at` (or leave intact on `--resume`).

### 2. Build the per-task pipeline graph
For each `T-XXX`:
- Compute the task's edges from `Depends on:` constraints.
- Mark `[P]` tasks as eligible for parallel dispatch within their phase, subject to predecessors being `done`.
- Independent tasks form the **ready queue**; dependent tasks wait until predecessors complete.

### 3. Dispatch loop (capped concurrency = 5, FIFO overflow queue)
While ready queue is non-empty OR any task is in-flight:
- Pull up to **5 concurrent `Task` tool dispatches** from the ready queue. (Anthropic's empirical 3-5 fan-out sweet spot per their multi-agent research blog; well under Claude Code's hard 10-cap; quota-friendly for Max 5x.)
- For each pulled task: build the Work Packet and dispatch via `Task` tool (see "Dispatch contract" below).
- Tasks beyond 5 wait in FIFO queue; queue refills as tasks complete (no fail-fast).
- On each Subagent completion: read its Output Packet, run step 4 (state merge), step 5 (progress check), step 6 (cascade routing if needed). Re-evaluate ready queue.

### 4. Per-task state machine (orchestrator-managed, atomic write)
Each task transitions through: `pending` → `running` → (`done` | `blocked` | `pending_human` | `failed`).

Pipeline per task (per `squads/sdd/docs/concepts/pipeline.md`):
- Dispatch `dev`. On `dev` Output Packet `status: done`: dispatch `code-reviewer` ‖ `logic-reviewer` in parallel (counts against the 5-cap).
- If reviewers return findings: loop to `dev` (cap: `review_loops_max=3`).
- If reviewers conflict on same `file:line`: cascade to `blocker-specialist`.
- On reviewers clean: dispatch `qa`.
- On `qa` fail: loop to `dev` (cap: `qa_loops_max=2`, skips reviewers).
- On any cap hit OR `status: blocked` from any Subagent: cascade to `blocker-specialist` (cap: `blocker_calls_max=2` per task).

After every Subagent return: atomically update `session.yml.task_states[T-XXX]` (tmp + rename). Sole-writer invariant = no race.

### 5. Progress detection (hash-based stall — production agent consensus 2025-26)
Per task per loop iteration, compute three fingerprints from the most recent Output Packet:
- `last_diff_hash` — hash of `files_changed[]` + sorted line ranges.
- `last_findings_hash` — hash of `findings[]` count.
- `last_finding_set_hash` — hash of the sorted list of `(file, line, ac_ref)` tuples (catches "reviewer repeating itself").

If **2 consecutive iterations** produce identical `(diff_hash, findings_hash, finding_set_hash)`: progress stall. Cascade to `blocker-specialist` regardless of remaining loop budget. (Reflexion paper uses task-oracle for failure detection; modern production agents add explicit stall fingerprints.)

### 6. Escalation cascade routing (per-task, async — does NOT block other tasks)
On any cascade trigger (`status: blocked`, reviewer conflict, loop cap, progress stall):
- Build cascade Work Packet with `cascade_trigger`, `failing_output_refs[]`.
- Dispatch `blocker-specialist` (no fan-out — one specialist per blocker).
- On `status: done` (decision memo): apply memo's resume action; task continues from where it cascaded.
- On `status: escalate`: task enters `pending_human` terminal state. Other tasks continue independently. Update `escalation_metrics.pending_human_tasks`.

After `blocker_calls_max=2` for a task → orchestrator marks task `pending_human` regardless.

### 7. Pipeline-end handoff
When ready queue empty AND no task in-flight (every task is `done` or `pending_human`):
- Compute `escalation_metrics.escalation_rate = pending_human_tasks / total_tasks` (healthy: 10-15% per Galileo).
- Set `pipeline_completed_at`; set `current_phase` per outcome (`done` if all tasks done; `escalated` if any pending_human; `paused` if `--resume` aborted mid-flight).
- Emit handoff message (see "Handoff" section); also save to `.agent-session/<task_id>/handoff.md`.

## Dispatch contract (Work Packet embedded in `Task` prompt)
Claude Code's `Task` tool accepts: `subagent_type` (string, must match a file in `agents/`), `description` (short), `prompt` (free-form string). There is no native JSON-payload field. Pattern: embed the Work Packet as a fenced YAML block inside `prompt`:

```
WorkPacket:
```yaml
task_id: FEAT-NNN
dispatch_id: <uuid>
spec_ref: ./.agent-session/FEAT-NNN/spec.md
plan_ref: ./.agent-session/FEAT-NNN/plan.md
tasks_ref: ./.agent-session/FEAT-NNN/tasks.md
ac_scope: [AC-001, AC-003]
scope_files: [src/auth/login.ts]
previous_findings: <path-or-null>
project_context:
  standards_ref: ./CLAUDE.md
```
```

The Subagent body's "Input contract" specifies which fields are required for that Role. Missing fields → Subagent emits `status: blocked, blocker_kind: contract_violation`.

## Output
- Per dispatch: Work Packet snapshot at `.agent-session/<task_id>/inputs/<dispatch_id>.json` (orchestrator writes for traceability); Output Packet at `.agent-session/<task_id>/outputs/<dispatch_id>.json` (Subagent writes via atomic write).
- Per task: state machine in `session.yml.task_states[T-XXX]`.
- Pipeline-level: `session.yml` fields (`pipeline_started_at`, `pipeline_completed_at`, `escalation_metrics`).
- Final: human-readable handoff Markdown printed to console + saved to `.agent-session/<task_id>/handoff.md`.

## Handoff (3 shapes; one skeleton — Conventional Commits + 4 fixed sections)
**Title:** `<type>(<scope>): <imperative summary>` (Conventional Commits — renders cleanly in GitHub/Linear/Jira).

**Body skeleton (all 3 shapes):**
```
## Summary
- 1-3 bullets: what was built, headline outcome.

## Per-task status
| ID    | Title          | Status         | Loops used               | Evidence              |
|-------|----------------|----------------|--------------------------|-----------------------|
| T-001 | <title>        | done           | review:1, qa:0           | <file refs>           |
| T-002 | <title>        | pending_human  | review:3 (cap), blocker:2 (cap) | <decision memo path>  |

## Validation
- AC coverage: N/N ACs validated (qa Output Packets aggregated)
- Test commands run: `<cmd>` (exit 0)
- escalation_rate: X% (target: 10-15%)

## Follow-ups / Escalations
- T-XXX: <human action required, link to decision memo>
- (or `(none — ready to ship)` for uniform success)
```

**Three shape variants (closing line varies):**
- **Uniform success** (all tasks done): `"Implementation done. When ready, run /ship FEAT-NNN to clean up the session."`
- **Mixed status** (some pending_human): `"Partial completion. <N> done, <M> awaiting human decision. After resolving the blockers and editing artifacts, choose: /orchestrator FEAT-NNN --resume (default — preserves done tasks) | /orchestrator FEAT-NNN --restart (only if prior work is invalidated)."`
- **Full escalate** (all pending_human): `"Pipeline escalated. All tasks blocked. See decision memos at .agent-session/<task_id>/decisions/ and resolve before /orchestrator FEAT-NNN --resume."`

## Failure modes
- **Orchestrator process killed mid-dispatch:** in-flight Subagent's Output Packet may not be merged into `session.yml`. On `--resume`, orchestrator re-reads `outputs/` directory; any Output Packet without a corresponding `task_states` update is replayed (state-merge is idempotent on `dispatch_id`).
- **Output Packet schema validation failure:** treat as `status: blocked, blocker_kind: contract_violation`; cascade to blocker-specialist.
- **Subagent timeout (no Output Packet returned):** treat as `status: blocked, blocker_kind: timeout`; cascade.
- **Fan-out `scope_files` collision** (caught at task-builder time but defense-in-depth here): if 2 `[P]` dispatches reach the same file in flight, second dispatch's `dev` should detect diff conflict and emit `blocked`; orchestrator serializes the retry.
- **Cap hit on a task with `--resume`:** cap counters preserved across resume — they do not reset. Hard cap is hard.
- **Concurrent `/orchestrator` on same `FEAT-NNN`:** undefined behavior. Sole-writer invariant assumes one orchestrator process per Session. Lockfile is TODO Phase 5 — relies on human discipline for MVP.

## Why a Skill (not a Subagent)
Subagents in Claude Code cannot spawn other Subagents (platform constraint). The orchestrator must run in the main session to dispatch the workers via the `Task` tool. Also satisfies "dispatches Subagents" criterion (see `shared/concepts/skill-vs-subagent.md`).
