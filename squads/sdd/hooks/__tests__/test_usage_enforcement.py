#!/usr/bin/env python3
"""
Tests for AC-001 (usage field required) and AC-007 (warnings.py helper).

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_usage_enforcement
OR:
  python3 squads/sdd/hooks/__tests__/test_usage_enforcement.py
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

# Load verify-output-packet.py
_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_FILE = _HOOKS_DIR / "verify-output-packet.py"
_spec = importlib.util.spec_from_file_location("verify_output_packet", _HOOK_FILE)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
validate_packet = _mod.validate_packet

# Load shared/lib/warnings.py
_SHARED_LIB = _HOOKS_DIR.parent.parent.parent / "shared" / "lib"
_w_spec = importlib.util.spec_from_file_location("squad_warnings", str(_SHARED_LIB / "warnings.py"))
_w_mod = importlib.util.module_from_spec(_w_spec)
_w_spec.loader.exec_module(_w_mod)  # type: ignore[union-attr]
append_warning = _w_mod.append_warning


BASE_PACKET = {
    "spec_id": "FEAT-003",
    "dispatch_id": "d-001",
    "role": "dev",
    "status": "done",
    "summary": "implemented feature",
    "evidence": [],
    "usage": None,
}


def _write_packet(tmp_dir: Path, data: dict) -> Path:
    p = tmp_dir / "packet.json"
    p.write_text(json.dumps(data))
    return p


class TestUsageFieldRequired(unittest.TestCase):
    """AC-001: usage field is required for all roles except pm-orchestrator."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def test_dev_without_usage_fails(self):
        """AC-001: dev packet without usage key is rejected."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "usage"}
        data["role"] = "dev"
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("usage", reason)
        self.assertIn("dev", reason)

    def test_dev_with_usage_null_passes(self):
        """AC-001: usage=null is valid at write time (hook fills it in later)."""
        data = {**BASE_PACKET, "role": "dev", "usage": None}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_dev_with_usage_object_passes(self):
        """AC-001: usage object is valid."""
        data = {
            **BASE_PACKET,
            "role": "dev",
            "usage": {
                "total_tokens": 1000,
                "tool_uses": 5,
                "duration_ms": 30000,
                "model": "sonnet-4-6",
            },
        }
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertTrue(ok, reason)

    def test_qa_without_usage_fails(self):
        """AC-001: qa packet without usage key is rejected."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "usage"}
        data["role"] = "qa"
        data["ac_coverage"] = {"FEAT-003/AC-001": ["e-001"]}
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("usage", reason)

    def test_code_reviewer_without_usage_fails(self):
        """AC-001: code-reviewer without usage key is rejected."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "usage"}
        data["role"] = "code-reviewer"
        data["findings"] = []
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("usage", reason)

    def test_audit_agent_without_usage_fails(self):
        """AC-001: audit-agent without usage key is also rejected."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "usage"}
        data["role"] = "audit-agent"
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("usage", reason)

    def test_error_message_includes_role(self):
        """AC-001: error message must include the role name."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "usage"}
        data["role"] = "logic-reviewer"
        data["findings"] = []
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("logic-reviewer", reason)

    def test_error_message_includes_dispatch_id(self):
        """AC-001: error message should identify the dispatch."""
        data = {k: v for k, v in BASE_PACKET.items() if k != "usage"}
        data["role"] = "dev"
        data["dispatch_id"] = "d-abc"
        p = _write_packet(self.tmp, data)
        ok, reason = validate_packet(p)
        self.assertFalse(ok)
        self.assertIn("d-abc", reason)


class TestWarningsHelper(unittest.TestCase):
    """AC-007: shared/lib/warnings.py append_warning creates correctly structured entries."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Monkey-patch _agent_session_root to use tmp dir
        self._orig_root = _w_mod._agent_session_root
        _w_mod._agent_session_root = lambda: self.tmp

    def tearDown(self):
        _w_mod._agent_session_root = self._orig_root

    def test_creates_warnings_json(self):
        """AC-007: warnings.json is created if it doesn't exist."""
        append_warning("FEAT-003", "test_reason", "test_source")
        warnings_path = self.tmp / "FEAT-003" / "warnings.json"
        self.assertTrue(warnings_path.exists())

    def test_entry_schema_fields(self):
        """AC-007: each entry has id, timestamp, source, reason, severity, metadata."""
        entry = append_warning("FEAT-003", "empty_transcript", "capture-pm-session")
        self.assertIn("id", entry)
        self.assertIn("timestamp", entry)
        self.assertIn("source", entry)
        self.assertIn("reason", entry)
        self.assertIn("severity", entry)
        self.assertIn("metadata", entry)
        self.assertEqual(entry["source"], "capture-pm-session")
        self.assertEqual(entry["reason"], "empty_transcript")
        self.assertEqual(entry["severity"], "warning")

    def test_schema_version_1(self):
        """AC-007: warnings.json has schema_version: 1."""
        append_warning("FEAT-003", "test", "test_source")
        warnings_path = self.tmp / "FEAT-003" / "warnings.json"
        doc = json.loads(warnings_path.read_text())
        self.assertEqual(doc["schema_version"], 1)

    def test_append_only(self):
        """AC-007: subsequent calls append, not replace."""
        append_warning("FEAT-003", "reason1", "source1")
        append_warning("FEAT-003", "reason2", "source2")
        warnings_path = self.tmp / "FEAT-003" / "warnings.json"
        doc = json.loads(warnings_path.read_text())
        self.assertEqual(len(doc["warnings"]), 2)
        reasons = [w["reason"] for w in doc["warnings"]]
        self.assertIn("reason1", reasons)
        self.assertIn("reason2", reasons)

    def test_invalid_task_id_raises(self):
        """AC-007: invalid task_id raises ValueError."""
        with self.assertRaises(ValueError):
            append_warning("INVALID", "reason", "source")
        with self.assertRaises(ValueError):
            append_warning("feat-001", "reason", "source")
        with self.assertRaises(ValueError):
            append_warning("../etc/passwd", "reason", "source")

    def test_invalid_severity_raises(self):
        """AC-007: invalid severity raises ValueError."""
        with self.assertRaises(ValueError):
            append_warning("FEAT-003", "reason", "source", severity="critical")

    def test_valid_severities(self):
        """AC-007: info, warning, error are all accepted."""
        for sev in ("info", "warning", "error"):
            with self.subTest(severity=sev):
                entry = append_warning("FEAT-003", "test", "source", severity=sev)
                self.assertEqual(entry["severity"], sev)

    def test_metadata_stored(self):
        """AC-007: metadata dict is preserved in the entry."""
        entry = append_warning("FEAT-003", "test", "source", metadata={"key": "val"})
        self.assertEqual(entry["metadata"], {"key": "val"})

    def test_feat_id_boundary_3_digits(self):
        """AC-007: FEAT-001 (3 digits) is valid."""
        entry = append_warning("FEAT-001", "test", "source")
        self.assertEqual(entry["reason"], "test")

    def test_feat_id_boundary_4_digits(self):
        """AC-007: FEAT-9999 (4 digits) is valid."""
        entry = append_warning("FEAT-9999", "test", "source")
        self.assertEqual(entry["reason"], "test")

    def test_feat_id_5_digits_invalid(self):
        """AC-007: FEAT-10000 (5 digits) is invalid."""
        with self.assertRaises(ValueError):
            append_warning("FEAT-10000", "test", "source")

    def test_uuid_unique(self):
        """AC-007: each entry gets a unique UUID."""
        entry1 = append_warning("FEAT-003", "r1", "s")
        entry2 = append_warning("FEAT-003", "r2", "s")
        self.assertNotEqual(entry1["id"], entry2["id"])


if __name__ == "__main__":
    unittest.main()
