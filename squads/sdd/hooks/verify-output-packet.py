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
import importlib.util as _ilu
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

# squads/sdd/hooks/ is 3 levels below project root: project_root/squads/sdd/hooks/
# parents[0] = squads/sdd/hooks, parents[1] = squads/sdd, parents[2] = squads, parents[3] = project root
_SHARED_LIB = _HOOKS_DIR.parent.parent.parent / "shared" / "lib"
# Append (not insert) so shared/lib does NOT shadow stdlib modules (e.g. warnings.py in shared/lib
# must not intercept `import warnings` from pathlib._local during stdlib init).
if str(_SHARED_LIB) not in sys.path:
    sys.path.append(str(_SHARED_LIB))

from hook_runtime import detect_active_subagent, find_active_session, resolve_project_root

# canonical_statuses lives in shared/lib/ and reads dispatch-manifest.schema.json at
# import time via a SOURCE-tree-relative path (Path(__file__).parents[2]/shared/schemas/).
# In a deployed consumer repo neither that module nor the schema is present, so a
# top-level import would crash this Stop hook on load (ModuleNotFoundError /
# FileNotFoundError) — and a crashing Stop hook emits no block decision, i.e. it fails
# OPEN. Try the canonical source first (source tree → live schema, no drift); fall back
# to a faithful literal so the hook is self-contained and runs in EVERY layout.
# Keep this fallback in sync with shared/schemas/dispatch-manifest.schema.json (status enum).
try:
    from canonical_statuses import (
        VALID_STATUSES as _CANONICAL_VALID_STATUSES,
        format_valid_list as _format_valid_list,
    )
except Exception:
    _CANONICAL_VALID_STATUSES = frozenset({
        "pending", "running", "done", "needs_review", "needs_changes",
        "partial", "blocked", "escalate", "failed",
    })

    def _format_valid_list(values) -> str:  # mirrors canonical_statuses.format_valid_list
        return ", ".join(sorted(values))

# Subagent roles for which an Output Packet is mandatory at SubagentStop.
# Other subagent_types (e.g., user-dispatched general-purpose, Explore) are
# silently allowed — the Output Packet contract is specific to Phase 4 roles.
_PHASE_4_SUBAGENTS = frozenset({
    "dev",
    "code-reviewer",
    "logic-reviewer",
    "qa",
    "audit-agent",
    "committer",
    "blocker-specialist",
    "chronicler",
})


def _try_append_warning(task_id: str, reason: str, metadata: dict | None = None) -> None:
    """AC-007: append a warning via shared/lib/warnings.py for soft-fail conditions."""
    try:
        _spec = _ilu.spec_from_file_location("squad_warnings", str(_SHARED_LIB / "warnings.py"))
        if _spec and _spec.loader:
            _mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)  # type: ignore[union-attr]
            _mod.append_warning(task_id, reason, "verify-output-packet", metadata=metadata, severity="warning")
    except Exception as exc:
        print(f"verify-output-packet: warning append skipped ({exc})", file=sys.stderr)

REQUIRED_FIELDS = {"spec_id", "dispatch_id", "role", "status", "summary", "evidence"}
# Identity contract (shared/concepts/identity.md): task-scoped roles carry
# task_id as T-XXX; pipeline-scoped roles (audit-agent, committer) omit it.
TASK_SCOPED_ROLES = {"dev", "code-reviewer", "logic-reviewer", "qa", "blocker-specialist"}
_TASK_ID_RE = re.compile(r"^T-\d{3,}$")
# VALID_STATUSES derived from canonical source — do NOT hardcode here.
# Single source: shared/schemas/dispatch-manifest.schema.json via shared/lib/canonical_statuses.py (T-002).
# AC-002, AC-013: extending the schema enum propagates automatically to this hook without edits.
VALID_STATUSES = _CANONICAL_VALID_STATUSES

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


def _normalize_ac_id(value: str) -> str:
    """Reduce an AC reference to its bare AC-NNN suffix for set comparison.
    'FEAT-002/AC-001' -> 'AC-001'; 'AC-001' -> 'AC-001'. The qa packet keys carry
    the feature prefix ('FEAT-NNN/AC-NNN'); the Work Packet's ac_scope may carry it
    or not — normalizing both ends makes the comparison form-agnostic.
    """
    return value.rsplit("/", 1)[-1].strip()


