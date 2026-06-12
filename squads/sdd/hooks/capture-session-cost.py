#!/usr/bin/env python3
"""ai-squad Stop hook — capture-session-cost.

Splits the main-session transcript cost by the cut marks in session.yml and
writes .agent-session/<FEAT>/costs/session-<sessionId>.json. Old trail
(orchestrator): planning vs orchestration at pipeline_started_at. New trail
(/implementer): planning vs implementation at implement_trail.started_at,
which takes precedence. Fail-open.
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
from hook_runtime import (  # noqa: E402
    read_yaml_scalar,
    resolve_capture_session,
    resolve_project_root,
)


def capture(session_id, transcript_path, session_dir, pipeline_started_at, prices,
            implement_started_at=None, window_since=None, window_until=None):
    try:
        session_dir = Path(session_dir)
        out_dir = session_dir / "costs"
        out_dir.mkdir(parents=True, exist_ok=True)
        implementation = None
        if implement_started_at:
            # New trail (/implementer): the implementation runs IN the main
            # session, so the cut is implement_trail.started_at — and it wins
            # over pipeline_started_at (the feature was implemented by
            # /implementer, not dispatched by the orchestrator).
            planning = transcript_cost.extract_transcript_cost(transcript_path, prices, until=implement_started_at)
            implementation = transcript_cost.extract_transcript_cost(transcript_path, prices, since=implement_started_at)
            orchestration = {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": [], "error": None}
        elif pipeline_started_at:
            planning = transcript_cost.extract_transcript_cost(transcript_path, prices, until=pipeline_started_at)
            orchestration = transcript_cost.extract_transcript_cost(transcript_path, prices, since=pipeline_started_at)
        else:
            # Observed (free) sessions have no internal cut marks; the window
            # brackets the snapshot to the contract's lifetime (created_at →
            # closed_at) so a chat session crossing several OBS contracts is
            # never double-counted.
            planning = transcript_cost.extract_transcript_cost(
                transcript_path, prices, since=window_since, until=window_until)
            orchestration = {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": [], "error": None}
        # transcript_path is the pointer the post-hoc analyst (chronicler in
        # observed mode) uses to find the recording — persist it.
        payload = {"session_id": session_id, "scope": "session",
                   "transcript_path": str(transcript_path),
                   "planning": planning, "orchestration": orchestration}
        if window_since or window_until:
            payload["window"] = {"since": window_since, "until": window_until}
        if implementation is not None:
            payload["implementation"] = implementation
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


def _read_implement_start(session_dir: Path):
    """implement_trail.started_at from session.yml, or None. Cheap block parse,
    no PyYAML — only a started_at indented under implement_trail counts."""
    sy = session_dir / "session.yml"
    if not sy.exists():
        return None
    in_block = False
    for line in sy.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip().startswith("implement_trail:") and not line.startswith((" ", "\t")):
            in_block = True
            continue
        if not in_block:
            continue
        if line.strip() and not line.startswith((" ", "\t")):
            break  # a new top-level key ends the block
        stripped = line.strip()
        if stripped.startswith("started_at:"):
            val = stripped.split(":", 1)[1].strip().strip('"').strip("'")
            return val or None
    return None


def _read_observed_window(session_dir: Path):
    """(created_at, closed_at) bounds for an observed Session dir, else None.
    The window is what keeps a chat session that outlives this contract from
    leaking its earlier/later spend into this dir's snapshot."""
    session_dir = Path(session_dir)
    yml = session_dir / "session.yml"
    if read_yaml_scalar(yml, "mode") != "observed":
        return None
    return (read_yaml_scalar(yml, "created_at"), read_yaml_scalar(yml, "closed_at"))


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
    # Ownership-aware routing (observed mode): the registered owner wins over
    # the mtime-newest sibling, an open observed target adopts this chat
    # session, and a closed unowned observed target gets nothing.
    session_dir = resolve_capture_session(repo_root, session_id)
    if session_dir is None:
        return 0
    window = _read_observed_window(session_dir) or (None, None)
    return capture(session_id, transcript_path, session_dir,
                   _read_pipeline_start(session_dir), pricing.load_prices(),
                   implement_started_at=_read_implement_start(session_dir),
                   window_since=window[0], window_until=window[1])


if __name__ == "__main__":
    sys.exit(main())
