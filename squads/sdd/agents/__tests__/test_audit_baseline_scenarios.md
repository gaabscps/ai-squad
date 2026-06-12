# QA Scenario — Audit Baseline (Spec A, Check 6)

> **Executor:** qa Subagent (or a human running the audit-agent against fixtures).
> **Source of truth:** `squads/sdd/agents/audit-agent.md` Check 6;
> `squads/sdd/hooks/audit_baseline.py`.
> **Why manual:** Check 6 is an LLM instruction (Haiku), not Python. The set
> arithmetic it relies on is unit-tested in `test_audit_baseline.py`; these
> scenarios verify the agent CONSUMES that helper correctly.

Each scenario seeds a synthetic `.agent-session/FEAT-TEST/` and a working tree,
then runs the audit-agent and asserts the Output Packet.

## Scenario 1 — pre-existing dirt is exempted (the FEAT-001 bug)
- Baseline: `audit-baseline.json` with `dirty_paths: [".gitignore"]`.
- Working tree: `.gitignore` dirty (no dev packet touches it); `src/a.ts` dirty WITH a dev packet.
- Expect: `status: done`. `.gitignore` does NOT produce `orchestrator_edited_source`.
  Evidence includes `note: "1 path(s) exempted as pre-existing (baseline)"`.

## Scenario 2 — real orchestrator edit still blocks
- Baseline: `audit-baseline.json` with `dirty_paths: []`.
- Working tree: `src/secret.ts` dirty, covered by NO dev packet.
- Expect: `status: blocked, blocker_kind: bypass_detected`, one
  `orchestrator_edited_source` finding for `src/secret.ts`. (Anti-fraude intact.)

## Scenario 3 — baseline absent → non-blocking, ownership unverifiable
- No `audit-baseline.json`.
- Working tree: `.gitignore` dirty, no dev packet.
- Expect: `status: done` (NOT blocked). One consolidated
  `severity: warning, audit_finding_kind: source_ownership_unverified` finding
  listing `.gitignore`, plus `kind: absence` evidence
  `note: "baseline absent — ownership unverifiable, non-blocking"`. The
  orchestrator surfaces it as a handoff caveat (advise `git diff`), but the
  pipeline completes — a false block on every baseline-absent run was the worse
  failure, and with the spec_id baseline-resolution fix this case is now rare.
  Real fraud signals (`role_mismatch`, missing/orphan packets,
  `pipeline_stage_skipped`, `ac_not_validated`) still hard-block independently.

## Scenario 4 — concurrent human edit during the run (NOT in baseline)
- Baseline: `audit-baseline.json` with `dirty_paths: []` (clean at start).
- Working tree: human edits `docs/x.md` mid-run; no dev packet.
- Expect: `status: blocked` `orchestrator_edited_source` for `docs/x.md`. The
  audit cannot know it was the human — this is Layer 2's job (Task 5), not the
  baseline's. (Documents the deliberate Layer 1/Layer 2 split.)
