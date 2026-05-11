# Verification Runbook: FEAT-002 Fixes Against calendarfr FEAT-009/010/011

## Purpose

After FEAT-002 ships, validate that the dispatch-side gaps—missing qa/reviewer Output Packets, missing pm-orchestrator token capture in worktrees, and missing `review_loop` annotation—surface correctly when regenerating agentops reports for the three known-broken calendarfr sessions.

This runbook confirms fixes work end-to-end against real (not synthetic fixture) failure cases, validating AC-010: either previously-empty report fields are now populated with real data, OR audit-agent surfaces a clear failure listing missing Output Packets by dispatch_id (never silently rendering `—` / `missing` / cost-proxy fallback).

## Prerequisites

1. **ai-squad deployed** at the latest version containing FEAT-002 changes:
   - `./tools/deploy.sh` has been run against the consumer repo (calendarfr).
   - Verify: `cat .claude/settings.local.json | grep -A 5 "verify-output-packet"` shows the updated hook with role-aware required-fields.
   - Verify: `cat .claude/settings.local.json | grep -A 5 "capture-pm-session"` exists and references worktree-safe logic.

2. **agentops hooks installed** in the consumer repo (calendarfr):
   - Run: `npm exec @ai-squad/agentops -- install-hooks` from the consumer repo root.
   - Verify: `.claude/settings.local.json` (and `.claude/settings.local.json` inside any `.claude/worktrees/*/` if FEAT-009/010/011 sessions ran in worktrees) contains the `verify-output-packet.py` and `capture-pm-session.ts` Stop hook registrations.

3. **Session artifacts available**:
   - `.agent-session/FEAT-009/`, `.agent-session/FEAT-010/`, `.agent-session/FEAT-011/` directories exist in calendarfr with their `dispatch-manifest.json`, `session.yml`, and `outputs/` subdirectories intact.

## Steps

### 1. Regenerate the FEAT-009 report

```bash
cd /path/to/calendarfr
npm run agentops:report -- FEAT-009
```

**Expected outcome:**
- If FEAT-009's session was missing qa Output Packet(s), audit-agent should **fail** with a message naming the dispatch_id(s). Example:
  ```
  ❌ Session FEAT-009 audit failed:
     - Missing required Output Packet: dispatch d-001-qa, role qa
       Reason: outputs/d-001-qa-*.json does not exist (ac_coverage required for qa role)
  ```
  This validates AC-003 and AC-010 — gaps surface clearly, no silent `—` or `missing`.

- If FEAT-009's session was missing pm-orchestrator token capture, the report should now show either:
  - Real "Total tokens | Tokens/AC | Cost" line (if T-005/T-006 fixed the worktree hook registration), OR
  - A new warning banner `⚠ PM session capture warning: ...` (if the hook ran but found no transcript). This validates AC-007 and AC-010.

- If FEAT-009's session had reviewer(s) who returned without explicit `findings: []`, the report's "Findings" column should show the real count (not `0/0/0` masked as `missing`), OR audit-agent should fail citing the missing reviewer Output Packet.

### 2. Regenerate the FEAT-010 report

```bash
npm run agentops:report -- FEAT-010
```

**Expected outcome:**
Repeat the same checks as FEAT-009. Each missing or incomplete Output Packet should either:
- Be flagged by audit-agent as a failure with the dispatch_id clearly named (AC-003, AC-010), OR
- Be reflected in the final report with real, non-`—` values (AC-004, AC-010).

### 3. Regenerate the FEAT-011 report

```bash
npm run agentops:report -- FEAT-011
```

**Expected outcome:**
Repeat the same checks as FEAT-009 and FEAT-010.

### 4. Run audit-agent manually (if needed)

If you want to isolate the audit-agent validation without regenerating the full report, run:

```bash
cd /path/to/calendarfr/.agent-session/FEAT-009
npx @ai-squad/agentops audit-session
```

This invokes audit-agent directly. Expected behavior:
- If any qa/code-reviewer/logic-reviewer dispatches lack their Output Packets or have malformed fields, audit-agent returns a non-zero exit and emits a consolidated failure message.
- The failure message lists every gap by dispatch_id and the reason (AC-003).
- If all required packets exist and are valid, audit-agent succeeds (exit 0).

## Expected Outcomes

### All three sessions should either:

1. **Pass audit-agent** (exit 0) AND the report renders with real AC closure and findings density (no `—` / `missing`).
   - This means FEAT-002's fixes surfaced the previously-missing data, and it is now being captured and reported correctly.

2. **Fail audit-agent** (exit non-zero) with a **clear, named list of missing Output Packets**.
   - Example: `"dispatch d-001-qa missing outputs/d-001-qa-*.json (ac_coverage required for qa role)"`.
   - This validates that audit-agent is correctly failing the session per AC-003, and the failure is explicit (not silent).
   - (Note: FEAT-009/010/011 lost their Output Packets and cannot be reconstructed, so this is the expected outcome; AC-010 validates the failure surfaces clearly, not that data was magically recovered.)

### Never:

- A report that renders with `—` / `missing` / "Token cost not available — using dispatch count as cost proxy" in fields where underlying data should have been captured (if no warnings were raised).
- A report that silently passes audit despite missing required Output Packets.
- A report where the Loop column shows `—` for a fix-dispatch (if `review_loop` was captured at dispatch time).

## If Outcomes Differ

**File an issue** with the following information:
1. **Session ID**: FEAT-009 / FEAT-010 / FEAT-011.
2. **Expected behavior**: (from above)
3. **Actual behavior**: (what happened instead)
4. **Audit output**: (paste the full `npm run agentops:report -- FEAT-XXX` or `npx agentops audit-session` output)
5. **Report excerpt**: (screenshot or paste of the report section showing the unexpected `—` / `missing` / cost-proxy line)
6. **Deployment context**: (which branch, which `./tools/deploy.sh` commit)

---

## Rationale

The three root causes fixed by FEAT-002 were:
1. **Missing qa/reviewer Output Packets** — subagents returned without writing their packets; reporter had no data to populate AC closure and findings density.
2. **Missing pm-orchestrator Stop hook in worktrees** — the hook registered at deploy time only in the main repo, not in git worktrees; token/cost capture never fired for worktree-based sessions.
3. **Missing `review_loop` annotation** — orchestrator did not record the loop count at dispatch time; the Loop column fell back to `—`.

FEAT-002 fixes all three at the source:
- **AC-001/AC-002**: Validator now requires qa to populate `ac_coverage` and reviewers to populate `findings`.
- **AC-003**: audit-agent now sweeps the manifest and fails loudly if packets are missing.
- **AC-005**: `install-hooks.ts` detects worktrees and registers hooks in both main and worktree `.claude/settings.local.json`.
- **AC-006/AC-007**: Reporter now emits real cost data or a warning (never the cost-proxy fallback without context).
- **AC-008/AC-009**: Orchestrator now annotates `review_loop` on every dispatch; reporter renders the Loop column.

This runbook confirms that all three fixes work together end-to-end: the reporter either has real data or a clear audit failure, not silent gaps.
