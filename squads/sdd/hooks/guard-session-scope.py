#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — guard-session-scope.

Wired to the orchestrator Skill's frontmatter. Fires on every Edit/Write/MultiEdit
the orchestrator attempts. Denies the call if the target path is outside
`.agent-session/<task_id>/` — the orchestrator's only legitimate write surface.

Mechanical enforcement of the orchestrator non-edit invariant: source files
flow through `dev` Subagent dispatches only.

Pure stdlib. Python 3.8+.
"""
import json
import os
import sys
from pathlib import Path


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        # Malformed stdin — fail open (don't block) but log to stderr for debugging.
        print(f"guard-session-scope: malformed stdin ({exc})", file=sys.stderr)
        return 0

    tool_input = payload.get("tool_input", {}) or {}
    file_path = tool_input.get("file_path") or tool_input.get("path") or ""

    if not file_path:
        # No path field — let the call through; not our concern.
        return 0

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", os.getcwd())
    try:
        abs_path = Path(file_path).resolve()
        project_root = Path(project_dir).resolve()
    except (OSError, ValueError):
        return 0

    # The orchestrator may write to .agent-session/<task_id>/ only.
    session_root = project_root / ".agent-session"
    try:
        abs_path.relative_to(session_root)
        return 0  # inside .agent-session/ — allowed
    except ValueError:
        pass

    # Path is outside .agent-session/. Deny.
    decision = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Orchestrator must not edit source files. "
                f"Path '{file_path}' is outside .agent-session/. "
                f"Source edits flow through `dev` Subagent dispatches only "
                f"(see squads/sdd/skills/orchestrator/skill.md, hard rules)."
            ),
        }
    }
    print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    sys.exit(main())
