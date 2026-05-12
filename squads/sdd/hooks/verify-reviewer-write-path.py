#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — verify-reviewer-write-path.

Purpose: PreToolUse hook for code-reviewer and logic-reviewer subagents.
Fires when: reviewer attempts a Write tool call — BEFORE the write executes.
Effect: blocks writes to any path outside `outputs/`; allows writes whose
        normalized path starts with `outputs/` (the only location reviewers
        may write their Output Packets, per NFR-002).

Never crashes silently. Pure stdlib. Python 3.8+.
"""
import json
import os
import sys
from pathlib import Path


def _validate_payload(payload: object) -> tuple[str, str | None]:
    """Return (file_path, error_msg).

    If valid, error_msg is None.
    If invalid, file_path is "" and error_msg is set.
    """
    if not isinstance(payload, dict):
        return "", "malformed: payload is not a JSON object"
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return "", "malformed: tool_input missing or not a dict"
    file_path = tool_input.get("file_path", "")
    if not file_path:
        return "", "malformed: file_path is empty"
    if not isinstance(file_path, str):
        return "", "malformed: file_path is not a string"
    return file_path, None


def _is_inside_outputs(file_path: str) -> bool:
    """Return True iff the normalized path is contained within `outputs/`.

    Defends against:
    - `outputs/../secrets`       (normpath collapses ..)
    - `outputs/../../etc/passwd` (first component must be "outputs")
    - bare `outputs/` without a filename (requires at least one more component)
    """
    norm = Path(os.path.normpath(file_path))
    parts = norm.parts
    # parts[0] must be exactly "outputs" and there must be at least one
    # further component (so a bare "outputs/" is not a valid write target).
    return len(parts) >= 2 and parts[0] == "outputs"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({
            "decision": "block",
            "reason": "reviewer write blocked: malformed hook payload",
        }))
        return 0

    file_path, error = _validate_payload(payload)
    if error:
        print(json.dumps({
            "decision": "block",
            "reason": f"reviewer write blocked: {error}",
        }))
        return 0

    if not _is_inside_outputs(file_path):
        print(json.dumps({
            "decision": "block",
            "reason": f"reviewer write blocked: path '{file_path}' is outside outputs/",
        }))
        return 0

    # Path is safely inside outputs/ — emit empty object (PreToolUse allow signal).
    print(json.dumps({}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
