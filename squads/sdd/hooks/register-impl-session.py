#!/usr/bin/env python3
"""ai-squad PreToolUse(Task) hook — register-impl-session.

Wired (Claude Code) under PreToolUse with matcher `Task`. Fires on each Task
dispatch from an orchestrator session and records that session's own id (from
the hook payload — therefore trustworthy, never an mtime guess) into
`implementation_sessions:` in the active feature's session.yml.

Why at first-dispatch, not at Stop: build_cost_report scopes which subagents
belong to a feature by their parent session id, and the cost report is emitted
at handoff time — BEFORE the session ends. Registering at Stop wrote this
provenance too late (the report had already run and excluded every subagent —
the FEAT-001 "$0 implementation" bug). PreToolUse(Task) fires before the first
dispatch, so the allow-list exists before the report. See
cost_report._read_implementation_sessions.

Skill-scope gated to `orchestrator` (the only authoritative source of the
implementation session id) and idempotent + accumulative: each orchestrator
session that dispatches registers its own id once; a --resume run adds the
resumed session too, so no dispatching session is ever orphaned.

Fail-open: never blocks the dispatch. Pure stdlib.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    detect_active_skill,
    find_active_session,
    resolve_project_root,
)


def register_session(session_yml: Path, session_id: str) -> bool:
    """Append session_id to `implementation_sessions:` in session.yml.

    Idempotent (returns False if already listed or id is unusable). Pure text
    edit — no PyYAML, matching the other hooks. List-item indentation (2 spaces)
    mirrors the existing planned_phases block.
    """
    if not session_id or session_id == "unknown":
        return False
    text = session_yml.read_text(encoding="utf-8") if session_yml.exists() else ""
    if re.search(rf'^\s*-\s*["\']?{re.escape(session_id)}["\']?\s*$', text, re.MULTILINE):
        return False  # already listed
    item = f'  - "{session_id}"'
    lines = text.splitlines()
    key_idx = next(
        (i for i, ln in enumerate(lines) if re.match(r"^\s*implementation_sessions\s*:", ln)),
        None)
    if key_idx is None:
        if lines and lines[-1].strip() == "":
            lines.pop()
        lines += ["implementation_sessions:", item]
    else:
        lines.insert(key_idx + 1, item)
    session_yml.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    # Skill-scope gate: only an orchestrator session is an authoritative source
    # of the implementation session id. Any other session's dispatch is ignored.
    if detect_active_skill(payload) != "orchestrator":
        return 0
    session_id = payload.get("session_id")
    if not session_id:
        return 0
    session_dir = find_active_session(resolve_project_root(payload))
    if session_dir is None:
        return 0
    try:
        register_session(session_dir / "session.yml", session_id)
    except Exception as e:  # fail-open — never block the dispatch
        print(f"register-impl-session: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
