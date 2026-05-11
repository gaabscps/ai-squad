#!/usr/bin/env python3
"""
Tests for verify-tier-calibration.py  (AC-006, AC-007).

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_verify_tier_calibration
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_tier_calibration.py
"""
from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from io import StringIO
from pathlib import Path

# ---------------------------------------------------------------------------
# Load the hook module directly (not importable as a package name).
# ---------------------------------------------------------------------------
_HOOK_PATH = Path(__file__).resolve().parents[1] / "verify-tier-calibration.py"
_spec = importlib.util.spec_from_file_location("verify_tier_calibration", _HOOK_PATH)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

_extract_workpacket_body = _mod._extract_workpacket_body
_extract_fields = _mod._extract_fields
_infer_subagent_type = _mod._infer_subagent_type
main = _mod.main


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_main(payload: dict) -> tuple[int, str]:
    """Run main() with payload on stdin; return (exit_code, captured_stdout)."""
    stdin_bak = sys.stdin
    stdout_bak = sys.stdout
    try:
        sys.stdin = StringIO(json.dumps(payload))
        buf = StringIO()
        sys.stdout = buf
        rc = main()
    finally:
        sys.stdin = stdin_bak
        sys.stdout = stdout_bak
    return rc, buf.getvalue()


def _make_payload(prompt: str) -> dict:
    return {"tool_input": {"prompt": prompt}}


def _fenced_packet(**fields) -> str:
    """Build prompt with WorkPacket:\\n```yaml\\n...\\n``` form."""
    lines = ["WorkPacket:", "```yaml"]
    for k, v in fields.items():
        lines.append(f"  {k}: {v}")
    lines.append("```")
    return "\n".join(lines)


def _inline_fenced_packet(**fields) -> str:
    """Build prompt with ```yaml\\nWorkPacket:\\n...\\n``` form."""
    lines = ["```yaml", "WorkPacket:"]
    for k, v in fields.items():
        lines.append(f"  {k}: {v}")
    lines.append("```")
    return "\n".join(lines)


# ===========================================================================
# AC-006: allow when model/effort absent
# ===========================================================================

