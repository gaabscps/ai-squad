#!/usr/bin/env python3
"""
ai-squad Stop hook — verify-audit-dispatch.

Wired to the orchestrator Skill's frontmatter. Fires when the orchestrator
attempts to end its session. Refuses to allow stop if:
  - dispatch-manifest.json exists (i.e., a Phase 4 pipeline ran), AND
  - no entry in actual_dispatches[] has role=audit-agent with status=done.

This closes the "orchestrator skips dispatching audit-agent" hole — the
audit gate becomes mechanically mandatory, not just prompt-discipline.

Honors `stop_hook_active` to avoid infinite blocking loops.

Pure stdlib. Python 3.8+.
"""
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import resolve_project_root, should_run_audit_manifest_verify


def find_active_session(project_dir: Path) -> Path | None:
    """Return the most recently modified .agent-session/<task_id>/ dir, or None."""
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def audit_passed(manifest_path: Path) -> tuple[bool, str]:
    """Return (audit_done, reason). audit_done=True means we found a clean audit dispatch."""
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return False, f"dispatch-manifest.json could not be parsed ({exc})"

    expected = manifest.get("expected_pipeline", [])
    actual = manifest.get("actual_dispatches", [])

    if not expected:
        # No pipeline declared yet. Manifest is stub — orchestrator hasn't started real work.
        # Don't block the stop.
        return True, "manifest has no expected_pipeline; pre-dispatch state"

    audit_entries = [d for d in actual if d.get("role") == "audit-agent"]
    if not audit_entries:
        return False, (
            "audit-agent was never dispatched. The orchestrator must dispatch "
            "audit-agent (step 8) before emitting the handoff."
        )

    # Pick the latest (highest started_at, fallback to last).
    latest = max(audit_entries, key=lambda d: d.get("started_at", ""))
    status = latest.get("status", "")
    if status == "done":
        return True, "audit-agent dispatched and returned status: done"
    if status in {"blocked", "escalate"}:
        # Audit detected bypass. The orchestrator should have emitted refusal handoff
        # AND it's allowed to stop after that. Allow stop.
        return True, f"audit-agent returned status: {status} (refusal handoff path)"

    return False, f"audit-agent dispatched but status='{status}' is not terminal"


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"verify-audit-dispatch: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if payload.get("stop_hook_active"):
        # We're already inside a stop-block loop; let it through to avoid infinite recursion.
        return 0

    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        return 0  # no Phase 4 session active; nothing to verify

    manifest_path = session_dir / "dispatch-manifest.json"
    if not manifest_path.exists():
        return 0  # Phase 4 didn't run; orchestrator session was a no-op or different mode

    if not should_run_audit_manifest_verify(session_dir):
        # Stale .agent-session while chatting about something else — do not block stop.
        return 0

    ok, reason = audit_passed(manifest_path)
    if ok:
        return 0

    decision = {
        "decision": "block",
        "reason": (
            f"Pipeline integrity check failed: {reason}\n\n"
            f"Run the audit-agent before ending the orchestrator session "
            f"(see squads/sdd/skills/orchestrator/skill.md, step 8)."
        ),
    }
    print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    sys.exit(main())
