#!/usr/bin/env python3
"""
stdlib unittest tests for role-aware required-fields validation in verify-output-packet.py.
Covers AC-001 (qa must have non-empty ac_coverage object) and AC-002 (reviewers must have
findings array with valid item shapes).

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_verify_output_packet_roles
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

# Ensure the hooks directory is importable regardless of invocation style.
# The hook file uses hyphens in its name, so we load it via importlib.
import importlib.util

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_FILE = _HOOKS_DIR / "verify-output-packet.py"
_spec = importlib.util.spec_from_file_location("verify_output_packet", _HOOK_FILE)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
validate_packet = _mod.validate_packet
check_only = _mod.check_only
_derive_dispatch_id = _mod._derive_dispatch_id
extract_dispatch_id = _mod.extract_dispatch_id


def _write_packet(tmp_dir: Path, data: dict) -> Path:
    p = tmp_dir / "packet.json"
    p.write_text(json.dumps(data))
    return p


BASE_PACKET = {
    "spec_id": "FEAT-002",
    "task_id": "T-001",  # identity contract: task-scoped roles carry task_id (T-XXX)
    "dispatch_id": "d-001",
    "role": "dev",
    "status": "done",
    "summary": "implemented feature",
    "evidence": [],
    # AC-001 (usage enforcement): usage field required for all non-pm-orchestrator roles.
    # Set to None (hook fills it post-write) so role-specific tests don't fail on usage gate.
    "usage": None,
}


class TestValidPacketPerRole(unittest.TestCase):
    """Valid packet passes for each affected role."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_valid_qa_packet(self):
        """AC-001: valid qa packet with correct object ac_coverage format."""
        data = {
            **BASE_PACKET,
            "role": "qa",
            "ac_coverage": {"FEAT-002/AC-001": ["e-001", "e-003"]},
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_qa_packet_multiple_acs(self):
        """AC-001: valid qa packet with multiple AC keys."""
        data = {
            **BASE_PACKET,
            "role": "qa",
            "ac_coverage": {
                "FEAT-002/AC-001": ["e-001", "e-003"],
                "FEAT-002/AC-002": ["e-002"],
            },
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_qa_packet_disc_prefix(self):
        """AC-001: DISC-prefixed keys are valid per schema patternProperties."""
        data = {
            **BASE_PACKET,
            "role": "qa",
            "ac_coverage": {"DISC-001/AC-001": ["e-001"]},
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_code_reviewer_packet_with_findings(self):
        data = {
            **BASE_PACKET,
            "role": "code-reviewer",
            "findings": [{"id": "f1", "severity": "warning"}],
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_code_reviewer_packet_empty_findings(self):
        """Empty findings list is explicitly valid — means 'no findings found'."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": []}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_logic_reviewer_packet_with_findings(self):
        data = {
            **BASE_PACKET,
            "role": "logic-reviewer",
            "findings": [{"id": "f1", "severity": "major"}],
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_logic_reviewer_packet_empty_findings(self):
        """Empty findings list is explicitly valid for logic-reviewer too."""
        data = {**BASE_PACKET, "role": "logic-reviewer", "findings": []}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_dev_packet_no_role_fields(self):
        """dev role: no extra fields required — baseline REQUIRED_FIELDS only."""
        data = {**BASE_PACKET, "role": "dev"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_audit_agent_packet(self):
        data = {**BASE_PACKET, "role": "audit-agent"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_blocker_specialist_packet(self):
        data = {**BASE_PACKET, "role": "blocker-specialist"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_valid_findings_all_severity_values(self):
        """AC-002: all seven canonical severity values are accepted."""
        for sev in ("info", "warning", "error", "critical", "major", "blocker", "minor"):
            with self.subTest(severity=sev):
                data = {
                    **BASE_PACKET,
                    "role": "code-reviewer",
                    "findings": [{"id": "f1", "severity": sev}],
                }
                p = _write_packet(self.tmp, data)
                ok, reason = validate_packet(p)
                self.assertTrue(ok, f"severity={sev} should be valid: {reason}")


class TestTaskIdIdentity(unittest.TestCase):
    """Identity contract (shared/concepts/identity.md): task-scoped roles carry
    task_id (T-XXX); pipeline-scoped roles (audit-agent, committer) omit it."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_task_scoped_role_missing_task_id_fails(self):
        data = {k: v for k, v in BASE_PACKET.items() if k != "task_id"}
        data["role"] = "dev"
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("task_id", reason)

    def test_task_id_holding_feature_id_fails(self):
        """task_id must be T-XXX, never the feature (FEAT-NNN) — the overload bug."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": [], "task_id": "FEAT-002"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("task_id", reason)

    def test_audit_agent_without_task_id_ok(self):
        """Pipeline-scoped role: no single task, task_id omitted is valid."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "task_id"}
        data["role"] = "audit-agent"
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_committer_without_task_id_ok(self):
        data = {k: v for k, v in BASE_PACKET.items() if k != "task_id"}
        data["role"] = "committer"
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)


class TestQaAcCoverageValidation(unittest.TestCase):
    """AC-001: qa must have non-empty ac_coverage object with pattern keys."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_qa_missing_ac_coverage_fails(self):
        data = {**BASE_PACKET, "role": "qa"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("ac_coverage", reason)
        self.assertIn("d-001", reason)

    def test_qa_empty_ac_coverage_object_fails(self):
        """Empty dict (no keys) fails — must be non-empty."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("ac_coverage", reason)
        self.assertIn("d-001", reason)

    def test_qa_ac_coverage_list_fails(self):
        """Old array format is now rejected — schema defines ac_coverage as object."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": [{"ac_id": "AC-001", "status": "pass"}]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("object", reason)

    def test_qa_ac_coverage_invalid_key_fails(self):
        """Key not matching ^(FEAT|DISC)-NNN/AC-NNN is rejected."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {"AC-001": ["e-001"]}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("AC-001", reason)

    def test_qa_ac_coverage_value_not_list_fails(self):
        """Value must be an array (list of evidence id strings)."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {"FEAT-002/AC-001": "e-001"}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("array", reason)

    def test_qa_ac_coverage_empty_value_list_fails(self):
        """Value list must not be empty — needs at least one evidence id."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {"FEAT-002/AC-001": []}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("non-empty", reason)

    def test_qa_ac_coverage_value_non_string_item_fails(self):
        """Evidence ids in value list must be strings."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {"FEAT-002/AC-001": [123]}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("string", reason)

    def test_qa_ac_coverage_key_short_number_fails(self):
        """Key with 2-digit id fails — pattern requires 3+ digits."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {"FEAT-02/AC-01": ["e-001"]}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)

    def test_qa_ac_coverage_valid_three_digit_ids(self):
        """3-digit FEAT/AC ids are the minimum and must pass."""
        data = {**BASE_PACKET, "role": "qa", "ac_coverage": {"FEAT-002/AC-001": ["e-001"]}}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_qa_ac_coverage_multiple_items_passes(self):
        data = {
            **BASE_PACKET,
            "role": "qa",
            "ac_coverage": {
                "FEAT-002/AC-001": ["e-001"],
                "FEAT-002/AC-002": ["e-002"],
            },
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)


class TestReviewerFindingsValidation(unittest.TestCase):
    """AC-002: code-reviewer and logic-reviewer must have findings array (empty [] is valid)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_code_reviewer_missing_findings_fails(self):
        data = {**BASE_PACKET, "role": "code-reviewer"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("findings", reason)
        self.assertIn("d-001", reason)

    def test_logic_reviewer_missing_findings_fails(self):
        data = {**BASE_PACKET, "role": "logic-reviewer"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("findings", reason)
        self.assertIn("d-001", reason)

    def test_code_reviewer_findings_not_list_fails(self):
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": "none"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("findings", reason)

    def test_logic_reviewer_findings_not_list_fails(self):
        data = {**BASE_PACKET, "role": "logic-reviewer", "findings": None}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("findings", reason)

    def test_code_reviewer_empty_findings_passes(self):
        """Explicitly documented: empty [] is a valid claim of 'no findings'."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": []}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_logic_reviewer_empty_findings_passes(self):
        data = {**BASE_PACKET, "role": "logic-reviewer", "findings": []}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_findings_item_missing_id_fails(self):
        """AC-002: finding item without 'id' key is rejected."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": [{"severity": "blocker"}]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("id", reason)

    def test_findings_item_missing_severity_fails(self):
        """AC-002: finding item without 'severity' key is rejected."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": [{"id": "f-001"}]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("severity", reason)

    def test_findings_item_severity_minor_accepted(self):
        """AC-002: 'minor' severity is now in canonical enum (reviewer .md usage)."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": [{"id": "f-001", "severity": "minor"}]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, f"'minor' should be valid: {reason}")

    def test_findings_item_invalid_severity_fails(self):
        """AC-002: severity not in canonical enum is rejected (e.g., 'unknown')."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": [{"id": "f-001", "severity": "unknown"}]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("severity", reason)
        self.assertIn("unknown", reason)

    def test_findings_item_not_dict_fails(self):
        """AC-002: finding item that is not an object is rejected."""
        data = {**BASE_PACKET, "role": "code-reviewer", "findings": ["f-001"]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)

    def test_findings_optional_fields_not_enforced(self):
        """AC-002: optional fields (file, line, rationale, dimension, gap_kind) may be absent."""
        data = {
            **BASE_PACKET,
            "role": "code-reviewer",
            "findings": [{"id": "f-001", "severity": "info"}],
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)


class TestUnaffectedRoles(unittest.TestCase):
    """Roles other than qa/code-reviewer/logic-reviewer: no extra fields required."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _check_role(self, role: str):
        data = {**BASE_PACKET, "role": role}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, f"role={role} should pass with baseline fields; got: {reason}")

    def test_dev_unchanged(self):
        self._check_role("dev")

    def test_audit_agent_unchanged(self):
        self._check_role("audit-agent")

    def test_blocker_specialist_unchanged(self):
        self._check_role("blocker-specialist")


class TestCheckOnlyDispatchId(unittest.TestCase):
    """--check-only error JSON must include dispatch_id derived from file basename stem."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_check_only_error_includes_dispatch_id(self):
        """Invalid packet error JSON must contain dispatch_id from file basename stem."""
        # File named d-001-qa.json: dispatch_id should be d-001-qa
        p = self.tmp / "d-001-qa.json"
        p.write_text(json.dumps({**BASE_PACKET, "role": "qa"}))  # qa without ac_coverage
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            exit_code = check_only(p)
        self.assertEqual(exit_code, 1)
        output = json.loads(buf.getvalue())
        self.assertFalse(output["valid"])
        self.assertIn("dispatch_id", output)
        self.assertEqual(output["dispatch_id"], "d-001-qa")

    def test_check_only_success_includes_dispatch_id(self):
        """Valid packet success JSON also includes dispatch_id from file basename stem."""
        p = self.tmp / "d-002.json"
        p.write_text(json.dumps({**BASE_PACKET, "role": "dev"}))
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            exit_code = check_only(p)
        self.assertEqual(exit_code, 0)
        output = json.loads(buf.getvalue())
        self.assertTrue(output["valid"])
        self.assertIn("dispatch_id", output)
        self.assertEqual(output["dispatch_id"], "d-002")

    def test_check_only_missing_file_includes_dispatch_id(self):
        """Missing file error JSON also includes dispatch_id from file basename stem."""
        p = self.tmp / "d-003-missing.json"
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            exit_code = check_only(p)
        self.assertEqual(exit_code, 1)
        output = json.loads(buf.getvalue())
        self.assertFalse(output["valid"])
        self.assertIn("dispatch_id", output)
        self.assertEqual(output["dispatch_id"], "d-003-missing")

    def test_derive_dispatch_id_strips_json_suffix(self):
        """_derive_dispatch_id returns the stem (no .json suffix)."""
        p = Path("/some/path/d-001-qa.json")
        self.assertEqual(_derive_dispatch_id(p), "d-001-qa")


# ===========================================================================
# FEAT-008 Gap A: model drift detection
# ===========================================================================

class TestFEAT008ModelDriftDetection(unittest.TestCase):
    """Drift between Work Packet `model` and Output Packet `usage.model`
    emits a warning to stderr but does NOT block Stop."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp())
        self._task_dir = self._tmp / "T-001"
        (self._task_dir / "inputs").mkdir(parents=True)
        (self._task_dir / "outputs").mkdir(parents=True)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_paired_packets(self, requested_model: str, resolved_model: str) -> Path:
        dispatch_id = "d-T-001-dev-l1"
        wp_path = self._task_dir / "inputs" / f"{dispatch_id}.json"
        wp_path.write_text(json.dumps({
            "spec_id": "FEAT-099",
            "dispatch_id": dispatch_id,
            "to_role": "dev",
            "model": requested_model,
            "effort": "high",
        }), encoding="utf-8")
        op_path = self._task_dir / "outputs" / f"{dispatch_id}.json"
        op_path.write_text(json.dumps({
            "spec_id": "FEAT-099",
            "dispatch_id": dispatch_id,
            "role": "dev",
            "status": "done",
            "summary": "ok",
            "evidence": [],
            "usage": {
                "total_tokens": 100,
                "tool_uses": 1,
                "duration_ms": 10,
                "model": resolved_model,
            },
        }), encoding="utf-8")
        return op_path

    def test_drift_emits_warning(self):
        op = self._write_paired_packets(requested_model="sonnet", resolved_model="opus")
        _check_model_drift = _mod._check_model_drift
        warnings = _check_model_drift(op)
        self.assertTrue(warnings)
        joined = " ".join(warnings).lower()
        self.assertIn("sonnet", joined)
        self.assertIn("opus", joined)

    def test_substring_match_emits_no_warning(self):
        op = self._write_paired_packets(requested_model="sonnet", resolved_model="claude-sonnet-4-5")
        _check_model_drift = _mod._check_model_drift
        self.assertEqual(_check_model_drift(op), [])

    def test_no_work_packet_no_warning(self):
        dispatch_id = "d-T-002-dev-l1"
        op_path = self._task_dir / "outputs" / f"{dispatch_id}.json"
        op_path.write_text(json.dumps({
            "spec_id": "FEAT-099",
            "dispatch_id": dispatch_id,
            "role": "dev",
            "status": "done",
            "summary": "ok",
            "evidence": [],
            "usage": {"total_tokens": 100, "tool_uses": 1, "duration_ms": 10, "model": "opus"},
        }), encoding="utf-8")
        _check_model_drift = _mod._check_model_drift
        self.assertEqual(_check_model_drift(op_path), [])


# ===========================================================================
# BUG 1 (mechanism): extract_dispatch_id must match REAL dispatch_ids.
# The original regex [0-9a-fA-F-]{8,} only matched pure hex/UUID ids, so every
# real id like d-T-001-dev-l1 returned None and the Stop hook failed OPEN.
# ===========================================================================

class TestExtractDispatchIdRealFormats(unittest.TestCase):
    """extract_dispatch_id must recover the canonical dispatch_id token that the
    orchestrator emits in the Work Packet (role+loop embedded, non-hex letters)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def _transcript_with(self, dispatch_line: str) -> Path:
        p = self.tmp / "transcript.jsonl"
        # One JSONL entry whose content carries the Work Packet text.
        entry = {"content": f"WorkPacket:\nsubagent_type: dev\n{dispatch_line}\n"}
        p.write_text(json.dumps(entry) + "\n", encoding="utf-8")
        return p

    def test_dev_dispatch_id_recovered(self):
        tp = self._transcript_with("dispatch_id: d-T-001-dev-l1")
        self.assertEqual(extract_dispatch_id(tp), "d-T-001-dev-l1")

    def test_qa_dispatch_id_recovered(self):
        tp = self._transcript_with("dispatch_id: d-T-007-qa-l1")
        self.assertEqual(extract_dispatch_id(tp), "d-T-007-qa-l1")

    def test_audit_dispatch_id_recovered(self):
        tp = self._transcript_with("dispatch_id: d-FEAT-011-audit-7f0c2e91")
        self.assertEqual(extract_dispatch_id(tp), "d-FEAT-011-audit-7f0c2e91")

    def test_reviewer_dispatch_id_recovered(self):
        tp = self._transcript_with("dispatch_id: d-T-003-cr-l2")
        self.assertEqual(extract_dispatch_id(tp), "d-T-003-cr-l2")

    def test_quoted_dispatch_id_recovered(self):
        tp = self._transcript_with('dispatch_id: "d-T-001-dev-l1"')
        self.assertEqual(extract_dispatch_id(tp), "d-T-001-dev-l1")

    def test_pure_uuid_still_recovered(self):
        """Backward-compat: a pure-UUID dispatch_id must still match."""
        tp = self._transcript_with("dispatch_id: 7f0c2e91-1234-4abc-9def-0123456789ab")
        self.assertEqual(extract_dispatch_id(tp), "7f0c2e91-1234-4abc-9def-0123456789ab")

    def test_trailing_comment_not_captured(self):
        tp = self._transcript_with("dispatch_id: d-T-001-dev-l1  # set by orchestrator")
        self.assertEqual(extract_dispatch_id(tp), "d-T-001-dev-l1")


# ===========================================================================
# BUG 2: blocker_kind must be mechanically required when status is blocked/escalate.
# The audit packet shipped status=blocked with blocker_kind absent and nothing caught it.
# ===========================================================================

class TestBlockerKindEnforcement(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_blocked_without_blocker_kind_fails(self):
        data = {**BASE_PACKET, "role": "audit-agent", "status": "blocked"}
        data.pop("task_id", None)  # audit-agent is pipeline-scoped
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("blocker_kind", reason)

    def test_escalate_without_blocker_kind_fails(self):
        data = {**BASE_PACKET, "role": "audit-agent", "status": "escalate"}
        data.pop("task_id", None)
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("blocker_kind", reason)

    def test_blocked_with_blocker_kind_passes(self):
        data = {**BASE_PACKET, "role": "audit-agent", "status": "blocked",
                "blocker_kind": "schema_violation"}
        data.pop("task_id", None)
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_done_without_blocker_kind_passes(self):
        """Non-blocked statuses do not require blocker_kind."""
        data = {**BASE_PACKET, "role": "dev", "status": "done"}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_blocked_with_empty_blocker_kind_fails(self):
        data = {**BASE_PACKET, "role": "audit-agent", "status": "blocked", "blocker_kind": ""}
        data.pop("task_id", None)
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("blocker_kind", reason)


# ===========================================================================
# BUG 1 (fail-closed): the Stop hook, invoked end-to-end, must BLOCK a Phase-4
# subagent whose Output Packet is malformed or missing — not fail open.
# Exercises main() via subprocess, the way Claude Code actually runs the hook.
# ===========================================================================

class TestStopHookFailClosed(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.project = self.tmp / "proj"
        self.session = self.project / ".agent-session" / "FEAT-011"
        (self.session / "outputs").mkdir(parents=True)
        # A real Session always carries a session.yml; find_active_session filters
        # candidates by its presence, so the fixture must mirror production.
        (self.session / "session.yml").write_text(
            "current_phase: implementation\n", encoding="utf-8")

    def _transcript(self, role: str, dispatch_id: str) -> Path:
        p = self.tmp / "transcript.jsonl"
        entry = {"content": f"WorkPacket:\nsubagent_type: {role}\ndispatch_id: {dispatch_id}\n"}
        p.write_text(json.dumps(entry) + "\n", encoding="utf-8")
        return p

    def _run_hook(self, transcript: Path):
        import os
        payload = {"transcript_path": str(transcript), "cwd": str(self.project)}
        env = {**os.environ, "CLAUDE_PROJECT_DIR": str(self.project)}
        proc = subprocess.run(
            [sys.executable, str(_HOOK_FILE)],
            input=json.dumps(payload),
            capture_output=True, text=True, env=env,
        )
        return proc

    def test_malformed_dev_packet_is_blocked(self):
        """dev packet missing role/summary must be blocked at SubagentStop."""
        dispatch_id = "d-T-001-dev-l1"
        bad = {"spec_id": "FEAT-011", "task_id": "T-001", "dispatch_id": dispatch_id,
               "status": "done", "evidence": [], "usage": None}  # no role, no summary
        (self.session / "outputs" / f"{dispatch_id}.json").write_text(json.dumps(bad))
        proc = self._run_hook(self._transcript("dev", dispatch_id))
        self.assertIn('"decision": "block"', proc.stdout, proc.stdout + proc.stderr)

    def test_missing_qa_packet_is_blocked(self):
        """Phase-4 role with no packet on disk must be blocked, not passed."""
        proc = self._run_hook(self._transcript("qa", "d-T-002-qa-l1"))
        self.assertIn('"decision": "block"', proc.stdout, proc.stdout + proc.stderr)

    def test_valid_dev_packet_allows_stop(self):
        dispatch_id = "d-T-001-dev-l1"
        good = {**BASE_PACKET, "role": "dev", "dispatch_id": dispatch_id}
        (self.session / "outputs" / f"{dispatch_id}.json").write_text(json.dumps(good))
        proc = self._run_hook(self._transcript("dev", dispatch_id))
        self.assertNotIn('"decision": "block"', proc.stdout)

    def test_non_phase4_subagent_not_blocked(self):
        """An Explore/general-purpose subagent owes no packet — must not be blocked."""
        proc = self._run_hook(self._transcript("Explore", "whatever-id"))
        self.assertNotIn('"decision": "block"', proc.stdout)


# ===========================================================================
# FEAT-041 shift-left: qa ac_coverage keys must match the dispatch's ac_scope
# (read from the paired Work Packet at inputs/<dispatch_id>.json). The audit-agent
# Check 5 caught a qa packet whose ac_coverage listed other tasks' ACs only at the
# final gate; this moves the same invariant to packet-emission time.
# ===========================================================================

class TestQaAcScopeMembership(unittest.TestCase):
    """qa ac_coverage must cover exactly its dispatch's ac_scope: every scoped AC
    present as a key, and no AC from outside the scope. Fail-open when the Work
    Packet or its ac_scope is unavailable (audit Check 5 remains the backstop)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.session = self.tmp / ".agent-session" / "FEAT-002"
        (self.session / "inputs").mkdir(parents=True)
        (self.session / "outputs").mkdir(parents=True)

    def _write_wp(self, dispatch_id: str, ac_scope) -> None:
        (self.session / "inputs" / f"{dispatch_id}.json").write_text(
            json.dumps({"dispatch_id": dispatch_id, "to_role": "qa", "ac_scope": ac_scope})
        )

    def _write_qa_packet(self, dispatch_id: str, ac_coverage: dict) -> Path:
        data = {**BASE_PACKET, "role": "qa", "dispatch_id": dispatch_id, "ac_coverage": ac_coverage}
        p = self.session / "outputs" / f"{dispatch_id}.json"
        p.write_text(json.dumps(data))
        return p

    def test_coverage_matches_scope_passes(self):
        did = "d-T-001-qa-l1"
        self._write_wp(did, ["AC-001", "AC-002"])
        p = self._write_qa_packet(did, {"FEAT-002/AC-001": ["e-1"], "FEAT-002/AC-002": ["e-2"]})
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_coverage_missing_scoped_ac_fails(self):
        """A scoped AC absent from ac_coverage is the audit Check 5 defect — caught early."""
        did = "d-T-001-qa-l1"
        self._write_wp(did, ["AC-001", "AC-002"])
        p = self._write_qa_packet(did, {"FEAT-002/AC-001": ["e-1"]})  # AC-002 missing
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("AC-002", reason)

    def test_coverage_with_foreign_ac_fails(self):
        """FEAT-041: qa packet lists an AC from another task — outside its ac_scope."""
        did = "d-T-001-qa-l1"
        self._write_wp(did, ["AC-001"])
        p = self._write_qa_packet(did, {"FEAT-002/AC-001": ["e-1"], "FEAT-002/AC-099": ["e-9"]})
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("AC-099", reason)

    def test_scope_with_feat_prefixed_ids_passes(self):
        """ac_scope entries may carry the FEAT prefix — normalization handles both forms."""
        did = "d-T-001-qa-l1"
        self._write_wp(did, ["FEAT-002/AC-001"])
        p = self._write_qa_packet(did, {"FEAT-002/AC-001": ["e-1"]})
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_no_work_packet_fails_open(self):
        """No inputs/<id>.json → scope check skipped, only shape validated."""
        did = "d-T-001-qa-l1"  # no Work Packet written
        p = self._write_qa_packet(did, {"FEAT-002/AC-001": ["e-1"]})
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_empty_ac_scope_fails_open(self):
        """Empty ac_scope in the Work Packet → nothing to compare against, skip."""
        did = "d-T-001-qa-l1"
        self._write_wp(did, [])
        p = self._write_qa_packet(did, {"FEAT-002/AC-001": ["e-1"]})
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)


if __name__ == "__main__":
    unittest.main()


# ===========================================================================
# decisions[] field: dev-only source for delivery-report; chronicler as Phase 4.
# ===========================================================================

def test_dev_decisions_valid_shape_passes(tmp_path):
    packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-dev-l1",
        "role": "dev", "status": "done", "summary": "done", "evidence": [], "usage": None,
        "decisions": [
            {"id": "DEC-001", "kind": "decision", "summary": "optimistic lock",
             "rationale": "avoids contention", "ref": "src/x.ts:42", "plan_ref": "AC-003"}
        ],
    }
    p = tmp_path / "d-T-001-dev-l1.json"
    p.write_text(__import__("json").dumps(packet), encoding="utf-8")
    ok, reason = _mod.validate_packet(p)
    assert ok, reason


def test_dev_decisions_bad_kind_fails(tmp_path):
    packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-dev-l1",
        "role": "dev", "status": "done", "summary": "done", "evidence": [], "usage": None,
        "decisions": [{"id": "DEC-001", "kind": "guess", "summary": "x", "rationale": "y"}],
    }
    p = tmp_path / "d-T-001-dev-l1.json"
    p.write_text(__import__("json").dumps(packet), encoding="utf-8")
    ok, reason = _mod.validate_packet(p)
    assert not ok and "kind" in reason


def test_non_dev_decisions_forbidden(tmp_path):
    packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-qa-l1",
        "role": "qa", "status": "done", "summary": "done", "evidence": [], "usage": None,
        "ac_coverage": {"FEAT-001/AC-001": ["e-1"]},
        "decisions": [{"id": "DEC-001", "kind": "decision", "summary": "x", "rationale": "y"}],
    }
    p = tmp_path / "d-T-001-qa-l1.json"
    p.write_text(__import__("json").dumps(packet), encoding="utf-8")
    ok, reason = _mod.validate_packet(p)
    assert not ok and "decisions" in reason


def test_chronicler_is_phase4_subagent():
    assert "chronicler" in _mod._PHASE_4_SUBAGENTS