def _load_dispatch_ac_scope(packet_path: Path, dispatch_id: str):
    """Read this dispatch's Work Packet (inputs/<dispatch_id>.json, the same pairing
    _check_model_drift uses) and return its ac_scope as a normalized set. Returns
    None when the Work Packet is absent/unreadable or carries no usable ac_scope —
    the caller then skips the membership check (fail-open; the audit-agent Check 5
    remains the backstop, so an old run without inputs/ is never spuriously blocked).
    """
    wp_path = packet_path.parent.parent / "inputs" / f"{dispatch_id}.json"
    try:
        wp = json.loads(wp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    scope = wp.get("ac_scope")
    if not isinstance(scope, list) or not scope:
        return None
    normalized = {_normalize_ac_id(s) for s in scope if isinstance(s, str) and s.strip()}
    return normalized or None


def _validate_qa_ac_scope(packet: dict, packet_path: Path) -> tuple[bool, str]:
    """FEAT-041 shift-left of audit Check 5: the qa packet's ac_coverage keys must
    match this dispatch's ac_scope — every scoped AC covered, and NO AC from outside
    the scope (a qa packet listing other tasks' ACs was the FEAT-041 defect, caught
    only at the final audit gate). Fail-open when ac_scope is unavailable.
    """
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    scope = _load_dispatch_ac_scope(packet_path, str(dispatch_id))
    if scope is None:
        return True, "valid"  # no scope to compare against — defer to audit Check 5
    ac_coverage = packet.get("ac_coverage")
    if not isinstance(ac_coverage, dict):
        return True, "valid"  # shape is _validate_qa_fields' responsibility
    covered = {_normalize_ac_id(k) for k in ac_coverage.keys()}
    missing = scope - covered
    if missing:
        return (
            False,
            f"dispatch_id={dispatch_id}: qa 'ac_coverage' is missing AC(s) from this "
            f"dispatch's ac_scope: {sorted(missing)} — every scoped AC MUST be a key",
        )
    extra = covered - scope
    if extra:
        return (
            False,
            f"dispatch_id={dispatch_id}: qa 'ac_coverage' lists AC(s) outside this "
            f"dispatch's ac_scope: {sorted(extra)} — a qa packet validates only its own "
            "ac_scope; these belong to another task/dispatch",
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
                # Match the real dispatch_id token the orchestrator emits:
                # role+loop are embedded (e.g. d-T-001-dev-l1, d-FEAT-011-audit-7f0c2e91),
                # so the charset must allow non-hex letters. The old [0-9a-fA-F-]{8,}
                # only matched pure UUIDs and returned None for every real id — making
                # this Stop hook fail OPEN for the entire pipeline.
                m = re.search(r"dispatch_id:\s*[\"']?([A-Za-z0-9][A-Za-z0-9_-]{2,})", content)
                if m:
                    return m.group(1)
    except OSError:
        return None
    return None


_USAGE_EXEMPT_ROLES = {"pm-orchestrator"}


def _validate_usage_field(packet: dict) -> tuple[bool, str]:
    """AC-001 (usage enforcement): every role except pm-orchestrator must have 'usage' field present.

    'usage' may be null (hook fills it post-write) or an object — both accepted
    at write time. The field must exist as a key in the packet.
    """
    role = packet.get("role", "")
    if role in _USAGE_EXEMPT_ROLES:
        return True, "valid"
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    if "usage" not in packet:
        return (
            False,
            f"usage field is required for role {role} (dispatch_id={dispatch_id})",
        )
    return True, "valid"


def _validate_task_id_field(packet: dict) -> tuple[bool, str]:
    """Identity contract (shared/concepts/identity.md): task-scoped roles MUST
    carry task_id as T-XXX (the task, not the feature — the feature is spec_id).
    Pipeline-scoped roles (audit-agent, committer) have no single task and omit it.
    """
    role = packet.get("role", "")
    if role not in TASK_SCOPED_ROLES:
        return True, "valid"
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    task_id = packet.get("task_id")
    if not task_id:
        return (
            False,
            f"dispatch_id={dispatch_id}: {role} Output Packet missing required field "
            "'task_id' (T-XXX — the task this packet belongs to; see identity.md)",
        )
    if not _TASK_ID_RE.match(str(task_id)):
        return (
            False,
            f"dispatch_id={dispatch_id}: {role} 'task_id' = '{task_id}' must match "
            r"^T-\d{3,}$ — that is the task, not the feature (the feature is spec_id)",
        )
    return True, "valid"


_DECISION_KINDS = {"decision", "deviation"}


def _validate_decisions_field(packet: dict) -> tuple[bool, str]:
    """dev-only `decisions[]`: source for the delivery-report's why/deviations.
    Optional on dev (absence is valid). Forbidden on any non-dev role. When present
    on dev, each item must have id, kind in {decision, deviation}, summary, rationale.
    """
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    role = packet.get("role", "")
    decisions = packet.get("decisions")
    if decisions is None:
        return True, "valid"
    if role != "dev":
        return (
            False,
            f"dispatch_id={dispatch_id}: '{role}' Output Packet has 'decisions' but the "
            "field is dev-only — only the dev declares decisions/deviations",
        )
    if not isinstance(decisions, list):
        return (
            False,
            f"dispatch_id={dispatch_id}: dev 'decisions' must be an array, "
            f"got {type(decisions).__name__}",
        )
    for i, item in enumerate(decisions):
        if not isinstance(item, dict):
            return False, f"dispatch_id={dispatch_id}: dev 'decisions[{i}]' must be an object"
        for key in ("id", "kind", "summary", "rationale"):
            if key not in item:
                return (
                    False,
                    f"dispatch_id={dispatch_id}: dev 'decisions[{i}]' missing required key '{key}'",
                )
        if item["kind"] not in _DECISION_KINDS:
            return (
                False,
                f"dispatch_id={dispatch_id}: dev 'decisions[{i}].kind' = '{item['kind']}' "
                f"not in {sorted(_DECISION_KINDS)}",
            )
    return True, "valid"


def validate_packet(packet_path: Path) -> tuple[bool, str]:
    try:
        packet = json.loads(packet_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        return False, f"Output Packet at {packet_path.name} is unreadable ({exc})"
    missing = REQUIRED_FIELDS - set(packet.keys())
    if missing:
        return False, f"Output Packet missing required fields: {sorted(missing)}"
    status = packet.get("status")
    if status not in VALID_STATUSES:
        return False, (
            f"Output Packet status '{status}' not in valid statuses: "
            f"{_format_valid_list(VALID_STATUSES)}"
        )
    # BUG 2 fix: a blocked/escalate packet MUST name its cause. The schema describes
    # blocker_kind as "required when status is blocked or escalate" but never enforced
    # it; an audit packet shipped status=blocked with blocker_kind absent and the
    # orchestrator could not branch its handoff. Catch it at the write point.
    if status in {"blocked", "escalate"} and not packet.get("blocker_kind"):
        return False, (
            f"Output Packet status '{status}' requires a non-empty 'blocker_kind' field "
            "(e.g. bypass_detected, schema_violation, missing_output_packet, "
            "contract_violation) — see shared/schemas/output-packet.schema.json"
        )
    # AC-001: usage field enforcement (universal, pm-orchestrator exempt).
    # Checked separately from REQUIRED_FIELDS to emit role-specific error message.
    ok, reason = _validate_usage_field(packet)
    if not ok:
        return False, reason
    # Identity contract: task-scoped roles must carry task_id (T-XXX).
    ok, reason = _validate_task_id_field(packet)
    if not ok:
        return False, reason
    # dev-only decisions[] (delivery-report source); forbidden on other roles.
    ok, reason = _validate_decisions_field(packet)
    if not ok:
        return False, reason
    # Discriminated-union role-specific validation (qa, code-reviewer, logic-reviewer).
    role = packet.get("role", "")
    role_validator = ROLE_REQUIRED_FIELDS.get(role)
    if role_validator is not None:
        ok, reason = role_validator(packet)
        if not ok:
            return False, reason
    # FEAT-041 shift-left: qa ac_coverage must match the dispatch's ac_scope. Runs
    # after the shape check above and needs the on-disk path to find the paired
    # Work Packet (inputs/<dispatch_id>.json) — fail-open when that is absent.
    if role == "qa":
        ok, reason = _validate_qa_ac_scope(packet, packet_path)
        if not ok:
            return False, reason
    return True, "valid"


def _check_model_drift(output_packet_path: Path) -> list[str]:
    """FEAT-008 Gap A: compare Work Packet `model` with Output Packet `usage.model`.

    Returns a list of warning strings (empty when no drift or when the paired
    Work Packet is absent). Never blocks — emits warnings only.

    Heuristic: the canonical model (e.g. "sonnet") is expected as a substring of
    the resolved id (e.g. "claude-sonnet-4-5-..."). Case-insensitive.
    """
    try:
        op = json.loads(output_packet_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    usage = op.get("usage")
    if not isinstance(usage, dict):
        return []
    resolved = usage.get("model")
    if not isinstance(resolved, str) or not resolved:
        return []

    dispatch_id = op.get("dispatch_id")
    if not isinstance(dispatch_id, str) or not dispatch_id:
        return []

    wp_path = output_packet_path.parent.parent / "inputs" / f"{dispatch_id}.json"
    try:
        wp = json.loads(wp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    requested = wp.get("model")
    if not isinstance(requested, str) or not requested:
        return []

    if requested.lower() in resolved.lower():
        return []

    return [
        f"model_drift: dispatch_id={dispatch_id} requested='{requested}' "
        f"resolved='{resolved}' — Task tool model param may have been dropped"
    ]


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


_TASK_ID_RE_MAIN = re.compile(r"^(FEAT|DISC)-\d{3,4}$")


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

    # Subagent-scope gate: only Phase 4 dispatch roles owe an Output Packet.
    # When deploy registers this hook globally under SubagentStop, any other
    # subagent (e.g., user-dispatched Explore, general-purpose, claude-code-guide)
    # would otherwise be blocked at completion. detect_active_subagent returns
    # None when the transcript carries no Work Packet — pre-Phase-4 sessions
    # or main-session-spawned subagents — and the original dispatch_id check
    # below also gates that path. Belt-and-suspenders.
    active_subagent = detect_active_subagent(payload)
    if active_subagent is not None and active_subagent not in _PHASE_4_SUBAGENTS:
        return 0
    # Fail-closed posture: when we positively identify a Phase 4 dispatch role, any
    # failure to resolve its Output Packet below is a BLOCK, not a silent pass. A
    # confirmed Phase 4 role that cannot produce a verifiable packet is exactly the
    # malformed-artifact case this hook exists to stop. Roles we cannot identify
    # (active_subagent is None — e.g. user-dispatched Explore/general-purpose) keep
    # failing open so unrelated subagents are never blocked.
    is_phase4 = active_subagent in _PHASE_4_SUBAGENTS

    def _block(reason: str) -> int:
        print(json.dumps({"decision": "block", "reason": reason}))
        return 0

    transcript_path_str = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not transcript_path_str:
        if is_phase4:
            return _block(
                f"{active_subagent} (Phase 4 role) stopped without a transcript to verify "
                "its Output Packet. Emit the packet per your role's output contract."
            )
        return 0  # unidentified subagent, no transcript — fail open
    transcript_path = Path(transcript_path_str)

    dispatch_id = extract_dispatch_id(transcript_path)
    if not dispatch_id:
        if is_phase4:
            return _block(
                f"{active_subagent} (Phase 4 role) stopped but no dispatch_id was found in "
                "its Work Packet/transcript — cannot locate the Output Packet to verify. "
                "Echo dispatch_id from the Work Packet and emit outputs/<dispatch_id>.json."
            )
        # Unidentified subagent without a dispatch_id — likely a non-dispatched
        # invocation (e.g., user-triggered direct call). Don't block.
        return 0

    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None and is_phase4:
        return _block(
            f"{active_subagent} (Phase 4 role, dispatch_id={dispatch_id}) stopped but no "
            "active .agent-session/<spec_id>/ directory was found to hold its Output Packet."
        )
    if session_dir is None:
        # AC-007: soft-fail — dispatch_id found but no session dir; warn if task_id extractable.
        # Derivation: take the first two dash-separated segments (e.g. "FEAT-003-dev" → "FEAT-003").
        # If the candidate does not match (FEAT|DISC)-NNN, fall through to orphans file.
        parts = dispatch_id.split("-")
        task_id_candidate = f"{parts[0]}-{parts[1]}" if len(parts) >= 2 else None
        if task_id_candidate and _TASK_ID_RE_MAIN.match(task_id_candidate):
            _try_append_warning(
                task_id_candidate,
                "session_dir_not_found",
                metadata={"dispatch_id": dispatch_id},
            )
        else:
            # Fallback: write to global orphans file so the warning is not silently dropped.
            orphans_path = project_dir / ".agent-session" / "_orphans" / "warnings.json"
            try:
                orphans_path.parent.mkdir(parents=True, exist_ok=True)
                import fcntl as _fcntl
                with orphans_path.open("a+", encoding="utf-8") as _fh:
                    _fcntl.flock(_fh.fileno(), _fcntl.LOCK_EX)
                    try:
                        _fh.seek(0)
                        _raw = _fh.read().strip()
                        _doc = {"schema_version": 1, "warnings": []}
                        if _raw:
                            try:
                                _parsed = json.loads(_raw)
                                if isinstance(_parsed, dict) and isinstance(_parsed.get("warnings"), list):
                                    _doc = _parsed
                            except json.JSONDecodeError:
                                pass
                        import uuid as _uuid
                        from datetime import datetime as _dt, timezone as _tz
                        _doc["warnings"].append({
                            "id": str(_uuid.uuid4()),
                            "timestamp": _dt.now(_tz.utc).isoformat(),
                            "source": "verify-output-packet",
                            "reason": "session_dir_not_found",
                            "severity": "warning",
                            "metadata": {"dispatch_id": dispatch_id, "task_id": None},
                        })
                        _fh.seek(0)
                        _fh.truncate()
                        json.dump(_doc, _fh, indent=2)
                        _fh.write("\n")
                    finally:
                        _fcntl.flock(_fh.fileno(), _fcntl.LOCK_UN)
            except Exception:
                pass
        return 0

    task_id = session_dir.name
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

    # FEAT-008 Gap A: model drift warning (non-blocking).
    for w in _check_model_drift(packet_path):
        print(f"verify-output-packet: WARN {w}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
