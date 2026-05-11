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

Also supports `--check-only <path>` CLI mode so audit-agent can re-validate an
existing packet without transcript parsing. Exits 0 on valid, non-zero on failure
and prints a structured JSON error to stdout.

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

REQUIRED_FIELDS = {"spec_id", "dispatch_id", "role", "status", "summary", "evidence"}
VALID_STATUSES = {"done", "needs_review", "blocked", "escalate"}

# Discriminated-union map: role -> extra validation performed after REQUIRED_FIELDS.
# Keys map to callables: validate_role_fields(packet) -> (ok: bool, reason: str).
# Roles absent from this map are untouched (dev, blocker-specialist, audit-agent, etc.)
ROLE_REQUIRED_FIELDS: dict = {}  # overwritten below with the literal mapping dict


_AC_KEY_RE = re.compile(r"^(FEAT|DISC)-\d{3,}/AC-\d{3,}$")


def _validate_qa_fields(packet: dict) -> tuple[bool, str]:
    """AC-001: qa must have a non-empty ac_coverage object keyed by FEAT-NNN/AC-NNN.

    Canonical schema (shared/schemas/output-packet.schema.json lines 128-138):
      ac_coverage: {type: object, patternProperties: {'^(FEAT|DISC)-\\d{3,}/AC-\\d{3,}$':
        {type: array, items: {type: string}}}}
    Each key must match the pattern; each value must be a non-empty list of strings
    (evidence id pointers).
    """
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    ac_coverage = packet.get("ac_coverage")
    if ac_coverage is None:
        return (
            False,
            f"dispatch_id={dispatch_id}: qa Output Packet missing required field 'ac_coverage'",
        )
    if not isinstance(ac_coverage, dict):
        return (
            False,
            f"dispatch_id={dispatch_id}: qa 'ac_coverage' must be an object, got {type(ac_coverage).__name__}",
        )
    if len(ac_coverage) == 0:
        return (
            False,
            f"dispatch_id={dispatch_id}: qa 'ac_coverage' must be a non-empty object (got {{}}); "
            "keys must match ^(FEAT|DISC)-NNN/AC-NNN and values must be non-empty evidence-id arrays",
        )
    for key, val in ac_coverage.items():
        if not _AC_KEY_RE.match(key):
            return (
                False,
                f"dispatch_id={dispatch_id}: qa 'ac_coverage' key '{key}' does not match "
                r"required pattern ^(FEAT|DISC)-\d{3,}/AC-\d{3,}$",
            )
        if not isinstance(val, list):
            return (
                False,
                f"dispatch_id={dispatch_id}: qa 'ac_coverage[\"{key}\"]' must be an array, "
                f"got {type(val).__name__}",
            )
        if len(val) == 0:
            return (
                False,
                f"dispatch_id={dispatch_id}: qa 'ac_coverage[\"{key}\"]' must be a non-empty "
                "list of evidence id strings",
            )
        for i, item in enumerate(val):
            if not isinstance(item, str):
                return (
                    False,
                    f"dispatch_id={dispatch_id}: qa 'ac_coverage[\"{key}\"][{i}]' must be a "
                    f"string (evidence id), got {type(item).__name__}",
                )
    return True, "valid"


_FINDING_SEVERITY_VALUES = {"info", "warning", "error", "critical", "major", "blocker", "minor"}


def _validate_reviewer_fields(packet: dict) -> tuple[bool, str]:
    """AC-002: code-reviewer / logic-reviewer must have a findings array (empty [] is valid).

    Each item in findings must have:
      - id (string) — required
      - severity (string, enum: info|warning|error|critical|major|blocker) — required
    Optional fields (file, line, rationale, dimension, gap_kind) are not enforced here.
    """
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    role = packet.get("role", "<unknown>")
    findings = packet.get("findings")
    if findings is None:
        return (
            False,
            f"dispatch_id={dispatch_id}: {role} Output Packet missing required field 'findings' "
            "(array required; empty list [] is valid as an explicit 'no findings' claim)",
        )
    if not isinstance(findings, list):
        return (
            False,
            f"dispatch_id={dispatch_id}: {role} 'findings' must be an array, got {type(findings).__name__}",
        )
    for i, item in enumerate(findings):
        if not isinstance(item, dict):
            return (
                False,
                f"dispatch_id={dispatch_id}: {role} 'findings[{i}]' must be an object",
            )
        if "id" not in item:
            return (
                False,
                f"dispatch_id={dispatch_id}: {role} 'findings[{i}]' missing required key 'id'",
            )
        if "severity" not in item:
            return (
                False,
                f"dispatch_id={dispatch_id}: {role} 'findings[{i}]' missing required key 'severity'",
            )
        severity = item["severity"]
        if severity not in _FINDING_SEVERITY_VALUES:
            return (
                False,
                f"dispatch_id={dispatch_id}: {role} 'findings[{i}].severity' value '{severity}' "
                f"not in allowed enum {sorted(_FINDING_SEVERITY_VALUES)}",
            )
    return True, "valid"


ROLE_REQUIRED_FIELDS = {
    "qa": _validate_qa_fields,
    "code-reviewer": _validate_reviewer_fields,
    "logic-reviewer": _validate_reviewer_fields,
}


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
    # Discriminated-union role-specific validation (AC-001, AC-002).
    role = packet.get("role", "")
    role_validator = ROLE_REQUIRED_FIELDS.get(role)
    if role_validator is not None:
        ok, reason = role_validator(packet)
        if not ok:
            return False, reason
    return True, "valid"


def _derive_dispatch_id(packet_path: Path) -> str:
    """Derive dispatch_id from the packet file path basename.

    Rule: strip the `.json` suffix from the filename stem and use it as-is.
    Example: `d-001-qa.json` -> `d-001-qa`, `d-001.json` -> `d-001`.
    This is stable and reversible; no transformation of leading `d-` prefix.
    """
    return packet_path.stem


def check_only(packet_path: Path) -> int:
    """
    `--check-only <path>` mode: validate an existing Output Packet file and
    exit non-zero with a structured JSON error on failure. Used by audit-agent
    to re-invoke the validator on packets without replaying transcript parsing.

    Error JSON always includes `dispatch_id` (derived from file basename stem)
    so audit-agent can reference the failing dispatch in its pointer messages.
    """
    dispatch_id = _derive_dispatch_id(packet_path)
    if not packet_path.exists():
        error = {
            "valid": False,
            "dispatch_id": dispatch_id,
            "error": f"Output Packet not found: {packet_path}",
        }
        print(json.dumps(error))
        return 1
    ok, reason = validate_packet(packet_path)
    if not ok:
        error = {"valid": False, "dispatch_id": dispatch_id, "error": reason}
        print(json.dumps(error))
        return 1
    print(json.dumps({"valid": True, "dispatch_id": dispatch_id}))
    return 0


def main() -> int:
    # --check-only <path> mode: validate an existing packet without stdin parsing.
    if len(sys.argv) >= 3 and sys.argv[1] == "--check-only":
        return check_only(Path(sys.argv[2]))

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
