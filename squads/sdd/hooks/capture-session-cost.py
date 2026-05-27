#!/usr/bin/env python3
"""ai-squad Stop hook — capture-session-cost.

Splits the main-session transcript cost into planning vs orchestration by the
pipeline start timestamp from session.yml, and writes
.agent-session/<FEAT>/costs/session-<sessionId>.json. Fail-open.
"""
import json
import os
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

import pricing  # noqa: E402
import transcript_cost  # noqa: E402
from hook_runtime import resolve_project_root  # noqa: E402


def capture(session_id, transcript_path, session_dir, pipeline_started_at, prices):
    try:
        session_dir = Path(session_dir)
        out_dir = session_dir / "costs"
        out_dir.mkdir(parents=True, exist_ok=True)
        if pipeline_started_at:
            planning = transcript_cost.extract_transcript_cost(transcript_path, prices, until=pipeline_started_at)
            orchestration = transcript_cost.extract_transcript_cost(transcript_path, prices, since=pipeline_started_at)
        else:
            planning = transcript_cost.extract_transcript_cost(transcript_path, prices)
            orchestration = {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": [], "error": None}
        payload = {"session_id": session_id, "scope": "session",
                   "planning": planning, "orchestration": orchestration}
        out_file = out_dir / f"session-{session_id}.json"
        tmp = out_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, out_file)
    except Exception as e:
        print(f"capture-session-cost: {e}", file=sys.stderr)
    return 0


def _read_pipeline_start(session_dir: Path):
    """Cheap YAML read without PyYAML — grep the single line."""
    sy = session_dir / "session.yml"
    if not sy.exists():
        return None
    for line in sy.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("pipeline_started_at:"):
            val = line.split(":", 1)[1].strip().strip('"').strip("'")
            return val or None
    return None


def _find_active_session_dir(repo_root: Path):
    base = repo_root / ".agent-session"
    if not base.is_dir():
        return None
    cands = [d for d in base.iterdir() if (d / "session.yml").exists()]
    return max(cands, key=lambda d: d.stat().st_mtime) if cands else None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    session_id = payload.get("session_id") or "unknown"
    transcript_path = payload.get("transcript_path")
    if not transcript_path:
        return 0
    repo_root = Path(resolve_project_root(payload))
    session_dir = _find_active_session_dir(repo_root)
    if session_dir is None:
        return 0
    return capture(session_id, transcript_path, session_dir,
                   _read_pipeline_start(session_dir), pricing.load_prices())


if __name__ == "__main__":
    sys.exit(main())
