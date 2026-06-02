---
name: orchestrator
description: Phase 4 (Implementation) entry point for the SDD pipeline. Dispatches dev → parallel reviewers → qa per task via the Task tool, enforces loop caps, runs a mandatory audit gate, and emits one handoff. Use when running `/orchestrator FEAT-NNN` to implement an approved Session, or `--resume`/`--restart` on an existing one.
hooks:
  PreToolUse:
    - matcher: "Edit|Write|MultiEdit"
      hooks:
        - type: command
          command: "python3 $CLAUDE_PROJECT_DIR/.claude/hooks/guard-session-scope.py"
          timeout: 5
    - matcher: "Bash"
      hooks:
        - type: command
          command: "python3 $CLAUDE_PROJECT_DIR/.claude/hooks/block-git-write.py"
          timeout: 5
    - matcher: "Task"
      hooks:
        - type: command
          command: python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-tier-calibration.py"
          timeout: 5
  Stop:
    - hooks:
        - type: command
          command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-audit-dispatch.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-audit-dispatch.py"'
          timeout: 5
        - type: command
          command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py"'
          timeout: 5
  PostToolUse:
    - matcher: "Task"
      hooks:
        - type: command
          command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-dispatch-packet.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-dispatch-packet.py"'
          timeout: 10
---

# Orchestrator — Phase 4 (Implementation)

Runs the autonomous Implementation Pipeline: dispatches the 6 Subagents (dev, code-reviewer, logic-reviewer, qa, blocker-specialist, audit-agent) via Claude Code's `Task` tool, enforces caps, and emits one handoff (gated by audit-agent). Runs without the human in-the-loop until handoff.

