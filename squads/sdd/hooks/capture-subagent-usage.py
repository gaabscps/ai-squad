#!/usr/bin/env python3
"""
ai-squad Stop hook — capture-subagent-usage.

Fires when ANY session ends. For subagent sessions, captures the
session's token usage from the JSONL transcript and writes it to the
matching dispatch entry in dispatch-manifest.json.

Correlation is exact (1:1) via _session_id stamped into the Output
Packet by stamp-session-id.py (PostToolUse). No heuristics.

Skip behavior (returns silently):
  - stop_hook_active==true (loop guard)
  - No output packet has _session_id matching this session_id
    → orchestrator session OR subagent that didn't write a packet
  - Manifest entry already has `usage` (idempotent re-run)
  - Any I/O / parse error (logged to stderr, never blocks)

Concurrency: file lock (fcntl.flock LOCK_EX) on the manifest while
read-modify-writing. Pure stdlib. Python 3.8+.
"""
import fcntl
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import resolve_project_root


def find_active_session(project_dir: Path) -> Path | None:
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def find_packet_by_session(outputs_dir: Path, session_id: str) -> Path | None:
    if not outputs_dir.is_dir():
        return None
    for f in outputs_dir.glob("d-*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("_session_id") == session_id:
            return f
    return None


def parse_transcript(transcript_path: Path) -> dict:
    """Sum token usage across all assistant turns. Count tool_use blocks."""
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "tool_uses": 0,
    }
    model = "unknown"
    if not transcript_path.exists():
        return {"totals": totals, "model": model}

    try:
        for line in transcript_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue
            # Claude Code transcript: assistant turns under various shapes.
            # Try entry.message.usage and entry.message.model first.
            msg = entry.get("message") if isinstance(entry.get("message"), dict) else entry
            usage = msg.get("usage") if isinstance(msg, dict) else None
            if isinstance(usage, dict):
                for k in (
                    "input_tokens",
                    "output_tokens",
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                ):
                    v = usage.get(k)
                    if isinstance(v, int):
                        totals[k] += v
            if model == "unknown" and isinstance(msg, dict):
                m = msg.get("model")
                if isinstance(m, str) and m:
                    model = m
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        totals["tool_uses"] += 1
    except OSError as exc:
        print(f"capture-subagent-usage: cannot read transcript ({exc})", file=sys.stderr)

    return {"totals": totals, "model": model}


def iso_diff_ms(start_iso: str, end_iso: str) -> int:
    from datetime import datetime

    def parse(s: str):
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    try:
        return int((parse(end_iso) - parse(start_iso)).total_seconds() * 1000)
    except (ValueError, TypeError):
        return 0


def update_manifest(manifest_path: Path, dispatch_id: str, usage: dict) -> None:
    with manifest_path.open("r+", encoding="utf-8") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            try:
                manifest = json.load(fh)
            except json.JSONDecodeError as exc:
                print(
                    f"capture-subagent-usage: malformed manifest ({exc})",
                    file=sys.stderr,
                )
                return
            dispatches = manifest.get("actual_dispatches") or []
            if not isinstance(dispatches, list):
                return
            for entry in dispatches:
                if not isinstance(entry, dict):
                    continue
                if entry.get("dispatch_id") != dispatch_id:
                    continue
                if isinstance(entry.get("usage"), dict):
                    return  # idempotent
                started = entry.get("started_at")
                completed = entry.get("completed_at")
                duration_ms = (
                    iso_diff_ms(started, completed)
                    if isinstance(started, str) and isinstance(completed, str)
                    else 0
                )
                totals = usage["totals"]
                entry["usage"] = {
                    "total_tokens": (
                        totals["input_tokens"]
                        + totals["output_tokens"]
                        + totals["cache_creation_input_tokens"]
                        + totals["cache_read_input_tokens"]
                    ),
                    "input_tokens": totals["input_tokens"],
                    "output_tokens": totals["output_tokens"],
                    "cache_creation_input_tokens": totals["cache_creation_input_tokens"],
                    "cache_read_input_tokens": totals["cache_read_input_tokens"],
                    "tool_uses": totals["tool_uses"],
                    "duration_ms": duration_ms,
                    "model": usage["model"],
                }
                fh.seek(0)
                fh.truncate()
                json.dump(manifest, fh, indent=2)
                return
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"capture-subagent-usage: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if payload.get("stop_hook_active"):
        return 0

    session_id = payload.get("session_id")
    transcript_path_str = payload.get("transcript_path")
    if not isinstance(session_id, str) or not isinstance(transcript_path_str, str):
        return 0

    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        return 0

    manifest_path = session_dir / "dispatch-manifest.json"
    if not manifest_path.exists():
        return 0

    outputs_dir = session_dir / "outputs"
    packet_path = find_packet_by_session(outputs_dir, session_id)
    if packet_path is None:
        return 0  # orchestrator session or no packet written

    try:
        packet = json.loads(packet_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0
    dispatch_id = packet.get("dispatch_id") if isinstance(packet, dict) else None
    if not isinstance(dispatch_id, str):
        return 0

    usage = parse_transcript(Path(transcript_path_str))

    try:
        update_manifest(manifest_path, dispatch_id, usage)
    except OSError as exc:
        print(f"capture-subagent-usage: manifest update failed ({exc})", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
