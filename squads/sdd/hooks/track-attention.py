#!/usr/bin/env python3
"""
ai-squad hook — track-attention (observability-OS shell).

Purpose: make the aiOS "needs your attention" column mechanical, independent
         of model discipline. The signal is the harness's own events:
         AskUserQuestion firing = the session is blocked on the human;
         the next UserPromptSubmit = the human engaged.

Mechanism: registered under PreToolUse(AskUserQuestion) and UserPromptSubmit
           via claude-hooks.json. Acts ONLY on free/observed sessions
           (`mode: observed` in session.yml, written by /observe) — SDD
           sessions run their own status machine and are never touched.
           Terminal status (done) is never flipped. Atomic rewrite, fail-open.

Pure stdlib. Python 3.8+.
"""
import json
import os
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import find_active_session, resolve_project_root

_STATUS_RE = re.compile(r"^status\s*:\s*(\S+)", re.M)


def _read(session_yml: Path) -> str | None:
    try:
        return session_yml.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def _write_atomic(session_yml: Path, text: str) -> None:
    tmp = session_yml.with_suffix(".yml.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, session_yml)


def _strip_attention_block(lines: list) -> list:
    """Drop a top-level `attention:` key and its indented children."""
    out = []
    in_block = False
    for line in lines:
        if re.match(r"^attention\s*:", line):
            in_block = True
            continue
        if in_block:
            if line.startswith((" ", "\t")) or line.strip() == "":
                continue
            in_block = False
        out.append(line)
    return out


def _set_status(text: str, status: str, attention_kind: str | None) -> str:
    lines = _strip_attention_block(text.splitlines())
    replaced = False
    for i, line in enumerate(lines):
        if re.match(r"^status\s*:", line):
            lines[i] = f"status: {status}"
            replaced = True
            break
    if not replaced:
        lines.append(f"status: {status}")
    if attention_kind:
        idx = next(i for i, l in enumerate(lines) if re.match(r"^status\s*:", l))
        lines[idx + 1:idx + 1] = ["attention:", f"  kind: {attention_kind}"]
    return "\n".join(lines) + "\n"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"track-attention: malformed stdin ({exc})", file=sys.stderr)
        return 0
    if not isinstance(payload, dict):
        return 0

    is_ask = payload.get("tool_name") == "AskUserQuestion"
    is_prompt = payload.get("hook_event_name") == "UserPromptSubmit"
    if not (is_ask or is_prompt):
        return 0

    session_dir = find_active_session(Path(resolve_project_root(payload)))
    if session_dir is None:
        return 0
    session_yml = Path(session_dir) / "session.yml"
    text = _read(session_yml)
    if text is None:
        return 0
    if not re.search(r"^mode\s*:\s*[\"']?observed\b", text, re.M):
        return 0  # SDD/Discovery sessions own their status machine

    m = _STATUS_RE.search(text)
    status = (m.group(1).strip("\"'") if m else "")
    if status == "done":
        return 0

    try:
        if is_ask and status != "needs_attention":
            _write_atomic(session_yml, _set_status(text, "needs_attention", "input"))
        elif is_prompt and status == "needs_attention":
            _write_atomic(session_yml, _set_status(text, "in_progress", None))
    except OSError as exc:
        print(f"track-attention: write failed ({exc})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
