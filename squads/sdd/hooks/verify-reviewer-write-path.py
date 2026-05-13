#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — verify-reviewer-write-path.

Purpose: enforce the "reviewers write only under outputs/" invariant (NFR-002)
         WITHOUT blocking Writes from non-reviewer callers (main session, dev
         subagent, qa, etc.).

Mechanism: `ai-squad deploy` registers this hook globally under PreToolUse(Write)
           because Claude Code's settings hook config has no per-subagent
           scoping. To preserve the intended scoping, the hook detects whether
           the current invocation is happening inside a code-reviewer or
           logic-reviewer subagent by scanning the transcript JSONL for the
           Work Packet marker (`subagent_type: code-reviewer|logic-reviewer`).

Default: allow. Only enforce the outputs/ rule when reviewer context is
         positively detected. This protects the main session and other
         subagents from spurious blocks.

Pure stdlib. Python 3.8+.
"""
import json
import os
import re
import sys
from pathlib import Path

_TRANSCRIPT_SCAN_LIMIT = 80
_REVIEWER_SUBAGENT_PATTERN = re.compile(
    r"subagent_type:\s*[\"']?(code-reviewer|logic-reviewer)\b"
)


def _validate_payload(payload: object) -> tuple[str, str | None]:
    """Return (file_path, error_msg). If valid, error_msg is None."""
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
    return len(parts) >= 2 and parts[0] == "outputs"


def _detect_reviewer_context(payload: dict) -> bool:
    """Return True iff the transcript indicates a reviewer subagent is active.

    Scans the first lines of the JSONL transcript for the canonical Work Packet
    marker `subagent_type: code-reviewer` / `logic-reviewer`. Bounded by
    _TRANSCRIPT_SCAN_LIMIT lines to keep latency predictable; the Work Packet
    is always at the top of the transcript so a tight bound is safe.

    Returns False (default-allow) when:
      - transcript_path missing or not a string
      - transcript file unreadable
      - no reviewer marker found within the scan window
    """
    tp = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not isinstance(tp, str) or not tp:
        return False
    transcript_path = Path(tp)
    try:
        with transcript_path.open("r", encoding="utf-8", errors="replace") as fh:
            for lineno, raw_line in enumerate(fh, start=1):
                if lineno > _TRANSCRIPT_SCAN_LIMIT:
                    break
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict):
                    continue
                # Work Packet text can appear as plain string content, a list
                # of content blocks ({type: text, text: "..."}), or nested
                # under message.content.
                content = entry.get("content")
                if content is None:
                    msg = entry.get("message")
                    if isinstance(msg, dict):
                        content = msg.get("content")
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )
                if not isinstance(content, str):
                    continue
                if _REVIEWER_SUBAGENT_PATTERN.search(content):
                    return True
    except OSError:
        return False
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Malformed payload — fail open (allow). Better than blocking writes
        # from arbitrary callers due to an upstream parser bug.
        print(json.dumps({}))
        return 0

    # If we cannot positively identify the caller as a reviewer, allow the
    # write. This hook's invariant only applies to reviewer subagents.
    if not isinstance(payload, dict) or not _detect_reviewer_context(payload):
        print(json.dumps({}))
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
