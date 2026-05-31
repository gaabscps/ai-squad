# Failure modes and design rationale

Referenced from `skill.md`. How the orchestrator behaves under partial failure, and why it is a Skill (not a Subagent).

## Failure modes
- **Orchestrator process killed mid-dispatch:** in-flight Subagent's Output Packet may not be merged into `session.yml`. On `--resume`, orchestrator re-reads `outputs/` directory; any Output Packet without a corresponding `task_states` update is replayed (state-merge is idempotent on `dispatch_id`).
- **Output Packet schema validation failure:** treat as `status: blocked, blocker_kind: contract_violation`; cascade to blocker-specialist.
- **Subagent timeout (no Output Packet returned):** treat as `status: blocked, blocker_kind: timeout`; cascade.
- **Fan-out `scope_files` collision** (caught at task-builder time but defense-in-depth here): if 2 `[P]` dispatches reach the same file in flight, second dispatch's `dev` should detect diff conflict and emit `blocked`; orchestrator serializes the retry.
- **Cap hit on a task with `--resume`:** cap counters preserved across resume — they do not reset. Hard cap is hard.
- **Concurrent `/orchestrator` on same `FEAT-NNN`:** undefined behavior. Sole-writer invariant assumes one orchestrator process per Session. Lockfile is TODO Phase 5 — relies on human discipline for MVP.
- **Audit-agent itself bypassed:** mechanically blocked. The orchestrator's frontmatter declares a `Stop` hook (`verify-audit-dispatch.py`) that reads `dispatch-manifest.json` and refuses to allow the orchestrator session to end without an `audit-agent` entry in `actual_dispatches[]` with `status: done`. The hook honors `stop_hook_active` to avoid infinite loops. See `squads/sdd/hooks/verify-audit-dispatch.py`.
- **Orchestrator edits source files directly:** mechanically blocked. The orchestrator's frontmatter declares a `PreToolUse` hook (`guard-session-scope.py`) that denies any `Edit`/`Write`/`MultiEdit` whose path is outside `.agent-session/<spec_id>/`. A second `PreToolUse` hook (`block-git-write.py`) denies `Bash` calls running git write commands.
- **Subagent claims `done` without emitting Output Packet:** mechanically blocked. Each Phase 4 Subagent's frontmatter declares a `Stop` hook (`verify-output-packet.py`) that extracts the `dispatch_id` from the transcript and refuses to allow the subagent to finish unless `outputs/<dispatch_id>.json` exists and passes minimum schema checks (required fields + valid status).
- **False-positive audit (clean run flagged as bypass):** recoverable — human reviews `.agent-session/<spec_id>/outputs/<audit-dispatch-id>.json`, files the issue, re-runs after fix. Audit-agent is biased toward `blocked` because false-negative defeats the entire layer.

## Why a Skill (not a Subagent)
Subagents in Claude Code cannot spawn other Subagents (platform constraint). The orchestrator must run in the main session to dispatch the workers via the `Task` tool. Also satisfies "dispatches Subagents" criterion (see `shared/concepts/skill-vs-subagent.md`).
