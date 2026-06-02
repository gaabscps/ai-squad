#!/usr/bin/env python3
"""
ai-squad PostToolUse(Task) hook — verify-dispatch-packet.

Runs in the ORCHESTRATOR session, right after each Task dispatch returns. This
is the ONLY layer that survives an abnormal subagent death (e.g. the platform's
"safety classifier unavailable" anomaly kills the subagent mid-flight, so the
SubagentStop hook — verify-output-packet.py — never fires and cannot block).

Behavior: if the just-returned dispatch is a Phase 4 role and its Output Packet
at .agent-session/<spec_id>/outputs/<dispatch_id>.json is missing OR fails the
canonical schema check, emit additionalContext naming the dispatch_id so the
orchestrator can re-dispatch (see SKILL.md steps 3/4, packet_retries cap). This
hook NEVER blocks — the Task itself "succeeded" from the tool's view; what is
missing is the artifact. The terminal safety net remains the audit gate (step 8).

Pure stdlib. Python 3.8+.
"""
from __future__ import annotations

import importlib.util as _ilu
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import resolve_project_root, tool_input_dict

# Phase 4 dispatch roles that owe an Output Packet (mirrors verify-output-packet.py).
_PHASE_4_SUBAGENTS = frozenset({
    "dev", "code-reviewer", "logic-reviewer", "qa",
    "audit-agent", "committer", "blocker-specialist",
})

# Same dispatch_id token the orchestrator emits in the Work Packet prompt
# (mirrors verify-output-packet.extract_dispatch_id).
_DISPATCH_ID_RE = re.compile(r"dispatch_id:\s*[\"']?([A-Za-z0-9][A-Za-z0-9_-]{2,})")


def _load_validate_packet():
    """Load validate_packet() from verify-output-packet.py (hyphenated filename
    requires importlib). Returns the callable, or None if unavailable."""
    path = _HOOKS_DIR / "verify-output-packet.py"
    try:
        spec = _ilu.spec_from_file_location("verify_output_packet", str(path))
        if not spec or not spec.loader:
            return None
        mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        return mod.validate_packet
    except Exception:
        return None


_VALIDATE_PACKET = _load_validate_packet()


def _find_active_session(project_dir: Path) -> Path | None:
    """Most-recently-modified .agent-session/<spec_id>/ dir (mirrors
    verify-output-packet.find_active_session)."""
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _emit_context(message: str) -> int:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": message,
        }
    }))
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # malformed — fail silent (never block a Task)

    # The hook registrations (claude-hooks.json + skill.md frontmatter) already scope
    # this to Task; this guard is belt-and-suspenders if the hook is ever wired more
    # broadly. None is allowed so payloads that omit tool_name (e.g. tests) still
    # reach the subagent_type gate.
    if payload.get("tool_name") not in (None, "Task"):
        return 0
    tool_input = tool_input_dict(payload)
    subagent_type = tool_input.get("subagent_type")
    if subagent_type not in _PHASE_4_SUBAGENTS:
        return 0  # not a Phase 4 dispatch — silent

    prompt = tool_input.get("prompt")
    if not isinstance(prompt, str):
        return 0
    m = _DISPATCH_ID_RE.search(prompt)
    if not m:
        return 0  # cannot locate dispatch_id — silent (audit remains the net)
    dispatch_id = m.group(1)

    project_dir = resolve_project_root(payload)
    session_dir = _find_active_session(project_dir)
    if session_dir is None:
        return 0  # no session to check against — silent

    packet_path = session_dir / "outputs" / f"{dispatch_id}.json"
    if not packet_path.exists():
        return _emit_context(
            f"Output Packet MISSING for dispatch_id={dispatch_id} "
            f"(role={subagent_type}) at outputs/{dispatch_id}.json. The dispatch "
            f"returned but did not persist its packet — likely an abrupt subagent "
            f"death (platform anomaly). Re-dispatch this role per SKILL.md step 4 "
            f"(increment task_states.packet_retries; cap packet_retry_max=2, then "
            f"blocked/missing_output_packet)."
        )

    if _VALIDATE_PACKET is None:
        return 0  # validator unavailable — defer to audit gate
    ok, reason = _VALIDATE_PACKET(packet_path)
    if not ok:
        return _emit_context(
            f"Output Packet INVALID for dispatch_id={dispatch_id} "
            f"(role={subagent_type}): {reason}. Treat as a non-delivered artifact "
            f"and re-dispatch per SKILL.md step 4 (packet_retries; cap 2 then "
            f"blocked/missing_output_packet)."
        )
    return 0  # packet present and valid — silent


if __name__ == "__main__":
    sys.exit(main())
