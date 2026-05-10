# Design: AgentOps Full Report Population

**Date:** 2026-05-10  
**Status:** Approved  
**Scope:** Eliminate all `—` and `n/a` values from the agentops HTML/MD report

---

## Problem

The agentops report renders 5 columns/sections with no data today:

| Field | Where shown | Root cause |
|-------|-------------|------------|
| Duration per dispatch | Per-dispatch table | Agentops reads `usage.duration_ms`; no fallback to timestamps |
| Loop count | Per-dispatch table | Orchestrator never writes `loop` to manifest |
| PM note | Per-dispatch table | Orchestrator never writes `pm_note` to manifest |
| Tokens + cost | Per-dispatch table + cost section | No mechanism captures subagent token usage |
| Wall-clock duration (cost section) | Cost breakdown | Same as tokens — `usage` absent |

---

## Solution Overview

4 independent fixes across 3 layers:

| Fix | Layer | Files |
|-----|-------|-------|
| Duration fallback | Agentops renderer | `packages/agentops/src/render/flow-report/per-dispatch-table.ts` |
| Loop + PM note | Orchestrator skill | `squads/sdd/skills/orchestrator/skill.md` |
| Hook 1: stamp session_id | New Python hook | `squads/sdd/hooks/stamp-session-id.py` |
| Hook 2: capture tokens | New Python hook | `squads/sdd/hooks/capture-subagent-usage.py` |

---

## Data Flow

```
Subagent writes output packet  (Write/Edit tool)
  → Hook 1 (PostToolUse) injects "_session_id" into the JSON file

Subagent stops
  → Hook 2 (Stop) reads session_id from payload
  → finds output packet where _session_id == session_id  ← exact 1:1 correlation
  → reads transcript_path, sums tokens per assistant turn
  → acquires flock on manifest
  → updates manifest actual_dispatches[] entry with usage{}

Orchestrator records dispatch completion
  → writes loop: <n> from session.yml task_states[T-XXX].loops
  → writes pm_note: "<text>" for notable events; null otherwise

Agentops reads manifest
  → usage.duration_ms present → use it
  → usage.duration_ms absent  → fallback: completedAt - startedAt
  → usage.total_tokens, cost_usd → Tokens/$ columns
  → loop, pm_note → Loop/PM note columns
```

---

## Component Specifications

### Fix 1 — Duration fallback in agentops

**File:** `packages/agentops/src/render/flow-report/per-dispatch-table.ts` line ~74

**Change:** When `d.usage` is absent, compute duration from timestamps:

```ts
const duration = d.usage
  ? fmtMs(d.usage.duration_ms)
  : d.completedAt && d.startedAt
    ? fmtMs(new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime())
    : '—';
```

The `fmtMs` helper already exists in the file.

---

### Fix 2 — Orchestrator skill: loop + pm_note

**File:** `squads/sdd/skills/orchestrator/skill.md`

**Change:** In the "After every Task tool dispatch, append to actual_dispatches[]" section, add two fields:

```json
{
  "dispatch_id": "...",
  "task_id": "...",
  "role": "...",
  "started_at": "...",
  "completed_at": "...",
  "output_packet_ref": "...",
  "status": "...",
  "loop": 1,
  "pm_note": null
}
```

- `loop`: value of `task_states[T-XXX].loops` at the time of recording (integer, 1-indexed — loop 1 = first attempt)
- `pm_note`: non-null string only for notable events:
  - loop restart: `"Loop N restart — reviewer findings: <summary>"`
  - qa fail loop: `"QA fail loop N — <ac_ids failed>"`
  - escalation: `"Escalated to blocker-specialist — <trigger>"`
  - progress stall: `"Progress stall detected (fingerprint match)"`
  - null for all other dispatches

---

### Fix 3 — Hook 1: stamp-session-id.py

**File:** `squads/sdd/hooks/stamp-session-id.py`  
**Trigger:** PostToolUse on `Write` or `Edit`  
**Condition:** `file_path` matches `*/outputs/d-*.json`

**Logic:**
1. Read `session_id` from stdin payload
2. Read `tool_name` and `file_path` from payload
3. Skip if `tool_name` not in `{"Write", "Edit"}`
4. Skip if `file_path` does not match `*/outputs/d-*.json`
5. Read the JSON file that was just written
6. If `_session_id` already present, skip (idempotent)
7. Add `"_session_id": session_id` to the JSON object
8. Write back to same path
9. Return `{}` — never block

**Error handling:** Any exception → print to stderr, return `{}`. Never block the tool.

---

### Fix 4 — Hook 2: capture-subagent-usage.py

**File:** `squads/sdd/hooks/capture-subagent-usage.py`  
**Trigger:** Stop hook (all sessions)

