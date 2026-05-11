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


def _write_packet(tmp_dir: Path, data: dict) -> Path:
    p = tmp_dir / "packet.json"
    p.write_text(json.dumps(data))
    return p


BASE_PACKET = {
    "spec_id": "FEAT-002",
    "dispatch_id": "d-001",
    "role": "dev",
    "status": "done",
    "summary": "implemented feature",
    "evidence": [],
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


if __name__ == "__main__":
    unittest.main()
