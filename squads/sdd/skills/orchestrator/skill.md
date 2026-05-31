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
        - type: command
          command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py"'
          timeout: 5
---

# Orchestrator — Phase 4 (Implementation)

The Skill that runs the autonomous Implementation Pipeline. Dispatches the 6 Subagents (dev, code-reviewer, logic-reviewer, qa, blocker-specialist, audit-agent) via Claude Code's `Task` tool, enforces caps, and emits one handoff (gated by audit-agent). Runs without the human in-the-loop until handoff.

**Sole writer invariant:** in Phase 4, the orchestrator is the only Skill that writes `session.yml`. Subagents return Output Packets; the orchestrator reads them, merges state, and atomically rewrites `session.yml` (tmp + rename). This eliminates concurrent-write races without file locks (Buck2's single-coordinator pattern).

**Non-edit invariant (issue #1 mitigation):** the orchestrator MUST NOT edit any consumer-repo source file. Its only writes are to `.agent-session/<spec_id>/` (manifest, inputs, session.yml). All source edits flow through `dev` Subagent dispatches. The `audit-agent` (step 8 below) verifies this mechanically before handoff.

## Preflight: verify ai-squad hooks installed (RUN BEFORE ANYTHING ELSE)

Phase 4 dispatches subagents whose PreToolUse/PostToolUse/Stop hooks live in `$CLAUDE_PROJECT_DIR/.claude/hooks/`. PreToolUse hooks (`guard-session-scope`, `block-git-write`, `verify-tier-calibration`) are **not** wrapped fail-open — a missing file there would still crash. Stop hooks are wrapped fail-open as defense in depth, but missing them blinds the audit-agent and usage capture. Refuse to proceed without them.

As your **first action**, run this Bash check exactly once per fresh invocation:

```sh
# Resolve repo root robustly. Claude Code does not always export
# $CLAUDE_PROJECT_DIR into Bash tool calls (only into hook subshells), so
# falling back to git rev-parse / pwd avoids false-positive "MISSING_HOOKS".
repo_root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
hooks_dir="$repo_root/.claude/hooks"
# Use positional parameters ($@) for POSIX-safe iteration. A bare `for f in
# $required` only word-splits in bash; zsh keeps the variable as a single
# string and the loop fires once with the whole list concatenated. Setting
# positional parameters makes the iteration shell-agnostic.
set -- verify-audit-dispatch.py guard-session-scope.py block-git-write.py verify-tier-calibration.py verify-output-packet.py verify-reviewer-write-path.py
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

- `hooks-ok` → proceed to "Refuse when" section below.
- `MISSING_HOOKS:` → **STOP immediately**, surface the exact missing list and the deploy command to the human/PM. Never start dispatching subagents without these hooks. Do not invent workarounds.

Skip this check on `--resume` after the first turn of the same Session has confirmed it.

## When to invoke
- `/orchestrator FEAT-NNN` — fresh start of Phase 4.
- `/orchestrator FEAT-NNN --resume` — resume from `paused` (planned but not started) OR from `escalated` (per-task state preserved). Default behavior when re-invoked on an existing Session.
- `/orchestrator FEAT-NNN --restart` — wipes `.agent-session/<spec_id>/inputs/` and `outputs/` (preserves spec/plan/tasks). Used when human edits invalidated prior work.

## Refuse when
- `implementation` not in `planned_phases` → message: `"Implementation was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec not `status: approved` → message: `"Spec must be approved before /orchestrator."`
- Plan in `planned_phases` but not `status: approved` → message: `"Plan must be approved before /orchestrator."`
- Tasks in `planned_phases` but not `status: approved` → message: `"Tasks must be approved before /orchestrator. Run /task-builder FEAT-NNN to finish them."`
- `session.yml.schema_version` higher than this Skill knows → message: `"Session schema_version <N> newer than this Skill's <M>. Upgrade ai-squad."`

## Inputs (preconditions)
- `.agent-session/<spec_id>/spec.md` (status: approved) — always required.
- `.agent-session/<spec_id>/plan.md` (status: approved) — IF `plan` in `planned_phases`.
- `.agent-session/<spec_id>/tasks.md` (status: approved) — IF `tasks` in `planned_phases`.
- If Plan or Tasks were skipped: orchestrator auto-derives a minimal structure from the Spec (single-task default; flat AC coverage).

## Steps

### 1. Resolve Session and read inputs
1. Determine `spec_id` (explicit arg or current Session from `session.yml`).
2. Read approved Spec/Plan/Tasks (auto-derive if Plan/Tasks were skipped per `planned_phases`).
2a. **Read `session.yml.pipeline_mode`** (defaults to `standard` if absent — pre-v0.7 sessions). Valid values: `lite` | `standard`. The mode governs two clamps applied in this skill:
    - **Fan-out cap (step 3):** `lite` clamps concurrent dispatches to 1 (sequential); `standard` keeps the 5-cap.
    - **Tier ceiling (Model/effort selection):** `lite` clamps every task's effective tier to **T2 max** regardless of `tasks.md` declaration; `standard` honors the declared tier as-is.
    Skip-reviewers markers (per task) are honored in both modes — they are independent of `pipeline_mode`.
2b. **Read `session.yml.output_locale`** (defaults to `en` if absent — legacy
    Sessions). This value is copied verbatim into the stable block of every Work
    Packet (see Dispatch contract) and used to write `handoff.md` (step 9). Enums
    and identifiers in packets stay canonical regardless. See
    [`shared/concepts/output-locale.md`](../../../shared/concepts/output-locale.md).
3. **Preflight: validate `ac_scope` and `Tier:` on every task.** Before any dispatch, iterate every `T-XXX` in `tasks.md`. If any task does not declare an `ac_scope` field (or `ac_scope` is empty), abort with error:
   ```
   "Task <T-XXX> in tasks.md missing required ac_scope field"
   ```
   If any task does not declare a `Tier:` field (values: T1, T2, T3, T4), abort with error:
   ```
   "Task <T-XXX> in tasks.md missing required Tier field — required by orchestrator model/effort calibration"
   ```
   Do NOT dispatch any Subagent until all tasks pass both checks. The `ac_scope` guard exists because tasks without it cannot populate `acScope` in `expected_pipeline[]`, which downstream reviewers and qa rely on to scope their work. The `Tier` guard exists because dispatch model/effort selection is tier-driven (see "Model/effort selection" below); silently defaulting defeats the calibration.
4. Initialize `task_states` map in `session.yml` with one entry per `T-XXX` (state=`pending`, loops=0, hashes=null) — fresh start only; `--resume` preserves existing entries.
5. Set `pipeline_started_at` (or leave intact on `--resume`).

### 1b. Write the dispatch manifest (Outbox + GitHub required-checks pattern)
Before any `Task` dispatch, atomically write `.agent-session/<spec_id>/dispatch-manifest.json` (JSON, not YAML — hook scripts parse this with Python stdlib `json` module, no yaml dependency):

```json
{
  "schema_version": 1,
  "spec_id": "FEAT-NNN",
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
      "task_id": null,
      "role_label": "audit-agent",
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
- `tasksCovered`: for task-scoped roles (dev, code-reviewer, logic-reviewer, qa), always `[task_id]` (single-element array). For `audit-agent`, set to the full list of all `T-XXX` IDs in the pipeline. Both fields are required for the audit-agent reconciliation step.

Atomic write pattern (tmp + rename) on every append. Manifest is the **mechanical audit trail** the audit-agent reconciles in step 8.

On `--resume`: read existing manifest, do NOT re-write `expected_pipeline`; continue appending to `actual_dispatches[]`.

### 2. Build the per-task pipeline graph
For each `T-XXX`:
- Compute the task's edges from `Depends on:` constraints.
- Mark `[P]` tasks as eligible for parallel dispatch within their phase, subject to predecessors being `done`.
- Independent tasks form the **ready queue**; dependent tasks wait until predecessors complete.

### 3. Dispatch loop (capped concurrency = 5, FIFO overflow queue)

**Single-turn fan-out rule (read this before reading anything else):** in Claude Code, parallelism happens ONLY when multiple `Task` tool calls are issued in the SAME assistant turn (one response with N tool_use blocks). Issuing dispatches across separate turns — even inside the same loop iteration — runs them serially. Whenever you have ≥2 dispatches ready, you MUST batch them in a single turn.

**Mode-aware fan-out cap:**
- `standard` mode: **5 concurrent dispatches** per turn (default).
- `lite` mode: **1 dispatch** per turn (sequential pipeline by design — lite implies single-purpose changes where parallel coordination overhead exceeds benefit).

The single-turn rule still applies in `lite` mode for the reviewers fan-out within a task (code-reviewer + logic-reviewer in one turn when both are dispatched), unless the task carries a `Skip reviewers:` marker.

While ready queue is non-empty OR any task is in-flight:
- Take up to **N dispatches** from the ready queue (N = 5 for `standard`, N = 1 for `lite`; Anthropic's empirical 3-5 fan-out sweet spot per their multi-agent research blog; well under Claude Code's hard 10-cap; quota-friendly for Max 5x). Build the Work Packet for each.
- **Issue all N `Task` tool calls in a single assistant turn** — one response containing N tool_use blocks. Never dispatch one, wait for return, then dispatch the next: that defeats the entire fan-out and is the most common cause of slow pipelines.
- Tasks beyond 5 wait in FIFO queue; queue refills only after the in-flight batch returns.
- When the batch returns (all N Output Packets in hand): for each, run step 4 (state merge), step 5 (progress check), step 6 (cascade routing if needed). Then re-evaluate ready queue and issue the next batch — again, all in one turn.

### 4. Per-task state machine (orchestrator-managed, atomic write)
Each task transitions through: `pending` → `running` → (`done` | `blocked` | `pending_human` | `failed`).

Pipeline per task (per `squads/sdd/docs/concepts/pipeline.md`):
- Dispatch `dev`. On `dev` Output Packet `status: done`: dispatch `code-reviewer` and `logic-reviewer` in parallel. **Single-turn rule:** issue BOTH `Task` tool calls in the SAME assistant turn (one response with two tool_use blocks). Do NOT wait for the first reviewer to return before issuing the second — that serializes the fan-out and doubles wall-clock per task. Both count against the 5-cap.
- If reviewers return findings: loop to `dev` (cap: `review_loops_max=3`).
- If reviewers conflict on same `file:line`: cascade to `blocker-specialist`.
- On reviewers clean: dispatch `qa`.
- On `qa` fail: loop to `dev` (cap: `qa_loops_max=2`, skips reviewers).
- On any cap hit OR `status: blocked` from any Subagent: cascade to `blocker-specialist` (cap: `blocker_calls_max=2` per task).

### Reviewer mandatoriness (FEAT-008 Gap B)

Code-reviewer e logic-reviewer são **mandatórios** entre `dev` e `qa` para toda task do tipo dev. Pular CR/LR sem registro explícito é proibido — `verify-pipeline-completeness.py` (PreToolUse Task) bloqueia o `qa` dispatch caso CR + LR não tenham status `done` ou `needs_review` no manifesto pra mesma `task_id`.

**Exceção explícita:** quando o PM/orchestrator avalia que o custo dos reviewers não se justifica para uma task específica (e.g. one-line fix, doc-only edit), pode declarar isenção em `tasks.md` na seção da task:

```markdown
## T-XXX titulo

**Tier:** T1
**Skip reviewers:** budget — single-line docs typo fix, no logic surface
```

O marker libera o `qa` gate. Sem o marker, qualquer skip é bloqueado. Esta exceção é audit-visible: audit-agent reporta tasks com skip-reviewers como `pipeline_stage_skipped` finding (severity `warning`, not blocker).

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
spec_id: FEAT-NNN
dispatch_id: <uuid>
manifest_ref: .agent-session/FEAT-NNN/dispatch-manifest.json
outputs_dir_ref: .agent-session/FEAT-NNN/outputs/
tasks_ref: .agent-session/FEAT-NNN/tasks.md
spec_ref: .agent-session/FEAT-NNN/spec.md
```
Append the audit-agent's own dispatch to `actual_dispatches[]`. The audit-agent runs the 6 reconciliation checks (see `agents/audit-agent.md`).

Branch on the audit-agent's Output Packet:
- **`status: done`** (all checks pass) → proceed to step 9 (handoff).
- **`status: blocked`** (ANY `blocker_kind`) → DO NOT emit normal handoff. Set `current_phase: escalated`. Emit a **refusal handoff** (see "Audit-failure handoff" below) listing every finding, and select the handoff narrative by `blocker_kind`. Save to `.agent-session/<spec_id>/handoff.md`. Stop. Do not infer or special-case a single `blocker_kind` — the audit-agent always populates it (enforced by the schema + write hook), so read it and branch:
  - `bypass_detected` → bypass/forgery narrative (orchestrator did work directly or fabricated outputs).
  - `schema_violation` → artifact-format narrative (the pipeline ran but one or more Output Packets are malformed; this is recoverable by `--restart`, NOT a bypass — do not accuse the pipeline of fabrication).
  - `pipeline_stage_skipped` → missing-stage narrative (a required stage did not run for some task).
  - any other / `incomplete_audit` → generic refusal narrative.
- **`status: escalate`** (audit itself could not run — manifest unreadable, etc.; `blocker_kind: audit_inconclusive`) → set `current_phase: escalated`; emit refusal handoff with audit-agent's blockers. Stop.

The audit-agent's verdict is binding **and terminal**. On `blocked`/`escalate`, the orchestrator MUST NOT: (a) emit a "uniform success" or "mixed status" handoff; (b) edit, patch, or rewrite any file under `outputs/` to make the audit pass — those are subagent-authored evidence, and `guard-session-scope.py` blocks it mechanically; or (c) re-dispatch `audit-agent` in the same run for a second opinion. The ONLY recovery is human review + `/orchestrator FEAT-NNN --restart` (which wipes `outputs/` and re-runs the real subagents). Re-running the audit over hand-edited packets was the FEAT-010 failure — 4 audit runs until it flipped to `done`.

### 9. Pipeline-end handoff (only if step 8 passed)
- Set `current_phase` per outcome (`done` if all tasks done; `escalated` if any pending_human; `paused` if `--resume` aborted mid-flight).
- **Cost report.** Before emitting the handoff (you have write authority; the read-only audit-agent does not):
  1. **Backfill any missed capture.** Recover this session's subagent transcripts and run the write-capable backfill so a missed `SubagentStop` is recovered (the cost runtime is vendored in the per-repo hooks dir, so it resolves in any consumer repo). `session_transcripts` scopes to THIS session's `subagents/` dir (anchored from already-captured `costs/agent-*.json`) — never a machine-wide `projects/*/*` glob, which used to pull in other projects' agents and inflate the total:
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
  2. **Emit the report:** `python3 .claude/hooks/cost-report.py <spec_id>` — writes `.agent-session/<spec_id>/cost-report.json` and prints the planning/orchestration/implementation table.
  3. Include the one-line total in the handoff message, and if the audit raised `cost_capture_incomplete` OR the report's `complete` is false, flag the gap (unpriced models / uncaptured agents) explicitly — never present an incomplete total as final.
- Emit handoff message (see "Handoff" section); also save to `.agent-session/<spec_id>/handoff.md`. **Write the handoff prose in `session.yml.output_locale`** (the narrative sentences, the Summary/Validation/Follow-ups bullets). Keep the fixed skeleton — section headers, the Conventional Commits title `type(scope):`, table column keys, enum values (`done`/`pending_human`), and identifiers — canonical (English); only the prose follows the locale. Absent → `en`.

## Dispatch contract (Work Packet embedded in `Task` prompt)
Claude Code's `Task` tool accepts: `subagent_type` (string, must match a file in `agents/`), `description` (short), `prompt` (free-form string), AND `model` (enum: `sonnet` | `opus` | `haiku`). The `model` parameter is **mandatory for tiered roles** (`dev`, `code-reviewer`, `logic-reviewer`, `qa`) — see "Task tool `model` parameter" below. The Work Packet is embedded as a fenced YAML block inside `prompt`:

```
WorkPacket:
```yaml
# --- Stable block (cache-friendly prefix; keep order identical across all dispatches in this Session) ---
spec_id: FEAT-NNN        # the feature/Session id (FEAT-007); used by hooks for direct lookup. (Legacy alias: session_id — readers accept both.)
spec_ref: ./.agent-session/FEAT-NNN/spec.md
plan_ref: ./.agent-session/FEAT-NNN/plan.md
tasks_ref: ./.agent-session/FEAT-NNN/tasks.md
output_locale: pt-BR     # from session.yml; language of human-facing prose. Absent → en. Stable across dispatches.
project_context:
  standards_ref: ./CLAUDE.md
# --- Variable block (per-dispatch — placed AFTER stable block so prefix matches across dispatches) ---
task_id: T-XXX
dispatch_id: <uuid>
model: sonnet            # set by orchestrator from Tier × Loop table
effort: high             # set by orchestrator from Tier × Loop table
tier: T3                 # echoed for traceability; source of truth is tasks.md
ac_scope: [AC-001, AC-003]
scope_files: [src/auth/login.ts]
previous_findings: <path-or-null>
```
```

The Subagent body's "Input contract" specifies which fields are required for that Role. Missing fields → Subagent emits `status: blocked, blocker_kind: contract_violation`.

**`session_id` (FEAT-007):** mandatory for task-scoped dispatches (`dev`, `code-reviewer`, `logic-reviewer`, `qa`); optional for `audit-agent` (pipeline-scoped). Derived from the orchestrator's cwd — when running from `.agent-session/<FEAT-NNN>/`, emit `session_id: FEAT-NNN`. The `verify-tier-calibration.py` hook uses it for direct `<session_dir>/<session_id>/tasks.md` lookup; without it the hook falls back to mtime-ordered manifest scanning (legacy backward-compat path, slower).

### Task tool `model` parameter (run-model enforcement — AC-009)
**The `model` parameter of the Task tool itself controls the actual run-model of the subagent.** The Work Packet YAML is descriptive metadata — it does NOT control which model runs the subagent. If the orchestrator omits the Task tool's `model` parameter, Claude Code inherits the parent session's model (the orchestrator's own model, typically `opus`), bypassing the Tier × Loop table entirely. This was the root cause of severe cost amplification observed in early FEAT-* sessions (tasks calibrated for a cheap model running in `opus`, multiplying real cost 3-12×).

**Invariant:** for every `dev` / `code-reviewer` / `logic-reviewer` / `qa` dispatch, the orchestrator MUST pass the `model` parameter to the Task tool with the exact canonical model value derived from the Tier × Loop table (see algorithm below). The `verify-tier-calibration.py` PreToolUse hook enforces this: dispatches without `model`, or with a wrong `model`, are blocked with `task_tool_model_missing` / `task_tool_model_mismatch` before they run.

**Tier-independent roles** (`audit-agent`, `blocker-specialist`) are exempt — the hook short-circuits for these roles. Pass their `model` per their subagent file's frontmatter (haiku and opus respectively) for clarity, but the hook will not block if you omit it.

**Effort:** the Task tool does not accept an `effort` parameter. Effort is communicated to the subagent via the Work Packet YAML (`effort: high|medium|low|xhigh`) so the subagent body can adjust its own thinking depth. Hook still validates Work Packet `effort` against the canonical table (AC-005).

### Model/effort selection (canonical Tier × Loop enforcement)
On every Subagent dispatch, the orchestrator MUST (a) pass the Task tool `model` parameter AND (b) populate the Work Packet `model` and `effort` fields, all per the canonical Tier × Loop table below. The Subagent frontmatter default is the documentation-only fallback — never trust it to be honored at runtime.

**Canonical Tier × Loop table (inlined from [`shared/concepts/effort.md`](../../../shared/concepts/effort.md) — keep in sync):**

| Step / Role            | Description                                | T1 — Procedural | T2 — Pattern    | T3 — Judgement  | T4 — Core complex |
|------------------------|--------------------------------------------|-----------------|-----------------|-----------------|-------------------|
| **dev L1**             | First implementation                       | haiku, high     | sonnet, medium  | sonnet, high    | sonnet, high      |
| **dev L2**             | Retry with `previous_findings` from reviewer | sonnet, medium ¹ | sonnet, high ¹  | sonnet, high    | sonnet, high      |
| **dev L3**             | Final retry (`review_loops_max = 3`)       | sonnet, high ¹  | sonnet, high    | sonnet, high    | **opus, high** ²  |
| **dev qa-L1**          | Retry after qa fail (skips reviewers)      | sonnet, medium  | sonnet, high    | sonnet, high    | sonnet, high      |
| **dev qa-L2**          | Final retry after qa fail                  | sonnet, high    | sonnet, high    | sonnet, high    | **opus, high** ²  |
| **code-reviewer**      | Any loop (L1/L2/L3)                        | sonnet, medium  | sonnet, medium  | sonnet, medium  | sonnet, medium    |
| **logic-reviewer**     | Any loop (L1/L2/L3)                        | sonnet, medium  | sonnet, medium  | sonnet, high    | opus, high        |
| **qa**                 | Any attempt                                | sonnet, medium  | sonnet, medium  | sonnet, medium  | **sonnet, high**  |
| **blocker-specialist** | Any trigger (cap, stall, conflict)         | opus, xhigh ³   | opus, xhigh ³   | opus, xhigh ³   | opus, xhigh ³     |
| **audit-agent**        | Singleton pre-handoff                      | haiku, medium ⁴ | haiku, medium ⁴ | haiku, medium ⁴ | haiku, medium ⁴   |

¹ Subir tier do `dev` quando há `previous_findings` carregado — contexto mais rico exige modelo mais forte para não repetir o erro do loop anterior.
² Última chance em core complex: opus **high** (não medium). Economizar effort aqui é exatamente onde débito técnico entra.
³ Blocker é raro e alta aposta — opus xhigh sempre. Custo agregado fica baixo porque dispatch frequency é low.
⁴ Audit é reconciliação mecânica de manifesto vs outputs — haiku medium é o ponto certo. Subir desperdiça quota.

**Tier definitions (operational):**

| Tier | Definition | Example |
|------|-----------|---------|
| **T1 — Procedural** | Single path, no design decision, no non-obvious invariant | Rename, add field, copy existing pattern |
| **T2 — Pattern** | Established repo pattern, 1–2 local decisions | Endpoint mirroring existing endpoints |
| **T3 — Judgement** | Multiple design decisions, cross-file impact | New auth flow, module refactor |
| **T4 — Core complex** | Domain invariant, concurrency, security, data migration, public contract. Error = incident | Schema migration, lock manager, RBAC core |

Tie-break: when in doubt between two tiers, escalate to the higher one.

**Algorithm:**
1. Read the task's `Tier:` field from `tasks.md` (values: `T1`, `T2`, `T3`, `T4`). If absent → abort with error `"Task <T-XXX> in tasks.md missing required Tier field — required by orchestrator model/effort calibration"`. Do NOT silently default; that defeats the calibration.
1a. **Lite-mode tier clamp:** if `session.yml.pipeline_mode == "lite"` AND the declared `Tier:` is `T3` or `T4`, **clamp to `T2`** for this dispatch and record `pm_note: "Lite-mode tier clamp T<X> → T2"` on the `actual_dispatches[]` entry. The clamp is per-dispatch (transient) and does NOT rewrite `tasks.md`. If reviewer findings later trigger dynamic tier reclassification beyond T2 (e.g., race condition surfaced), the orchestrator MUST switch the Session out of `lite` mode (atomic write to `session.yml.pipeline_mode = "standard"`) before dispatching the bumped tier — lite is a budget contract; breaking it requires explicit mode change.
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

**Concrete Task tool call (canonical example for a qa T1 dispatch):**
```
Task(
  subagent_type="qa",
  model="haiku",              # ← REQUIRED — derived from Tier × Loop table
  description="QA validation for T-001",
  prompt='''WorkPacket:
```yaml
# Stable block (cache-friendly prefix)
session_id: FEAT-NNN
spec_ref: ./.agent-session/FEAT-NNN/spec.md
plan_ref: ./.agent-session/FEAT-NNN/plan.md
tasks_ref: ./.agent-session/FEAT-NNN/tasks.md
output_locale: pt-BR
project_context:
  standards_ref: ./CLAUDE.md
# Variable block (per-dispatch)
task_id: T-001
dispatch_id: d-T-001-qa-l1
model: haiku
effort: high
tier: T1
subagent_type: qa
ac_scope: [AC-001]
scope_files: [src/auth/login.ts]
previous_findings: null
```
'''
)
```
Omitting `model="haiku"` causes the subagent to run on the orchestrator's own model (opus), and `verify-tier-calibration.py` will block the dispatch.

**Dynamic tier reclassification:** if reviewer findings on a `dev` L1 Output Packet reveal complexity exceeding the initial `Tier:` (e.g., findings cite invariants, race conditions, or cross-module impact not anticipated in the original tier), the orchestrator MUST update the task's `Tier:` line in `tasks.md` BEFORE dispatching the L2 dev. Append a `Tier-bump note:` line on the task explaining the bump (one line). The L2+ dispatches read the corrected tier. Tier reclassification is logged on the next `actual_dispatches[]` entry's `pm_note` as `"Tier-bump T<X> → T<Y> — <one-line reason>"`.

### Prompt caching strategy (subagent dispatch efficiency)

Every Phase 4 dispatch reuses the same large context: `spec.md` + `plan.md` + `tasks.md` + `CLAUDE.md`. Across a typical pipeline (N tasks × 4-5 roles), that block is consumed 20-50+ times. Without a stable prefix, every dispatch re-pays the full token cost. With a stable prefix, Anthropic's ephemeral prompt cache (5-min TTL) lets all dispatches after the first hit cache.

**Rules:**
- Embed the **stable context** (`spec_ref`, `plan_ref`, `tasks_ref`, `CLAUDE.md` path / standards_ref) near the TOP of the Work Packet `prompt`, before any per-dispatch fields. The cache keys on the longest matching prefix — variable content high up defeats the cache.
- Per-dispatch unique fields (`dispatch_id`, `previous_findings`, `ac_scope`, `scope_files`) go at the END of the Work Packet.
- Keep YAML field order identical across dispatches in the same Session. Reordering breaks the prefix match.
- Do NOT interleave variable and stable fields.

The orchestrator's responsibility is prefix stability; Claude Code's runtime applies `cache_control` automatically when the prefix matches. No explicit cache markers needed in the Work Packet.

## Output
- Per dispatch: Work Packet snapshot at `.agent-session/<spec_id>/inputs/<dispatch_id>.json` (orchestrator writes for traceability); Output Packet at `.agent-session/<spec_id>/outputs/<dispatch_id>.json` (Subagent writes via atomic write).
- Per task: state machine in `session.yml.task_states[T-XXX]`.
- Pipeline-level: `session.yml` fields (`pipeline_started_at`, `pipeline_completed_at`, `escalation_metrics`).
- Final: human-readable handoff Markdown printed to console + saved to `.agent-session/<spec_id>/handoff.md`.

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
- **Full escalate** (all pending_human): `"Pipeline escalated. All tasks blocked. See decision memos at .agent-session/<spec_id>/decisions/ and resolve before /orchestrator FEAT-NNN --resume."`
- **Audit-failure handoff** (step 8 returned `blocked` or `escalate` — issue #1 mitigation): emit a refusal handoff, NOT one of the three above. The opening line varies by the audit-agent's `blocker_kind` (do NOT default to the bypass narrative — it is wrong and alarming for a format defect). Skeleton:
  ```
  ## Pipeline integrity audit FAILED — handoff refused

  <opening line, selected by blocker_kind:>
  - bypass_detected:   The dispatch manifest does not reconcile with actual execution — the orchestrator likely bypassed Subagent dispatch and did the work directly (or fabricated outputs).
  - schema_violation:  The pipeline ran and the work may be correct, but one or more Output Packets are malformed (missing required fields). This is an artifact-format defect, not a bypass.
  - pipeline_stage_skipped: A required pipeline stage did not run for one or more tasks.
  - audit_inconclusive / other: The audit gate could not confirm pipeline integrity (see findings).

  ## Audit findings
  | gap_kind                    | severity | ref                                |
  |-----------------------------|----------|------------------------------------|
  | <one row per finding from audit-agent's Output Packet>            |

  ## What to do
  1. Inspect `.agent-session/FEAT-NNN/dispatch-manifest.json` and `outputs/` directly.
  2. For `bypass_detected`: if findings reflect a real bypass, discard the working-tree changes (`git restore .`) and re-run `/orchestrator FEAT-NNN --restart`.
  2b. For `schema_violation`: the source changes are likely sound; re-run `/orchestrator FEAT-NNN --restart` to re-dispatch the real subagents so they re-emit well-formed packets (do NOT hand-edit packets under `outputs/` — `guard-session-scope.py` blocks it and it was the FEAT-010 gaming pattern).
  3. If findings are false positives: file an issue with the audit-agent's Output Packet attached (`.agent-session/FEAT-NNN/outputs/<audit-dispatch-id>.json`).
  ```

## Hard rules
- Never: edit any file in the consumer-repo source tree. The orchestrator's writes are restricted to `.agent-session/<spec_id>/` (manifest, inputs/, session.yml, handoff.md). All source edits flow through `dev` Subagent dispatches.
- Never: skip step 8 (audit gate). The audit-agent's verdict is binding before any handoff.
- Never: edit, patch, or rewrite any file under `.agent-session/<spec_id>/outputs/` — those are subagent-authored Output Packets (evidence). A `blocked` audit is terminal; recover via `/orchestrator FEAT-NNN --restart`, never by editing packets. Mechanically blocked by `guard-session-scope.py`.
- Never: re-dispatch `audit-agent` in the same run to flip a `blocked` verdict to `done`. One audit per run; the verdict is terminal. (Re-running over hand-edited packets was the FEAT-010 failure.)
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
- **Orchestrator edits source files directly:** mechanically blocked. The orchestrator's frontmatter declares a `PreToolUse` hook (`guard-session-scope.py`) that denies any `Edit`/`Write`/`MultiEdit` whose path is outside `.agent-session/<spec_id>/`. A second `PreToolUse` hook (`block-git-write.py`) denies `Bash` calls running git write commands.
- **Subagent claims `done` without emitting Output Packet:** mechanically blocked. Each Phase 4 Subagent's frontmatter declares a `Stop` hook (`verify-output-packet.py`) that extracts the `dispatch_id` from the transcript and refuses to allow the subagent to finish unless `outputs/<dispatch_id>.json` exists and passes minimum schema checks (required fields + valid status).
- **False-positive audit (clean run flagged as bypass):** recoverable — human reviews `.agent-session/<spec_id>/outputs/<audit-dispatch-id>.json`, files the issue, re-runs after fix. Audit-agent is biased toward `blocked` because false-negative defeats the entire layer.

## Why a Skill (not a Subagent)
Subagents in Claude Code cannot spawn other Subagents (platform constraint). The orchestrator must run in the main session to dispatch the workers via the `Task` tool. Also satisfies "dispatches Subagents" criterion (see `shared/concepts/skill-vs-subagent.md`).
