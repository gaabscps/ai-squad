#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — guard-write-scope.

Purpose: enforce the /implementer write fence — Checkpoint A's approved scope
         is a contract, not a suggestion. FEAT-013 lesson: the prose hard rule
         ("never write outside the approved scope") didn't hold under pressure;
         jest.setup.js (+76 lines) and msw handlers were edited outside scope
         and masked real browser behavior behind extended mocks.

Mechanism: registered globally under PreToolUse(Edit|Write|MultiEdit) via
           claude-hooks.json. Scoped to the /implementer Skill by transcript
           detection (same pattern as guard-session-scope). State machine read
           from session.yml:

             status: done                  -> fence lifted (seal happened)
             approved_write_scope present  -> writes allowed ONLY inside it
             approved_write_scope absent   -> pre-Checkpoint A: source is
                                              read-only (plan-of-attack phase)

           `.agent-session/` paths are always allowed (trail + artifacts) —
           including the session.yml update that records a scope widening
           after an attention.kind: input escalation.

Default: allow. Other skills, subagents and the main session are untouched;
         unreadable/absent session state fails open.

Pure stdlib. Python 3.8+.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (
    detect_active_skill,
    edit_target_path,
    find_active_session,
    resolve_project_root,
    tool_input_dict,
)

_FENCE_STATUSES = {"implementing", "needs_attention"}


def parse_session_state(text: str) -> tuple[str, list]:
    """(status, approved_write_scope) from session.yml. Cheap line parse, no
    PyYAML (consistent with the hooks). Strips quotes and inline comments."""
    status = ""
    scope = []
    in_scope = False
    for line in text.splitlines():
        if re.match(r"^status\s*:", line):
            status = line.split(":", 1)[1].strip().strip('"').strip("'")
            in_scope = False
            continue
        if re.match(r"^approved_write_scope\s*:", line):
            in_scope = True
            continue
        if not in_scope:
            continue
        m = re.match(r"^\s+-\s*(.+)$", line)
        if m:
            entry = m.group(1).split(" #", 1)[0].strip().strip('"').strip("'")
            if entry:
                scope.append(entry)
        elif line.strip() == "":
            continue
        elif not line.startswith((" ", "\t")):
            in_scope = False  # a new top-level key ends the list block
    return status, scope


def _in_scope(rel: str, scope: list) -> bool:
    for entry in scope:
        if rel == entry.rstrip("/"):
            return True
        if rel.startswith(entry.rstrip("/") + "/"):
            return True
    return False


def _deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"guard-write-scope: malformed stdin ({exc})", file=sys.stderr)
        return 0
    if not isinstance(payload, dict):
        return 0

    if detect_active_skill(payload) != "implementer":
        return 0

    file_path = edit_target_path(tool_input_dict(payload))
    if not file_path:
        return 0

    project_root = Path(resolve_project_root(payload))
    try:
        abs_path = Path(file_path).resolve()
        project_root = project_root.resolve()
    except (OSError, ValueError):
        return 0

    # Trail and artifacts are always writable — that's where escalations and
    # scope widenings are recorded.
    try:
        abs_path.relative_to(project_root / ".agent-session")
        return 0
    except ValueError:
        pass

    session_dir = find_active_session(project_root)
    if session_dir is None:
        return 0  # no Session to enforce against — fail open
    session_yml = Path(session_dir) / "session.yml"
    try:
        status, scope = parse_session_state(
            session_yml.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return 0

    if status == "done":
        return 0  # seal happened; the fence is lifted

    if not scope:
        _deny(
            f"Write fence: '{file_path}' denied — no approved_write_scope in "
            f"session.yml yet. Before Checkpoint A the implementer is read-only "
            f"on source: present the plan of attack, get the human's approval, "
            f"record the approved scope, THEN implement."
        )
        return 0

    try:
        rel = str(abs_path.relative_to(project_root))
    except ValueError:
        rel = None  # outside the repo — never in scope

    if rel is not None and _in_scope(rel, scope):
        return 0

    _deny(
        f"Write fence: '{file_path}' is outside the scope approved at "
        f"Checkpoint A. Do NOT widen scope silently. Either implement within "
        f"the approved files, or escalate: set status: needs_attention + "
        f"attention: {{kind: input}}, ask the human, and on approval append the "
        f"new path to approved_write_scope in session.yml before retrying."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
