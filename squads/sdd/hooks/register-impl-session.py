#!/usr/bin/env python3
"""ai-squad Stop hook — register-impl-session.

Wired to the orchestrator Skill's frontmatter (Stop). Fires when a session
running the orchestrator Skill ends, and records that session's own id (taken
from the hook payload — therefore trustworthy, never an mtime guess) into
`implementation_sessions:` in the active feature's session.yml.

Why this exists: build_cost_report scopes which subagents belong to a feature
by their parent session id. Subagents dispatched by the orchestrator live under
THIS session id, so recording it lets the cost report ignore historical
contamination (other projects'/sessions' agent files that leaked into costs/)
on READ — no manual deletion. See cost_report._read_implementation_sessions.

Authoritative-write rationale: this hook is declared on the orchestrator Skill,
so it fires ONLY from an orchestrator session. Unlike the global, mtime-based
capture-session-cost hook (which guesses the active feature), the session id
here is the real dispatcher of the feature's subagents.

Idempotent + fail-open: never blocks the orchestrator's stop. Pure stdlib.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import detect_active_skill, resolve_project_root  # noqa: E402


def find_active_session(project_dir: Path):
    """Newest .agent-session/<ID>/ that has a session.yml. Reliable here because
    the orchestrator just wrote its own session.yml, so it is the freshest."""
    base = Path(project_dir) / ".agent-session"
    if not base.is_dir():
        return None
    cands = [p for p in base.iterdir() if (p / "session.yml").exists()]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


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
    # of the implementation session id. Any other session's Stop is ignored.
    if detect_active_skill(payload) != "orchestrator":
        return 0
    session_id = payload.get("session_id")
    if not session_id:
        return 0
    session_dir = find_active_session(resolve_project_root(payload))
    if session_dir is None:
        return 0
    # Only register when a Phase 4 pipeline actually ran (manifest present) —
    # an orchestrator session that dispatched nothing has no subagents to scope.
    if not (session_dir / "dispatch-manifest.json").exists():
        return 0
    try:
        register_session(session_dir / "session.yml", session_id)
    except Exception as e:  # fail-open — never block the orchestrator's stop
        print(f"register-impl-session: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
