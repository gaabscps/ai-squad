# Dispatch contract — Work Packet, model parameter, caching

Referenced from `skill.md` step 3 / the Dispatch loop. Model + effort values come from [`model-effort-calibration.md`](model-effort-calibration.md).

## Work Packet (embedded in the `Task` prompt)
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

## Task tool `model` parameter (run-model enforcement — AC-009)
**The `model` parameter of the Task tool itself controls the actual run-model of the subagent.** The Work Packet YAML is descriptive metadata — it does NOT control which model runs the subagent. If the orchestrator omits the Task tool's `model` parameter, Claude Code inherits the parent session's model (the orchestrator's own model, typically `opus`), bypassing the Tier × Loop table entirely. This was the root cause of severe cost amplification observed in early FEAT-* sessions (tasks calibrated for a cheap model running in `opus`, multiplying real cost 3-12×).

**Invariant:** for every `dev` / `code-reviewer` / `logic-reviewer` / `qa` dispatch, the orchestrator MUST pass the `model` parameter to the Task tool with the exact canonical model value derived from the Tier × Loop table. The `verify-tier-calibration.py` PreToolUse hook enforces this: dispatches without `model`, or with a wrong `model`, are blocked with `task_tool_model_missing` / `task_tool_model_mismatch` before they run.

**Tier-independent roles** (`audit-agent`, `blocker-specialist`) are exempt — the hook short-circuits for these roles. Pass their `model` per their subagent file's frontmatter (haiku and opus respectively) for clarity, but the hook will not block if you omit it.

**Effort:** the Task tool does not accept an `effort` parameter. Effort is communicated to the subagent via the Work Packet YAML (`effort: high|medium|low|xhigh`) so the subagent body can adjust its own thinking depth. Hook still validates Work Packet `effort` against the canonical table (AC-005).

## Prompt caching strategy (subagent dispatch efficiency)
Every Phase 4 dispatch reuses the same large context: `spec.md` + `plan.md` + `tasks.md` + `CLAUDE.md`. Across a typical pipeline (N tasks × 4-5 roles), that block is consumed 20-50+ times. Without a stable prefix, every dispatch re-pays the full token cost. With a stable prefix, Anthropic's ephemeral prompt cache (5-min TTL) lets all dispatches after the first hit cache.

**Rules:**
- Embed the **stable context** (`spec_ref`, `plan_ref`, `tasks_ref`, `CLAUDE.md` path / standards_ref) near the TOP of the Work Packet `prompt`, before any per-dispatch fields. The cache keys on the longest matching prefix — variable content high up defeats the cache.
- Per-dispatch unique fields (`dispatch_id`, `previous_findings`, `ac_scope`, `scope_files`) go at the END of the Work Packet.
- Keep YAML field order identical across dispatches in the same Session. Reordering breaks the prefix match.
- Do NOT interleave variable and stable fields.

The orchestrator's responsibility is prefix stability; Claude Code's runtime applies `cache_control` automatically when the prefix matches. No explicit cache markers needed in the Work Packet.