class TestAC006ModelEffortAbsent(unittest.TestCase):

    def test_no_model_no_effort_silent_allow(self):
        """No model/effort in fenced block → silent allow (exit 0, no stdout)."""
        prompt = _fenced_packet(task_id="T-001", tier="T2", subagent_type="dev")
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "", f"Expected silent allow but got: {out!r}")

    def test_model_present_effort_absent_silent_allow(self):
        """model present, effort absent → silent allow."""
        prompt = _fenced_packet(task_id="T-001", model="sonnet", tier="T2", subagent_type="dev")
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_effort_present_model_absent_silent_allow(self):
        """effort present, model absent → silent allow."""
        prompt = _fenced_packet(task_id="T-001", effort="high", tier="T2", subagent_type="dev")
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_both_model_and_effort_present_falls_through_to_stub(self):
        """Both model+effort present → stub → allow (silent, no stdout)."""
        prompt = _fenced_packet(
            task_id="T-001", model="sonnet", effort="high", tier="T2", subagent_type="dev"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        # stub returns allow → silent
        self.assertEqual(out, "")


# ===========================================================================
# AC-007: tier-independent roles short-circuit silently
# ===========================================================================

class TestAC007TierIndependentRoles(unittest.TestCase):

    def test_audit_agent_silent_allow(self):
        """audit-agent → silent allow regardless of model/effort."""
        prompt = _fenced_packet(
            task_id="T-001", model="opus", effort="high",
            tier="T4", subagent_type="audit-agent"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_blocker_specialist_silent_allow(self):
        """blocker-specialist → silent allow."""
        prompt = _fenced_packet(
            task_id="T-001", model="sonnet", effort="medium",
            tier="T2", subagent_type="blocker-specialist"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_audit_agent_uppercase_normalized(self):
        """AUDIT-AGENT (uppercase) → normalized to audit-agent → silent allow."""
        prompt = _fenced_packet(
            task_id="T-001", model="opus", effort="high",
            tier="T4", subagent_type="AUDIT-AGENT"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_blocker_specialist_mixed_case_normalized(self):
        """Blocker-Specialist mixed case → normalized → silent allow."""
        prompt = _fenced_packet(
            task_id="T-001", model="sonnet", effort="medium",
            tier="T2", subagent_type="Blocker-Specialist"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_dev_not_tier_independent(self):
        """dev is NOT tier-independent — AC-007 short-circuit must NOT fire."""
        prompt = _fenced_packet(
            task_id="T-001", model="sonnet", effort="high", tier="T2", subagent_type="dev"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        # stub returns allow; just verify no block decision
        if out.strip():
            result = json.loads(out)
            self.assertNotEqual(result.get("decision"), "block")


# ===========================================================================
# Fenced block extraction
# ===========================================================================

class TestFencedBlockExtraction(unittest.TestCase):

    def test_workpacket_fenced_form_extracted(self):
        """WorkPacket:\\n```yaml\\n...\\n``` yields body containing values."""
        prompt = _fenced_packet(task_id="T-001", model="sonnet")
        body = _extract_workpacket_body(prompt)
        self.assertIsNotNone(body)
        self.assertIn("T-001", body)

    def test_inline_fenced_form_extracted(self):
        """```yaml\\nWorkPacket:\\n...\\n``` yields body containing values."""
        prompt = _inline_fenced_packet(task_id="T-002", model="opus")
        body = _extract_workpacket_body(prompt)
        self.assertIsNotNone(body)
        self.assertIn("T-002", body)

    def test_no_fenced_block_returns_none(self):
        """Prompt without any WorkPacket block returns None."""
        body = _extract_workpacket_body("This is just a plain prompt with model: sonnet in it.")
        self.assertIsNone(body)


# ===========================================================================
# No fenced block → fallback allow (must NOT parse stray YAML)
# ===========================================================================

class TestNoFencedBlockFallback(unittest.TestCase):

    def test_no_workpacket_block_silent_allow(self):
        """No WorkPacket block in prompt → silent allow (exit 0, no stdout)."""
        prompt = "Please run this task.\nmodel: sonnet\neffort: high\ntier: T4"
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "", f"Expected silent allow but got: {out!r}")

    def test_stray_model_in_narrative_does_not_pollute(self):
        """Stray top-level YAML outside fenced block must NOT be parsed."""
        # If stray YAML were parsed, model+effort+subagent_type would be found
        # and possibly trigger a block.  Correct behavior: silent allow.
        prompt = (
            "Dispatch context:\n"
            "model: opus\n"
            "effort: high\n"
            "tier: T4\n"
            "subagent_type: dev\n"
            "Please proceed."
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(
            out, "",
            "Stray top-level YAML must not be parsed; expected silent allow. "
            f"Got stdout: {out!r}"
        )

    def test_empty_prompt_silent_allow(self):
        """Empty prompt → silent allow."""
        rc, out = _run_main(_make_payload(""))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_no_tool_input_silent_allow(self):
        """Missing tool_input → silent allow."""
        rc, out = _run_main({})
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")


# ===========================================================================
# Multiple fenced blocks → block
# ===========================================================================

class TestMultipleFencedBlocks(unittest.TestCase):

    def test_two_fenced_blocks_block_decision(self):
        """Two WorkPacket fenced blocks → block with 'multiple' in reason."""
        block = _fenced_packet(task_id="T-001", model="sonnet", effort="high", tier="T2")
        prompt = block + "\n\nSome text in between\n\n" + block
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertTrue(out.strip(), "Expected JSON output for multiple blocks")
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("multiple", result["reason"].lower())


# ===========================================================================
# dispatch_id inference
# ===========================================================================

class TestDispatchIdInference(unittest.TestCase):

    def test_infer_dev(self):
        self.assertEqual(_infer_subagent_type("d-T-008-dev-l1"), "dev")

    def test_infer_audit_agent_full(self):
        self.assertEqual(_infer_subagent_type("d-audit-agent-l1"), "audit-agent")

    def test_infer_audit_short(self):
        self.assertEqual(_infer_subagent_type("d-audit-l1"), "audit-agent")

    def test_infer_blocker_specialist(self):
        self.assertEqual(_infer_subagent_type("d-T-008-blocker-specialist-l1"), "blocker-specialist")

    def test_infer_code_reviewer(self):
        self.assertEqual(_infer_subagent_type("d-T-001-code-reviewer-l2"), "code-reviewer")

    def test_infer_logic_reviewer(self):
        self.assertEqual(_infer_subagent_type("d-T-001-logic-reviewer-l1"), "logic-reviewer")

    def test_no_match_returns_none(self):
        self.assertIsNone(_infer_subagent_type("d-unknown-xyz"))


# ===========================================================================
# AC-007 invariant: subagent_type absent behavior
# ===========================================================================

class TestSubagentTypeAbsentInvariant(unittest.TestCase):

    def test_absent_subagent_type_model_effort_absent_silent_allow(self):
        """subagent_type absent + model/effort absent → silent allow (AC-006 path)."""
        # dispatch_id that does NOT match any known role segment → inferred type = None
        prompt = _fenced_packet(task_id="T-001", dispatch_id="d-unknown-xyz", tier="T2")
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_absent_subagent_type_model_effort_present_blocked(self):
        """subagent_type absent + model/effort present → block (AC-007 invariant)."""
        prompt = _fenced_packet(
            task_id="T-001", dispatch_id="d-unknown-xyz",
            model="sonnet", effort="high", tier="T2"
        )
        rc, out = _run_main(_make_payload(prompt))
        self.assertEqual(rc, 0)
        self.assertTrue(out.strip(), "Expected JSON block output")
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("subagent_type", result["reason"].lower())


if __name__ == "__main__":
    unittest.main()
