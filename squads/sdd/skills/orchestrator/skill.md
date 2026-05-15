---
name: orchestrator
description: Phase 4 entry point. Dispatches dev → parallel reviewers → qa per task, enforces loop caps, emits handoff. Supports --resume from paused/escalated state.
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
---

# Orchestrator — Phase 4 (Implementation)

The Skill that runs the autonomous Implementation Pipeline. Dispatches the 6 Subagents (dev, code-reviewer, logic-reviewer, qa, blocker-specialist, audit-agent) via Claude Code's `Task` tool, enforces caps, and emits one handoff (gated by audit-agent). Runs without the human in-the-loop until handoff.

**Sole writer invariant:** in Phase 4, the orchestrator is the only Skill that writes `session.yml`. Subagents return Output Packets; the orchestrator reads them, merges state, and atomically rewrites `session.yml` (tmp + rename). This eliminates concurrent-write races without file locks (Buck2's single-coordinator pattern).

**Non-edit invariant (issue #1 mitigation):** the orchestrator MUST NOT edit any consumer-repo source file. Its only writes are to `.agent-session/<task_id>/` (manifest, inputs, session.yml). All source edits flow through `dev` Subagent dispatches. The `audit-agent` (step 8 below) verifies this mechanically before handoff.

## Preflight: verify ai-squad hooks installed (RUN BEFORE ANYTHING ELSE)

Phase 4 dispatches subagents whose PreToolUse/PostToolUse/Stop hooks live in `$CLAUDE_PROJECT_DIR/.claude/hooks/`. PreToolUse hooks (`guard-session-scope`, `block-git-write`, `verify-tier-calibration`) are **not** wrapped fail-open — a missing file there would still crash. Stop hooks are wrapped fail-open as defense in depth, but missing them blinds the audit-agent and usage capture. Refuse to proceed without them.

As your **first action**, run this Bash check exactly once per fresh invocation:

```sh
required="verify-audit-dispatch.py guard-session-scope.py block-git-write.py verify-tier-calibration.py verify-output-packet.py capture-subagent-usage.py stamp-session-id.py verify-reviewer-write-path.py"
missing=""
for f in $required; do
  [ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  printf 'MISSING_HOOKS:%s\n' "$missing"
  printf 'Run in this repo: ai-squad deploy --hooks-only  (or: npx @ai-squad/cli deploy --hooks-only)\n'
  exit 1
fi
echo "hooks-ok"
```

- `hooks-ok` → proceed to "Refuse when" section below.
- `MISSING_HOOKS:` → **STOP immediately**, surface the exact missing list and the deploy command to the human/PM. Never start dispatching subagents without these hooks. Do not invent workarounds.

Skip this check on `--resume` after the first turn of the same Session has confirmed it.

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
3. **Preflight: validate `ac_scope` and `Tier:` on every task.** Before any dispatch, iterate every `T-XXX` in `tasks.md`. If any task does not declare an `ac_scope` field (or `ac_scope` is empty), abort with error:
   ```
   "Task <T-XXX> in tasks.md missing required ac_scope field"
   ```
   If any task does not declare a `Tier:` field (values: T1, T2, T3, T4), abort with error:
   ```
   "Task <T-XXX> in tasks.md missing required Tier field — required by orchestrator model/effort calibration"
   ```
   Do NOT dispatch any Subagent until all tasks pass both checks. The `ac_scope` guard exists because tasks without it cannot populate `acScope` in `expected_pipeline[]` and break the agentops coverage matrix. The `Tier` guard exists because dispatch model/effort selection is tier-driven (see "Model/effort selection" below); silently defaulting defeats the calibration.
4. Initialize `task_states` map in `session.yml` with one entry per `T-XXX` (state=`pending`, loops=0, hashes=null) — fresh start only; `--resume` preserves existing entries.
5. Set `pipeline_started_at` (or leave intact on `--resume`).

### 1b. Write the dispatch manifest (Outbox + GitHub required-checks pattern)
Before any `Task` dispatch, atomically write `.agent-session/<task_id>/dispatch-manifest.json` (JSON, not YAML — hook scripts parse this with Python stdlib `json` module, no yaml dependency):

```json
{
  "schema_version": 1,
  "task_id": "FEAT-NNN",
  "plan_generated_at": "<iso8601>",
  "expected_pipeline": [
    {
      "task_id": "T-001",
      "required_roles": ["dev", "code-reviewer", "logic-reviewer", "qa"],
      "acScope": ["AC-001", "AC-002"],
      "tasksCovered": ["T-001"]
    },
    {
      "task_id": "T-002",
      "required_roles": ["dev", "code-reviewer", "logic-reviewer", "qa"],
      "acScope": ["AC-003", "AC-004"],
      "tasksCovered": ["T-002"]
    },
    {
      "task_id": "audit-agent",
      "required_roles": ["audit-agent"],
      "acScope": [],
      "tasksCovered": ["T-001", "T-002"]
    }
  ],
  "actual_dispatches": []
}
```

After every `Task` tool dispatch, append to `actual_dispatches[]`:
```json
{
  "dispatch_id": "<uuid>",
  "task_id": "T-XXX",
  "role": "dev | code-reviewer | logic-reviewer | qa | blocker-specialist | audit-agent",
  "started_at": "<iso8601>",
  "completed_at": "<iso8601>",
  "output_packet_ref": "outputs/<dispatch_id>.json",
  "status": "<Output Packet status>",
  "review_loop": 1,
  "pm_note": null
}
```

Field rules:
- `review_loop`: integer ≥ 1 — increment `task_states[T-XXX].loops` BEFORE appending the dispatch entry to `actual_dispatches[]`; then set `review_loop` to the post-increment value. This guarantees the first dispatch for a task records `review_loop: 1` (not 0), the first retry records `review_loop: 2`, etc. (`task_states` initializes with `loops=0`; first pre-append increment yields 1.) Every dispatch entry MUST include this field. Exception roles: see audit-agent (step 8) and blocker-specialist (step 6) for their derivation rules.
- `pm_note`: non-null string ONLY for notable events; `null` otherwise. Recognized notes:
  - Loop restart: `"Loop N restart — reviewer findings: <one-line summary>"`
  - QA fail loop: `"QA fail loop N — failed ACs: <AC-XXX, AC-YYY>"`
  - Escalation: `"Escalated to blocker-specialist — <trigger kind>"`
  - Progress stall: `"Progress stall detected (fingerprint match)"`

**`expected_pipeline[]` population rules (AC-005):**
- `acScope`: array of AC-IDs from the task's `ac_scope` field in `tasks.md` (e.g. `["AC-001", "AC-002"]`). For `audit-agent`, set to `[]` (audit validates all tasks, not a specific AC subset).
- `tasksCovered`: for task-scoped roles (dev, code-reviewer, logic-reviewer, qa), always `[task_id]` (single-element array). For `audit-agent`, set to the full list of all `T-XXX` IDs in the pipeline. Both fields are required — omitting them will cause the agentops coverage matrix to emit warnings.

The `usage` field on each entry is populated automatically by the `capture-subagent-usage.py` Stop hook — the orchestrator does NOT write it. The hook correlates via `_session_id` injected into the output packet by `stamp-session-id.py` (PostToolUse).

Atomic write pattern (tmp + rename) on every append. Manifest is the **mechanical audit trail** the audit-agent reconciles in step 8.

On `--resume`: read existing manifest, do NOT re-write `expected_pipeline`; continue appending to `actual_dispatches[]`.

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

**Pre-`done` usage check (AC-004):** Before transitioning any task-scoped dispatch entry in `actual_dispatches[]` to `status: done`, the orchestrator MUST re-read the manifest and verify that `usage` is present and `usage.total_tokens > 0` for that dispatch. This check applies to all roles except `pm-orchestrator` and `audit-agent`. Protocol:
1. Re-read `dispatch-manifest.json` (atomic read — no lock needed for read-only).
2. Find the entry for the dispatch just completed.
3. If `usage` is absent or `usage.total_tokens == 0`:
   - Set the entry's `status` to `blocked` with `pm_note: "usage_missing"`.
   - Cascade to `blocker-specialist` with `cascade_trigger: "usage_missing"`.
   - Do NOT mark the task `done`. Blocker-specialist decides whether to retry capture or escalate.
4. If `usage.total_tokens > 0`: proceed normally to mark the dispatch `done`.
This check is synchronous and deterministic — no async timeout. The `capture-subagent-usage.py` Stop hook runs before the orchestrator processes the return, so usage is available if the hook ran successfully.

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
- Dispatch `blocker-specialist` (no fan-out — one specialist per blocker). When appending the blocker-specialist dispatch entry to `actual_dispatches[]`, set `review_loop` to `task_states[T-XXX].loops` at cascade time — the same value the triggering dev/reviewer dispatch used. The `loops` counter is NOT incremented for a blocker-specialist dispatch (it is a cascade branch, not a new dev attempt).
- On `status: done` (decision memo): apply memo's resume action; task continues from where it cascaded.
- On `status: escalate`: task enters `pending_human` terminal state. Other tasks continue independently. Update `escalation_metrics.pending_human_tasks`.

After `blocker_calls_max=2` for a task → orchestrator marks task `pending_human` regardless.

### 7. Pipeline-end pre-checks
When ready queue empty AND no task in-flight (every task is `done` or `pending_human`):
- Compute `escalation_metrics.escalation_rate = pending_human_tasks / total_tasks` (healthy: 10-15% per Galileo).
- Set `pipeline_completed_at`.

### 8. Audit gate (mandatory reconciliation — issue #1 mitigation)
**Before** computing `current_phase` or emitting handoff, dispatch `audit-agent` (singleton, no fan-out) with this Work Packet. When appending the audit-agent dispatch entry to `actual_dispatches[]`, always set `review_loop: 1` — the audit-agent is a singleton with no retry semantics and has no `task_states` association.
```yaml
task_id: FEAT-NNN
dispatch_id: <uuid>
manifest_ref: .agent-session/FEAT-NNN/dispatch-manifest.json
outputs_dir_ref: .agent-session/FEAT-NNN/outputs/
tasks_ref: .agent-session/FEAT-NNN/tasks.md
spec_ref: .agent-session/FEAT-NNN/spec.md
```
Append the audit-agent's own dispatch to `actual_dispatches[]`. The audit-agent runs the 6 reconciliation checks (see `agents/audit-agent.md`).

Branch on the audit-agent's Output Packet:
- **`status: done`** (all checks pass) → proceed to step 9 (handoff).
- **`status: blocked, blocker_kind: bypass_detected`** → DO NOT emit normal handoff. Set `current_phase: escalated`. Emit a **refusal handoff** (see "Audit-failure handoff" below) listing every finding. Save to `.agent-session/<task_id>/handoff.md`. Stop.
- **`status: escalate`** (audit could not run — manifest unreadable, etc.) → set `current_phase: escalated`; emit refusal handoff with audit-agent's blockers. Stop.

The audit-agent's verdict is binding. The orchestrator MUST NOT emit a "uniform success" handoff if the audit returned `blocked` or `escalate`.

### 9. Pipeline-end handoff (only if step 8 passed)
- Set `current_phase` per outcome (`done` if all tasks done; `escalated` if any pending_human; `paused` if `--resume` aborted mid-flight).
- Emit handoff message (see "Handoff" section); also save to `.agent-session/<task_id>/handoff.md`.

## Dispatch contract (Work Packet embedded in `Task` prompt)
Claude Code's `Task` tool accepts: `subagent_type` (string, must match a file in `agents/`), `description` (short), `prompt` (free-form string), AND `model` (enum: `sonnet` | `opus` | `haiku`). The `model` parameter is **mandatory for tiered roles** (`dev`, `code-reviewer`, `logic-reviewer`, `qa`) — see "Task tool `model` parameter" below. The Work Packet is embedded as a fenced YAML block inside `prompt`:

```
WorkPacket:
```yaml
session_id: FEAT-NNN     # FEAT-007: feature scope; used by hooks for direct lookup
task_id: T-XXX
dispatch_id: <uuid>
spec_ref: ./.agent-session/FEAT-NNN/spec.md
plan_ref: ./.agent-session/FEAT-NNN/plan.md
tasks_ref: ./.agent-session/FEAT-NNN/tasks.md
ac_scope: [AC-001, AC-003]
scope_files: [src/auth/login.ts]
previous_findings: <path-or-null>
model: sonnet            # set by orchestrator from Tier × Loop table
effort: high             # set by orchestrator from Tier × Loop table
tier: T3                 # echoed for traceability; source of truth is tasks.md
project_context:
  standards_ref: ./CLAUDE.md
```
```

The Subagent body's "Input contract" specifies which fields are required for that Role. Missing fields → Subagent emits `status: blocked, blocker_kind: contract_violation`.

**`session_id` (FEAT-007):** mandatory for task-scoped dispatches (`dev`, `code-reviewer`, `logic-reviewer`, `qa`); optional for `audit-agent` (pipeline-scoped). Derived from the orchestrator's cwd — when running from `.agent-session/<FEAT-NNN>/`, emit `session_id: FEAT-NNN`. The `verify-tier-calibration.py` hook uses it for direct `<session_dir>/<session_id>/tasks.md` lookup; without it the hook falls back to mtime-ordered manifest scanning (legacy backward-compat path, slower).

### Task tool `model` parameter (run-model enforcement — AC-009)
**The `model` parameter of the Task tool itself controls the actual run-model of the subagent.** The Work Packet YAML is descriptive metadata — it does NOT control which model runs the subagent. If the orchestrator omits the Task tool's `model` parameter, Claude Code inherits the parent session's model (the orchestrator's own model, typically `opus`), bypassing the Tier × Loop table entirely. This was the root cause of severe cost amplification observed in early FEAT-* sessions (qa tasks calibrated for `haiku` running in `opus`, multiplying real cost 3-12×).

**Invariant:** for every `dev` / `code-reviewer` / `logic-reviewer` / `qa` dispatch, the orchestrator MUST pass the `model` parameter to the Task tool with the exact canonical model value derived from the Tier × Loop table (see algorithm below). The `verify-tier-calibration.py` PreToolUse hook enforces this: dispatches without `model`, or with a wrong `model`, are blocked with `task_tool_model_missing` / `task_tool_model_mismatch` before they run.

**Tier-independent roles** (`audit-agent`, `blocker-specialist`) are exempt — the hook short-circuits for these roles. Pass their `model` per their subagent file's frontmatter (haiku and opus respectively) for clarity, but the hook will not block if you omit it.

**Effort:** the Task tool does not accept an `effort` parameter. Effort is communicated to the subagent via the Work Packet YAML (`effort: high|medium|low|xhigh`) so the subagent body can adjust its own thinking depth. Hook still validates Work Packet `effort` against the canonical table (AC-005).

### Model/effort selection (canonical Tier × Loop enforcement)
On every Subagent dispatch, the orchestrator MUST (a) pass the Task tool `model` parameter AND (b) populate the Work Packet `model` and `effort` fields, all per the canonical Tier × Loop table in [`shared/concepts/effort.md`](../../../shared/concepts/effort.md). The Subagent frontmatter default is the documentation-only fallback — never trust it to be honored at runtime.

**Algorithm:**
1. Read the task's `Tier:` field from `tasks.md` (values: `T1`, `T2`, `T3`, `T4`). If absent → abort with error `"Task <T-XXX> in tasks.md missing required Tier field — required by orchestrator model/effort calibration"`. Do NOT silently default; that defeats the calibration.
2. Determine the dispatch's **loop kind** by inspecting `task_states[T-XXX]` and the immediately preceding dispatch in `actual_dispatches[]`:
   - `dev` + first dispatch on task → `dev L1`
   - `dev` + previous_findings from reviewer + `task_states.loops == 2` → `dev L2`
   - `dev` + previous_findings from reviewer + `task_states.loops == 3` → `dev L3`
   - `dev` + previous_findings from qa + qa-loop 1 → `dev qa-L1`
   - `dev` + previous_findings from qa + qa-loop 2 → `dev qa-L2`
   - `code-reviewer` / `logic-reviewer` / `qa` → look up by role only (loop-independent)
   - `blocker-specialist` → opus, xhigh (tier-independent)
   - `audit-agent` → haiku, medium (tier-independent)
3. Look up `(loop_kind, tier)` in the Tier × Loop table → `(model, effort)`.
4. **Pass `model` as the Task tool's `model` parameter** — this is what actually controls the subagent's run-model. Omitting it bypasses the table entirely.
5. Write `model`, `effort`, `tier` into the Work Packet YAML (descriptive only — for subagent self-awareness and audit).
6. Echo the same `model`/`effort` into a `tier_calibration` field on the `actual_dispatches[]` entry for the dispatch (`{tier: "T3", model: "sonnet", effort: "high", loop_kind: "dev L2"}`) — agentops uses this for cost-attribution reporting.

**Concrete Task tool call (canonical example for a qa T1 dispatch):**
```
Task(
  subagent_type="qa",
  model="haiku",              # ← REQUIRED — derived from Tier × Loop table
  description="QA validation for T-001",
  prompt='''WorkPacket:
```yaml
session_id: FEAT-NNN
task_id: T-001
dispatch_id: d-T-001-qa-l1
model: haiku
effort: high
tier: T1
subagent_type: qa
...
```
'''
)
```
Omitting `model="haiku"` causes the subagent to run on the orchestrator's own model (opus), and `verify-tier-calibration.py` will block the dispatch.

**Dynamic tier reclassification:** if reviewer findings on a `dev` L1 Output Packet reveal complexity exceeding the initial `Tier:` (e.g., findings cite invariants, race conditions, or cross-module impact not anticipated in the original tier), the orchestrator MUST update the task's `Tier:` line in `tasks.md` BEFORE dispatching the L2 dev. Append a `Tier-bump note:` line on the task explaining the bump (one line). The L2+ dispatches read the corrected tier. Tier reclassification is logged on the next `actual_dispatches[]` entry's `pm_note` as `"Tier-bump T<X> → T<Y> — <one-line reason>"`.

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

**Four shape variants (closing line varies):**
- **Uniform success** (all tasks done, audit clean): `"Implementation done. Changes are unstaged in the working tree — review with git diff / git status, then commit when ready. Run /ship FEAT-NNN to clean up the session."`
- **Mixed status** (some pending_human, audit clean): `"Partial completion. <N> done, <M> awaiting human decision. Changes are unstaged — review before committing. After resolving the blockers: /orchestrator FEAT-NNN --resume (default) | /orchestrator FEAT-NNN --restart (if prior work is invalidated)."`
- **Full escalate** (all pending_human): `"Pipeline escalated. All tasks blocked. See decision memos at .agent-session/<task_id>/decisions/ and resolve before /orchestrator FEAT-NNN --resume."`
- **Audit-failure handoff** (step 8 returned `blocked` or `escalate` — issue #1 mitigation): emit a refusal handoff, NOT one of the three above. Skeleton:
  ```
  ## Pipeline integrity audit FAILED — handoff refused

  The audit-agent detected that the dispatch manifest does not reconcile with the actual pipeline execution. This usually means the orchestrator bypassed Subagent dispatch and did the work directly (or fabricated outputs).

  ## Audit findings
  | gap_kind                    | severity | ref                                |
  |-----------------------------|----------|------------------------------------|
  | <one row per finding from audit-agent's Output Packet>            |

  ## What to do
  1. Inspect `.agent-session/FEAT-NNN/dispatch-manifest.json` and `outputs/` directly.
  2. If findings reflect a real bypass: discard the working-tree changes (`git restore .`) and re-run `/orchestrator FEAT-NNN --restart`.
  3. If findings are false positives: file an issue with the audit-agent's Output Packet attached (`.agent-session/FEAT-NNN/outputs/<audit-dispatch-id>.json`).
  ```

## Hard rules
- Never: edit any file in the consumer-repo source tree. The orchestrator's writes are restricted to `.agent-session/<task_id>/` (manifest, inputs/, session.yml, handoff.md). All source edits flow through `dev` Subagent dispatches.
- Never: skip step 8 (audit gate). The audit-agent's verdict is binding before any handoff.
- Never: emit a "uniform success" or "mixed status" handoff if the audit-agent returned `blocked` or `escalate`. Emit the audit-failure handoff instead.
- Never: append to `actual_dispatches[]` without a corresponding real `Task` tool dispatch. Manifest entries must be backed by real subagent invocations.
- Always: write the dispatch manifest in step 1b BEFORE any `Task` dispatch. Manifest-first; dispatch-second.
- Always: run the audit gate even on uniform-success runs. The cost is one cheap haiku dispatch; the protection is non-negotiable.

## Failure modes
- **Orchestrator process killed mid-dispatch:** in-flight Subagent's Output Packet may not be merged into `session.yml`. On `--resume`, orchestrator re-reads `outputs/` directory; any Output Packet without a corresponding `task_states` update is replayed (state-merge is idempotent on `dispatch_id`).
- **Output Packet schema validation failure:** treat as `status: blocked, blocker_kind: contract_violation`; cascade to blocker-specialist.
- **Subagent timeout (no Output Packet returned):** treat as `status: blocked, blocker_kind: timeout`; cascade.
- **Fan-out `scope_files` collision** (caught at task-builder time but defense-in-depth here): if 2 `[P]` dispatches reach the same file in flight, second dispatch's `dev` should detect diff conflict and emit `blocked`; orchestrator serializes the retry.
- **Cap hit on a task with `--resume`:** cap counters preserved across resume — they do not reset. Hard cap is hard.
- **Concurrent `/orchestrator` on same `FEAT-NNN`:** undefined behavior. Sole-writer invariant assumes one orchestrator process per Session. Lockfile is TODO Phase 5 — relies on human discipline for MVP.
- **Audit-agent itself bypassed:** mechanically blocked. The orchestrator's frontmatter declares a `Stop` hook (`verify-audit-dispatch.py`) that reads `dispatch-manifest.json` and refuses to allow the orchestrator session to end without an `audit-agent` entry in `actual_dispatches[]` with `status: done`. The hook honors `stop_hook_active` to avoid infinite loops. See `squads/sdd/hooks/verify-audit-dispatch.py`.
- **Orchestrator edits source files directly:** mechanically blocked. The orchestrator's frontmatter declares a `PreToolUse` hook (`guard-session-scope.py`) that denies any `Edit`/`Write`/`MultiEdit` whose path is outside `.agent-session/<task_id>/`. A second `PreToolUse` hook (`block-git-write.py`) denies `Bash` calls running git write commands.
- **Subagent claims `done` without emitting Output Packet:** mechanically blocked. Each Phase 4 Subagent's frontmatter declares a `Stop` hook (`verify-output-packet.py`) that extracts the `dispatch_id` from the transcript and refuses to allow the subagent to finish unless `outputs/<dispatch_id>.json` exists and passes minimum schema checks (required fields + valid status).
- **False-positive audit (clean run flagged as bypass):** recoverable — human reviews `.agent-session/<task_id>/outputs/<audit-dispatch-id>.json`, files the issue, re-runs after fix. Audit-agent is biased toward `blocked` because false-negative defeats the entire layer.

## Why a Skill (not a Subagent)
Subagents in Claude Code cannot spawn other Subagents (platform constraint). The orchestrator must run in the main session to dispatch the workers via the `Task` tool. Also satisfies "dispatches Subagents" criterion (see `shared/concepts/skill-vs-subagent.md`).