**Logic:**
1. Read payload from stdin: `session_id`, `transcript_path`, `cwd`, `stop_hook_active`
2. Skip if `stop_hook_active == true`
3. Resolve project root via `resolve_project_root(payload)` (reuse `hook_runtime.py`)
4. Find active session dir (most recently modified dir under `.agent-session/`)
5. Scan `outputs/` for any file where `_session_id == session_id`
6. If no match found → orchestrator session or no output packet written → return `{}`
7. Read `dispatch_id` from matched output packet
8. Find corresponding entry in `actual_dispatches[]` by `dispatch_id`
9. If entry already has `usage` → skip (idempotent)
10. Parse `transcript_path` as JSONL, for each line:
    - If `type == "assistant"` and `message.usage` present: accumulate tokens
    - Count `tool_use` blocks in `message.content[]`
    - Read `model` from first assistant turn
11. Compute `duration_ms` = `completed_at - started_at` from manifest entry (already present)
12. Build `usage` object:
    ```json
    {
      "total_tokens": <sum>,
      "input_tokens": <sum>,
      "output_tokens": <sum>,
      "cache_creation_input_tokens": <sum>,
      "cache_read_input_tokens": <sum>,
      "tool_uses": <count>,
      "duration_ms": <computed>,
      "model": "<first assistant model>"
    }
    ```
13. Acquire `fcntl.flock(LOCK_EX)` on manifest file
14. Update `actual_dispatches[]` entry with `usage`
15. Write manifest back
16. Release lock
17. Return `{}` — never block

**Error handling:** Any exception at any step → print to stderr, return `{}`.

---

### Fix 5 — Wire hooks in settings.json

**File:** `.claude/settings.json`

Add to the `hooks` section:

```json
{
  "PostToolUse": [
    {
      "matcher": "Write|Edit",
      "hooks": [{
        "type": "command",
        "command": "python3 squads/sdd/hooks/stamp-session-id.py"
      }]
    }
  ],
  "Stop": [
    {
      "hooks": [{
        "type": "command",
        "command": "python3 squads/sdd/hooks/capture-subagent-usage.py"
      }]
    }
  ]
}
```

---

## Data Contract

### manifest actual_dispatches[] entry (updated)

```json
{
  "dispatch_id": "d-t001-dev-01",
  "task_id": "T-001",
  "role": "dev",
  "status": "done",
  "started_at": "2026-05-09T21:30:00Z",
  "completed_at": "2026-05-09T21:34:00Z",
  "output_packet_ref": "outputs/d-t001-dev-01.json",
  "loop": 1,
  "pm_note": null,
  "usage": {
    "total_tokens": 42800,
    "input_tokens": 38000,
    "output_tokens": 4800,
    "cache_creation_input_tokens": 12000,
    "cache_read_input_tokens": 25000,
    "tool_uses": 14,
    "duration_ms": 240000,
    "model": "sonnet-4-6"
  }
}
```

`cost_usd` is NOT written to the manifest. Agentops computes it in-memory at render time via `attachCostUsd()` using `ANTHROPIC_PRICING_2026` — the manifest stores token counts only.

### Output packet (updated, `_session_id` is infra metadata)

```json
{
  "dispatch_id": "d-t001-dev-01",
  "role": "dev",
  "status": "done",
  "_session_id": "abc123ef-4567-...",
  "summary": "...",
  "evidence": []
}
```

`_session_id` is prefixed with `_` to signal infrastructure metadata. Not validated by `output-packet.schema.json`. Ignored by audit-agent and agentops parser.

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Subagent fails before writing output packet | `_session_id` never injected → Hook 2 finds no match → manifest entry stays without `usage` |
| Orchestrator session triggers Hook 2 | No output packet with matching `_session_id` → skip |
| Two subagents finish at same time | `flock(LOCK_EX)` serializes manifest writes — no data corruption |
| Transcript JSONL malformed | Exception caught → stderr log → `{}` returned, pipeline not blocked |
| `_session_id` already present (re-run) | Hook 1 skips (idempotent check) |
| `usage` already in manifest (re-run) | Hook 2 skips (idempotent check) |
| Subagent writes output packet via multiple Edit calls | Hook 1 fires on each; idempotent — only first write stamps `_session_id` |

---

## Files Changed

| File | Change type |
|------|-------------|
| `packages/agentops/src/render/flow-report/per-dispatch-table.ts` | Edit — duration fallback |
| `squads/sdd/skills/orchestrator/skill.md` | Edit — add loop + pm_note to dispatch recording |
| `squads/sdd/hooks/stamp-session-id.py` | New file |
| `squads/sdd/hooks/capture-subagent-usage.py` | New file |
| `.claude/settings.json` | Edit — wire PostToolUse + Stop hooks |

---

## Out of Scope

- `repo health` section (mutation testing, type-coverage, arch:check) — intentionally manual
- Backfilling token data for past sessions (FEAT-001) — historical data, not part of this fix
- `cost_usd` written by hook — computed by agentops renderer from pricing table
