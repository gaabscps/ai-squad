#!/usr/bin/env python3
"""
ai-squad PostToolUse hook — stamp-session-id.

Fires after every Write/Edit. When a subagent writes its Output Packet
(path matches */outputs/d-*.json), injects the current session_id into
the JSON file as "_session_id". This lets the Stop hook
(capture-subagent-usage.py) correlate the subagent's transcript with
the exact dispatch entry in the manifest — no heuristics.

Idempotent: if "_session_id" is already present, the file is left alone.
Never blocks the tool. Pure stdlib. Python 3.8+.
"""
import json
import re
import sys
from pathlib import Path

OUTPUT_PACKET_RE = re.compile(r".*/outputs/d-[^/]+\.json$")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"stamp-session-id: malformed stdin ({exc})", file=sys.stderr)
        return 0

    tool_name = payload.get("tool_name")
    if tool_name not in ("Write", "Edit"):
        return 0

    session_id = payload.get("session_id")
    if not isinstance(session_id, str) or not session_id:
        return 0

    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("path")
    if not isinstance(file_path, str) or not OUTPUT_PACKET_RE.match(file_path):
        return 0

    target = Path(file_path)
    if not target.exists():
        return 0

    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"stamp-session-id: cannot read {target} ({exc})", file=sys.stderr)
        return 0

    if not isinstance(data, dict):
        return 0
    if data.get("_session_id"):
        return 0  # idempotent

    data["_session_id"] = session_id

    try:
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(target)
    except OSError as exc:
        print(f"stamp-session-id: cannot write {target} ({exc})", file=sys.stderr)
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
