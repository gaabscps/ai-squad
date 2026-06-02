#!/usr/bin/env python3
"""ai-squad PreToolUse(Task) hook — capture-baseline.

Captures a one-time "dirty baseline" snapshot of the working tree the FIRST time
an orchestrator session dispatches a Task. The first Phase 4 dispatch is always a
`dev`, so this fires immediately before any source edit — recording the files
already modified BEFORE the pipeline touched anything (human-inherited dirt or a
concurrent human edit), which the audit-agent's Check 6 must NOT mistake for
orchestrator source-editing fraud.

Why a hook, not the orchestrator: attestation / Root of Trust — the orchestrator
LLM (already observed skipping steps, issue #1) cannot trustworthily measure its
own baseline. A deterministic shell-run hook is the measurer; the companion
guard-session-scope hook then makes audit-baseline.json off-limits to the
orchestrator, so it cannot be rewritten after capture.

Idempotent by existence: writes only if audit-baseline.json is absent. A
--resume or --restart run REUSES the original baseline and never recaptures
(recapturing on restart would absorb the previous run's edits as pre-existing).
The baseline lives at the session root (a sibling of outputs/), so --restart —
which wipes only outputs/ — preserves it.

Skill-scope gated to `orchestrator`. Fail-open: never blocks the dispatch.
Pure stdlib. Python 3.8+.
"""
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

import audit_baseline  # noqa: E402
from hook_runtime import detect_active_skill, resolve_project_root  # noqa: E402


def find_active_session(project_dir):
    """Newest .agent-session/<ID>/ that has a session.yml. Reliable here because
    the orchestrator just wrote its own session.yml, so it is the freshest."""
    base = Path(project_dir) / ".agent-session"
    if not base.is_dir():
        return None
    cands = [p for p in base.iterdir() if (p / "session.yml").exists()]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    # Only an orchestrator session has a baseline to capture; the first dispatch
    # is the moment just before the first source edit.
    if detect_active_skill(payload) != "orchestrator":
        return 0
    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        return 0
    baseline = session_dir / audit_baseline.BASELINE_FILENAME
    if baseline.exists():
        return 0   # idempotent — capture once; reuse on --resume/--restart
    snapshot = {
        "schema_version": 1,
        "captured_at_session": payload.get("session_id"),
        "dirty_paths": audit_baseline.dirty_paths(project_dir),
    }
    try:
        tmp = baseline.with_name(baseline.name + ".tmp")
        tmp.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
        tmp.replace(baseline)   # atomic publish
    except OSError as e:        # fail-open — never block the dispatch
        print(f"capture-baseline: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