Two invariants hold for the whole phase:
- **Sole writer:** the orchestrator is the only Skill that writes `session.yml`. Subagents return Output Packets; the orchestrator reads them, merges state, and atomically rewrites `session.yml` (tmp + rename). This eliminates concurrent-write races without file locks (Buck2's single-coordinator pattern).
- **Non-edit (issue #1 mitigation):** the orchestrator MUST NOT edit any consumer-repo source file. Its only writes are to `.agent-session/<spec_id>/`. All source edits flow through `dev` dispatches; the audit-agent (step 8) verifies this mechanically before handoff.

Detailed contracts live in flat reference files next to this one — read each when you reach the step that points to it:
- [`dispatch-manifest.md`](dispatch-manifest.md) — manifest JSON schema + append rules (step 1b)
- [`dispatch-contract.md`](dispatch-contract.md) — Work Packet format, Task `model` parameter, caching (step 3)
- [`model-effort-calibration.md`](model-effort-calibration.md) — Tier × Loop model/effort table + algorithm (step 3)
- [`handoff.md`](handoff.md) — the 4 handoff shapes + skeletons (steps 8–9)
- [`failure-modes.md`](failure-modes.md) — partial-failure behavior + design rationale

## Preflight: verify ai-squad hooks installed (RUN BEFORE ANYTHING ELSE)

Phase 4 dispatches subagents whose hooks live in `$CLAUDE_PROJECT_DIR/.claude/hooks/`. The PreToolUse hooks (`guard-session-scope`, `block-git-write`, `verify-tier-calibration`) are **not** fail-open — a missing file there crashes the dispatch. Refuse to proceed without them.

As your **first action**, run this Bash check exactly once per fresh invocation:

```sh
# Resolve repo root robustly — Claude Code doesn't always export $CLAUDE_PROJECT_DIR
# into Bash tool calls (only hook subshells), so fall back to git/pwd.
repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
hooks_dir="$repo_root/.claude/hooks"
# Positional params ($@) keep iteration shell-agnostic (a bare `for f in $required`
# word-splits in bash but not zsh).
set -- verify-audit-dispatch.py guard-session-scope.py block-git-write.py verify-tier-calibration.py verify-output-packet.py verify-reviewer-write-path.py manifest_append.py
missing=""
for f in "$@"; do
  [ -f "$hooks_dir/$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  printf 'MISSING_HOOKS:%s\n' "$missing"
  printf 'Checked under: %s\n' "$hooks_dir"
  printf 'Run in this repo: ai-squad deploy --hooks-only  (or: npx @ai-squad/cli deploy --hooks-only)\n'
  exit 1
fi
echo "hooks-ok (under $hooks_dir)"
```

- `hooks-ok` → proceed to "Refuse when".
- `MISSING_HOOKS:` → **STOP immediately**, surface the missing list + deploy command. Never dispatch subagents without these hooks; do not invent workarounds.

Skip this check on `--resume` after the first turn of the same Session has confirmed it.

## When to invoke
- `/orchestrator FEAT-NNN` — fresh start of Phase 4.
- `/orchestrator FEAT-NNN --resume` — resume from `paused` (planned but not started) OR `escalated` (per-task state preserved). Default when re-invoked on an existing Session.
- `/orchestrator FEAT-NNN --restart` — wipes `.agent-session/<spec_id>/inputs/` and `outputs/` (preserves spec/plan/tasks). Used when human edits invalidated prior work.

## Refuse when
- `implementation` not in `planned_phases` — branch on who is steering (the `auto_approved_by` field in `session.yml`):
  - **`auto_approved_by` is non-null** (an autonomous driver such as `pm` is steering) → hard refuse → message: `"Implementation was not planned for this Session and an autonomous driver (auto_approved_by=<value>) is steering. The PM/supervisor must declare implementation in planned_phases before Phase 4."` An autonomous driver reaching here without having planned implementation is a real misconfiguration — never self-authorize on its behalf.
  - **`auto_approved_by` is null** (a human invoked `/orchestrator` directly) → do NOT refuse and do NOT make the human edit `session.yml`. The explicit human invocation is the authorization; confirm once and self-enable the phase (see "Human authorization of an unplanned implementation" below).
- Spec not `status: approved` → message: `"Spec must be approved before /orchestrator."`
- Plan in `planned_phases` but not `status: approved` → message: `"Plan must be approved before /orchestrator."`
- Tasks in `planned_phases` but not `status: approved` → message: `"Tasks must be approved before /orchestrator. Run /task-builder FEAT-NNN to finish them."`
- `session.yml.schema_version` higher than this Skill knows → message: `"Session schema_version <N> newer than this Skill's <M>. Upgrade ai-squad."`

### Human authorization of an unplanned implementation
Reached only when `implementation` is absent from `planned_phases` **and** `auto_approved_by` is null (interactive, human-driven). The recommended SDD flow scopes a Session at `/spec-writer` time and frequently defers implementation to a later session, so a human returning to run `/orchestrator` on a plan/tasks-only Session is the normal path — not an error. Forcing a manual `session.yml` edit to "prove" intent the human just expressed by typing the command is pure friction.

1. Ask the human **once**, via `AskUserQuestion`: `"Implementation wasn't in this Session's planned_phases. Start Phase 4 now? [Yes — add implementation and run | No — abort]"`. This runs at the entry point, before any dispatch — the human is present, so the HOTL guarantee (no human interrupted mid-pipeline) is preserved.
2. **Yes** → append `implementation` to `planned_phases` and record the authorization under `phase_history.implementation` (`authorized_by: <human>`, `authorized_at: <date>`, `note: "Implementation added via explicit /orchestrator invocation; was outside the original planned_phases."`). Continue preflight normally.
3. **No** → abort with zero changes to `session.yml`.

This is the **only** case in which the orchestrator may add a phase to `planned_phases`, and only for a human-driven Session. The remaining "Refuse when" gates (Spec/Plan/Tasks approval) still apply after authorization — self-authorization covers the `planned_phases` entry alone, never artifact approval. `--resume` semantics are unaffected: a human who uses `--resume` on a Session that never planned (or started) implementation is routed through this same confirm-once path — treat it as a fresh start of implementation, not a `"nothing to resume"` error.

## Inputs (preconditions)
- `.agent-session/<spec_id>/spec.md` (status: approved) — always required.
- `.agent-session/<spec_id>/plan.md` (status: approved) — IF `plan` in `planned_phases`.
- `.agent-session/<spec_id>/tasks.md` (status: approved) — IF `tasks` in `planned_phases`.
- If Plan or Tasks were skipped: orchestrator auto-derives a minimal structure from the Spec (single-task default; flat AC coverage).

## Steps

### 1. Resolve Session and read inputs
1. Determine `spec_id` (explicit arg or current Session from `session.yml`).
2. Read approved Spec/Plan/Tasks (auto-derive if Plan/Tasks were skipped per `planned_phases`).
2a. Read `session.yml.pipeline_mode` (default `standard`; valid: `lite` | `standard`). It governs two clamps in this skill: the **fan-out cap** (step 3 — `lite` = sequential, `standard` = 5) and the **tier ceiling** (model/effort — `lite` clamps every task to T2 max; `standard` honors the declared tier). Per-task skip-reviewers markers are honored in both modes.
2b. Read `session.yml.output_locale` (default `en`). Copied verbatim into every Work Packet's stable block and used to write `handoff.md` (step 9). Enums/identifiers stay canonical regardless. See [`shared/concepts/output-locale.md`](../../../shared/concepts/output-locale.md).
3. **Preflight: validate `ac_scope` and `Tier:` on every task.** Before any dispatch, iterate every `T-XXX` in `tasks.md`. Abort if any task is missing `ac_scope` (`"Task <T-XXX> in tasks.md missing required ac_scope field"`) or `Tier:` (`"Task <T-XXX> in tasks.md missing required Tier field — required by orchestrator model/effort calibration"`). `ac_scope` is needed to populate `acScope` in `expected_pipeline[]` (reviewers/qa scope their work by it); `Tier` drives model/effort selection (step 3). Silently defaulting either defeats downstream calibration.
4. Initialize `task_states` map in `session.yml` with one entry per `T-XXX` (state=`pending`, review_loops=0, qa_loops=0, blocker_calls=0, packet_retries=0, hashes=null) — fresh start only; `--resume` preserves existing entries (including `packet_retries`).
5. Set `pipeline_started_at` (or leave intact on `--resume`).

### 1b. Write the dispatch manifest (Outbox + GitHub required-checks pattern)
Before any `Task` dispatch, write `.agent-session/<spec_id>/dispatch-manifest.json` with its initial structure (`expected_pipeline` + empty `actual_dispatches`). After every dispatch, append the dispatch entry by piping it to `manifest_append.py` — NEVER hand-edit the manifest JSON (by-hand edits corrupted it in FEAT-001). Full schema, the CLI call, field rules, and `--resume` behavior: [`dispatch-manifest.md`](dispatch-manifest.md). Manifest-first, dispatch-second — it is the audit trail step 8 reconciles.

### 2. Build the per-task pipeline graph
For each `T-XXX`: compute edges from `Depends on:` constraints; mark `[P]` tasks eligible for parallel dispatch within their phase (subject to predecessors being `done`). Independent tasks form the **ready queue**; dependent tasks wait for predecessors.

### 3. Dispatch loop (capped concurrency, FIFO overflow queue)
**Single-turn fan-out rule (read before anything else):** in Claude Code, parallelism happens ONLY when multiple `Task` calls are issued in the SAME assistant turn (one response with N tool_use blocks). Dispatching across separate turns runs them serially. Whenever ≥2 dispatches are ready, batch them in one turn.

**Mode-aware cap:** `standard` = 5 concurrent dispatches/turn (Anthropic's empirical 3–5 fan-out sweet spot; under Claude Code's hard 10-cap); `lite` = 1 (sequential by design). In `lite`, the single-turn rule still applies to the reviewers fan-out within a task (code-reviewer + logic-reviewer in one turn), unless the task carries a `Skip reviewers:` marker.

While the ready queue is non-empty OR any task is in-flight:
- Take up to N dispatches (N = 5 standard / 1 lite) from the ready queue. Build each Work Packet per [`dispatch-contract.md`](dispatch-contract.md), and select `model`/`effort` per [`model-effort-calibration.md`](model-effort-calibration.md). **Pass the Task tool's `model` parameter** — omitting it runs the subagent on the orchestrator's model and `verify-tier-calibration.py` blocks the dispatch.
- **Issue all N `Task` calls in a single assistant turn.** Never dispatch one, wait, then the next.
- Tasks beyond the cap wait in the FIFO queue; it refills only after the in-flight batch returns.
- **Packet-integrity check (C-1):** after the batch returns, the `PostToolUse(Task)` hook (`verify-dispatch-packet.py`) emits `additionalContext` for any dispatch whose Output Packet did not persist or is invalid. For each such `dispatch_id`, run the packet-retry handling in step 4 BEFORE merging state — a missing packet means there is no state to merge yet.
- When the batch returns: for each Output Packet run step 4 (state merge), step 5 (progress check), step 6 (cascade if needed). Then re-evaluate the ready queue and issue the next batch in one turn.

### 4. Per-task state machine (orchestrator-managed, atomic write)
Each task: `pending` → `running` → (`done` | `blocked` | `pending_human` | `failed`). Pipeline per task (per [`squads/sdd/docs/concepts/pipeline.md`](../../docs/concepts/pipeline.md)):
- Dispatch `dev`. On `dev` `status: done`: dispatch `code-reviewer` and `logic-reviewer` **in parallel — both `Task` calls in the SAME turn** (serializing them doubles wall-clock per task). Both count against the cap.
- Reviewers return findings → loop to `dev` (cap: `review_loops_max=3`).
- Reviewers conflict on same `file:line` → cascade to `blocker-specialist`.
- Reviewers clean → dispatch `qa`. `qa` fail → loop to `dev` (cap: `qa_loops_max=2`, skips reviewers).
- Any cap hit OR `status: blocked` from any Subagent → cascade to `blocker-specialist` (cap: `blocker_calls_max=2` per task).

After every Subagent return: atomically update `session.yml.task_states[T-XXX]` (tmp + rename). Sole-writer invariant = no race.

**Packet-retry handling (C-1 — missing/invalid Output Packet).** When `verify-dispatch-packet.py` flags a `dispatch_id` (packet missing or invalid after the Task returned — typically an abrupt subagent death from a platform anomaly):
1. Increment `task_states[T-XXX].packet_retries` (atomic write). This counter is SEPARATE from `review_loops`/`qa_loops` — a non-delivered artifact is an infra failure, not code difficulty; it must not consume the review budget.
2. If `packet_retries <= packet_retry_max` (=2): re-dispatch the SAME role for the SAME task with a NEW `dispatch_id` (new loop suffix), append the new dispatch to the manifest via `manifest_append.py`, and dispatch the `Task`. Applies to EVERY role, including `dev` — dev is already re-dispatched in review loops and re-reads current state; any half-applied edit is caught downstream by reviewers/qa/baseline.
3. If `packet_retries > packet_retry_max`: mark the task `blocked` (terminal) with `blocker_kind: missing_output_packet`. Do NOT cascade to blocker-specialist (the artifact never landed — there is nothing to analyze). The audit gate (step 8) will see it; recovery is `--restart` + human review.

`packet_retries` does NOT count toward `review_loops_max`, `qa_loops_max`, or progress-stall detection.

**Reviewer mandatoriness (FEAT-008 Gap B):** code-reviewer and logic-reviewer are **mandatory** between `dev` and `qa` for every dev-type task. `verify-pipeline-completeness.py` (PreToolUse Task) blocks the `qa` dispatch unless CR + LR have status `done`/`needs_review` in the manifest for that `task_id`. The only exception is an explicit per-task marker in `tasks.md` (e.g. for a one-line/doc-only fix):
```markdown
## T-XXX titulo
**Tier:** T1
**Skip reviewers:** budget — single-line docs typo fix, no logic surface
```
The marker releases the `qa` gate; without it, any skip is blocked. It is audit-visible — audit-agent reports skipped tasks as a `pipeline_stage_skipped` finding (severity `warning`, not blocker).

### 5. Progress detection (hash-based stall)
Per task per loop, compute three fingerprints from the most recent Output Packet: `last_diff_hash` (files_changed[] + sorted line ranges), `last_findings_hash` (findings[] count), `last_finding_set_hash` (sorted `(file, line, ac_ref)` tuples — catches a reviewer repeating itself). If **2 consecutive iterations** produce identical `(diff_hash, findings_hash, finding_set_hash)`: progress stall → cascade to `blocker-specialist` regardless of remaining loop budget.

### 6. Escalation cascade routing (per-task, async — does NOT block other tasks)
On any cascade trigger (`status: blocked`, reviewer conflict, loop cap, progress stall):
- Build a cascade Work Packet with `cascade_trigger`, `failing_output_refs[]`.
- Dispatch `blocker-specialist` (no fan-out — one specialist per blocker). Set its `actual_dispatches[]` `review_loop` to `task_states[T-XXX].loops` at cascade time (same value the triggering dispatch used); do NOT increment `loops` for a blocker-specialist dispatch (it is a cascade branch, not a new dev attempt).
- `status: done` (decision memo) → apply the memo's resume action; task continues from where it cascaded.
- `status: escalate` → task enters `pending_human` terminal state; other tasks continue; update `escalation_metrics.pending_human_tasks`.

After `blocker_calls_max=2` for a task → mark it `pending_human` regardless.

### 7. Pipeline-end pre-checks
When ready queue empty AND no task in-flight (every task `done` or `pending_human`): compute `escalation_metrics.escalation_rate = pending_human_tasks / total_tasks` (healthy 10–15% per Galileo); set `pipeline_completed_at`.

### 8. Audit gate (mandatory reconciliation — issue #1 mitigation)
**Before** computing `current_phase` or emitting a handoff, dispatch `audit-agent` (singleton, no fan-out). Set its `actual_dispatches[]` entry to `review_loop: 1` (singleton, no retry, no `task_states`). Work Packet:
```yaml
spec_id: FEAT-NNN
dispatch_id: <uuid>
manifest_ref: .agent-session/FEAT-NNN/dispatch-manifest.json
outputs_dir_ref: .agent-session/FEAT-NNN/outputs/
tasks_ref: .agent-session/FEAT-NNN/tasks.md
spec_ref: .agent-session/FEAT-NNN/spec.md
```
The audit-agent runs 6 reconciliation checks (see [`agents/audit-agent.md`](../../agents/audit-agent.md)). Append its own dispatch to `actual_dispatches[]`, then branch on its Output Packet:
- **`status: done`** (all checks pass) → proceed to step 9.
- **`status: blocked`** (any `blocker_kind`) → DO NOT emit a normal handoff. **First**, apply the Layer 2 environment-block exception below if it qualifies; otherwise set `current_phase: escalated`, emit the **audit-failure handoff** ([`handoff.md`](handoff.md)) selecting the narrative by `blocker_kind` (`bypass_detected` / `schema_violation` / `pipeline_stage_skipped` / other). Save to `handoff.md`. Stop.
  - **Layer 2 — human ownership authorization (Spec A; `orchestrator_edited_source` ONLY).** Qualifies iff ALL three hold: (1) `blocker_kind: bypass_detected`; (2) **every** blocking finding has `audit_finding_kind: orchestrator_edited_source` (if even one other finding kind is present — `role_mismatch`, `pipeline_stage_skipped`, `ac_not_validated`, `schema_violation`, `missing_output_packet`, `orphan_output_packet` — it does NOT qualify and stays terminal); (3) a human is present (`auto_approved_by` ≠ `"pm"` in `session.yml` — PM-autonomous never opens this path). When it qualifies, for EACH `orchestrator_edited_source` finding's path: run `git diff <path>` (read-only), show the diff, and ask via `AskUserQuestion` **once**: *"`<path>` was modified, but no dev agent declared it — either you edited it manually, or something wrote outside the pipeline. Do you recognize this change as yours?"*
    - **Yes** → that path is an authorized human edit; drop the finding and append to `session.yml.notes` an `audit_override: { path: <path>, authorized_by: human, audit_dispatch_id: <id> }` entry. If, after asking about every such path, no blocking findings remain → proceed to step 9 (ownership audit treated as passed). The handoff records the authorization(s).
    - **No** → real bypass; keep the finding, set `current_phase: escalated`, emit the `bypass_detected` audit-failure handoff. Stop.
  - This NEVER re-dispatches the audit (a `blocked` verdict stays terminal — Layer 2 is a handoff-time human decision, not a second audit) and NEVER edits files under `outputs/` (`guard-session-scope` blocks it). The honesty of the question is the defense: showing the full diff and naming the risk lets the human decide with real information. Mirrors GAP B — the orchestrator never self-certifies; only the human authority authorizes, once.
- **`status: escalate`** (`blocker_kind: audit_inconclusive` — audit itself could not run) → set `current_phase: escalated`; emit the refusal handoff with the audit blockers. Stop.

The audit verdict is **binding and terminal.** On `blocked`/`escalate` the orchestrator MUST NOT: emit a success/mixed handoff; edit any file under `outputs/` to make the audit pass (`guard-session-scope.py` blocks it); or re-dispatch `audit-agent` for a second opinion. The ONLY recovery is human review + `/orchestrator FEAT-NNN --restart`. (Re-running the audit over hand-edited packets was the FEAT-010 failure — 4 runs until it flipped to `done`.)

### 9. Pipeline-end handoff (only if step 8 passed)
- Set `current_phase` per outcome (`done` if all tasks done; `escalated` if any pending_human; `paused` if `--resume` aborted mid-flight).
- **Cost report** (you have write authority; the read-only audit-agent does not). First backfill any missed capture, scoped to THIS session's `subagents/` dir (never a machine-wide `projects/*/*` glob, which inflates the total):
  ```sh
  python3 - "$PWD/.agent-session/<spec_id>" <<'PY'
  import sys
  sys.path.insert(0, ".claude/hooks")
  import cost_report, pricing
  session_dir = sys.argv[1]
  tps = cost_report.session_transcripts(session_dir)
  print("backfilled:", cost_report.backfill_missing(session_dir, tps, pricing.load_prices()))
  PY
  ```
  Then emit the report: `python3 .claude/hooks/cost-report.py <spec_id>` (writes `cost-report.json`, prints the planning/orchestration/implementation table). Include the one-line total in the handoff; if the audit raised `cost_capture_incomplete`, OR the report's `complete` is false, OR the report's `scoping_suspect` is true, flag the gap explicitly and do NOT present the total (or the implementation figure) as final — when `scoping_suspect` is true the implementation cost was excluded wholesale and is untrustworthy.
- Emit the handoff message (shapes + skeletons in [`handoff.md`](handoff.md)); also save to `.agent-session/<spec_id>/handoff.md`.

## Output
- Per dispatch: Work Packet snapshot at `inputs/<dispatch_id>.json` (orchestrator-written); Output Packet at `outputs/<dispatch_id>.json` (Subagent-written, atomic).
- Per task: state machine in `session.yml.task_states[T-XXX]`.
- Pipeline-level: `session.yml` fields (`pipeline_started_at`, `pipeline_completed_at`, `escalation_metrics`).
- Final: handoff Markdown to console + saved to `.agent-session/<spec_id>/handoff.md`.

## Hard rules
- Never: edit any file in the consumer-repo source tree. The orchestrator's writes are restricted to `.agent-session/<spec_id>/`. All source edits flow through `dev` dispatches.
- Never: skip step 8 (audit gate). The audit-agent's verdict is binding before any handoff.
- Never: edit, patch, or rewrite any file under `outputs/` — those are subagent-authored evidence. A `blocked` audit is terminal; recover via `--restart`, never by editing packets. Mechanically blocked by `guard-session-scope.py`.
- Never: re-dispatch `audit-agent` in the same run to flip a `blocked` verdict. One audit per run; terminal. (Re-running over hand-edited packets was the FEAT-010 failure.)
- Never: emit a "uniform success" or "mixed status" handoff if the audit returned `blocked`/`escalate`. Emit the audit-failure handoff instead.
- Never: append to `actual_dispatches[]` without a corresponding real `Task` dispatch.
- Never: hand-edit `dispatch-manifest.json` with Edit/Write. Append only via `manifest_append.py` (atomic). By-hand JSON editing corrupted the manifest in FEAT-001.
- Always: write the dispatch manifest (step 1b) BEFORE any `Task` dispatch. Manifest-first; dispatch-second.
- Always: run the audit gate even on uniform-success runs. One cheap haiku dispatch; the protection is non-negotiable.
