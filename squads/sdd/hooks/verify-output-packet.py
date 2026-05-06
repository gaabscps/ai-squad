#!/usr/bin/env python3
"""
ai-squad Stop hook (auto-becomes SubagentStop) — verify-output-packet.

Wired to each Phase 4 Subagent's frontmatter. Fires when the Subagent attempts
to complete. Refuses to allow stop if:
  - The Subagent's transcript declared a `dispatch_id`, AND
  - The corresponding Output Packet at .agent-session/<task_id>/outputs/<dispatch_id>.json
    is missing OR fails minimum schema checks.

This forces every Subagent to actually emit an Output Packet before returning,
making the audit-agent's reconciliation gate (`outputs/<dispatch_id>.json` exists
per declared dispatch) mechanically reliable.

Pure stdlib. Python 3.8+.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import resolve_project_root

REQUIRED_FIELDS = {"spec_id", "dispatch_id", "role", "status", "evidence"}
VALID_STATUSES = {"done", "needs_review", "blocked", "escalate"}


def extract_dispatch_id(transcript_path: Path) -> str | None:
    """Scan the transcript file for `dispatch_id: <uuid>` from the WorkPacket prompt."""
    try:
        with transcript_path.open() as f:
            for line in f:
                # Transcript is JSONL. Look at user-role messages.
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue
                content = msg.get("content") or msg.get("text") or ""
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )
                m = re.search(r"dispatch_id:\s*[\"']?([0-9a-fA-F-]{8,})[\"']?", content)
                if m:
                    return m.group(1)
    except OSError:
        return None
    return None


def find_active_session(project_dir: Path) -> Path | None:
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def validate_packet(packet_path: Path) -> tuple[bool, str]:
    try:
        packet = json.loads(packet_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return False, f"Output Packet at {packet_path.name} is unreadable ({exc})"
    missing = REQUIRED_FIELDS - set(packet.keys())
    if missing:
        return False, f"Output Packet missing required fields: {sorted(missing)}"
    if packet.get("status") not in VALID_STATUSES:
        return False, f"Output Packet status '{packet.get('status')}' not in {sorted(VALID_STATUSES)}"
    return True, "valid"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"verify-output-packet: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if payload.get("stop_hook_active"):
        return 0  # avoid infinite loop

    transcript_path_str = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not transcript_path_str:
        return 0  # no transcript — can't extract dispatch_id; fail open
    transcript_path = Path(transcript_path_str)

    dispatch_id = extract_dispatch_id(transcript_path)
    if not dispatch_id:
        # Subagent prompt didn't carry a dispatch_id — likely a non-dispatched invocation
        # (e.g., user-triggered direct call). Don't block.
        return 0

    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        return 0

    packet_path = session_dir / "outputs" / f"{dispatch_id}.json"
    if not packet_path.exists():
        decision = {
            "decision": "block",
            "reason": (
                f"Output Packet missing at {packet_path.relative_to(project_dir)}. "
                f"Subagent must atomically write its Output Packet (per its body's "
                f"output contract) before completing. dispatch_id={dispatch_id}."
            ),
        }
        print(json.dumps(decision))
        return 0

    ok, reason = validate_packet(packet_path)
    if not ok:
        decision = {
            "decision": "block",
            "reason": (
                f"Output Packet at outputs/{dispatch_id}.json fails schema check: {reason}. "
                f"Fix the packet and re-emit before completing."
            ),
        }
        print(json.dumps(decision))
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
