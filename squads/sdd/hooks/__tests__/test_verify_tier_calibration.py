#!/usr/bin/env python3
"""
Tests for verify-tier-calibration.py  (AC-005, AC-006, AC-007, AC-008, NFR-004).

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_verify_tier_calibration
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_tier_calibration.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import timeit
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
_derive_loop_kind = _mod._derive_loop_kind
_read_task_tier = _mod._read_task_tier
_lookup_canonical = _mod._lookup_canonical
_verify_tier_calibration_for_task = _mod._verify_tier_calibration_for_task
_load_manifest_dispatches = _mod._load_manifest_dispatches
_derive_loop_suffix_from_dispatch_id = _mod._derive_loop_suffix_from_dispatch_id
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


# ===========================================================================
# Helpers for T-009 tests
# ===========================================================================

def _make_tasks_md(task_id: str, tier: str) -> str:
    """Return a minimal tasks.md string with the given task_id and Tier."""
    return f"""---
id: TASKS-TEST
status: approved
---

# Tasks

## {task_id} Test task
**Files:** some/file.py
**Tier:** {tier}
**Estimated complexity:** medium
"""


def _make_tasks_md_no_tier(task_id: str) -> str:
    """Return a tasks.md with the task but no Tier: field."""
    return f"""---
id: TASKS-TEST
status: approved
---

# Tasks

## {task_id} Test task
**Files:** some/file.py
**Estimated complexity:** medium
"""


def _make_manifest(dispatches: list[dict]) -> dict:
    """Return a minimal dispatch-manifest.json dict."""
    return {
        "schema_version": 1,
        "task_id": "TEST",
        "actual_dispatches": dispatches,
    }


def _write_temp_files(
    task_id: str,
    tier: str | None,
    dispatches: list[dict],
) -> tuple[Path, Path]:
    """Write tasks.md and dispatch-manifest.json to a temp session dir.

    Returns (session_dir, manifest_path).
    """
    session_dir = Path(tempfile.mkdtemp())
    task_session_dir = session_dir / task_id
    task_session_dir.mkdir(parents=True, exist_ok=True)

    # tasks.md
    if tier is not None:
        tasks_content = _make_tasks_md(task_id, tier)
    else:
        tasks_content = _make_tasks_md_no_tier(task_id)
    (task_session_dir / "tasks.md").write_text(tasks_content)

    # dispatch-manifest.json at session root (parent of task_id subdir)
    manifest = _make_manifest(dispatches)
    manifest_path = session_dir / "dispatch-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    return session_dir, manifest_path


# ===========================================================================
# _lookup_canonical: every (role, tier) cell from the canonical table
# ===========================================================================

class TestLookupCanonical(unittest.TestCase):
    """Verify the Tier × Loop mirror table covers every cell from effort.md."""

    # dev L1 row
    def test_dev_l1_t1(self):
        self.assertEqual(_lookup_canonical("dev", "T1", "dev L1"), ("haiku", "high"))

    def test_dev_l1_t2(self):
        self.assertEqual(_lookup_canonical("dev", "T2", "dev L1"), ("sonnet", "medium"))

    def test_dev_l1_t3(self):
        self.assertEqual(_lookup_canonical("dev", "T3", "dev L1"), ("sonnet", "high"))

    def test_dev_l1_t4(self):
        self.assertEqual(_lookup_canonical("dev", "T4", "dev L1"), ("sonnet", "high"))

    # dev L2 row
    def test_dev_l2_t1(self):
        self.assertEqual(_lookup_canonical("dev", "T1", "dev L2"), ("sonnet", "medium"))

    def test_dev_l2_t2(self):
        self.assertEqual(_lookup_canonical("dev", "T2", "dev L2"), ("sonnet", "high"))

    def test_dev_l2_t3(self):
        self.assertEqual(_lookup_canonical("dev", "T3", "dev L2"), ("sonnet", "high"))

    def test_dev_l2_t4(self):
        self.assertEqual(_lookup_canonical("dev", "T4", "dev L2"), ("sonnet", "high"))

    # dev L3 row
    def test_dev_l3_t1(self):
        self.assertEqual(_lookup_canonical("dev", "T1", "dev L3"), ("sonnet", "high"))

    def test_dev_l3_t2(self):
        self.assertEqual(_lookup_canonical("dev", "T2", "dev L3"), ("sonnet", "high"))

    def test_dev_l3_t3(self):
        self.assertEqual(_lookup_canonical("dev", "T3", "dev L3"), ("sonnet", "high"))

    def test_dev_l3_t4(self):
        self.assertEqual(_lookup_canonical("dev", "T4", "dev L3"), ("opus", "high"))

    # dev qa-L1 row
    def test_dev_qa_l1_t1(self):
        self.assertEqual(_lookup_canonical("dev", "T1", "dev qa-L1"), ("sonnet", "medium"))

    def test_dev_qa_l1_t2(self):
        self.assertEqual(_lookup_canonical("dev", "T2", "dev qa-L1"), ("sonnet", "high"))

    def test_dev_qa_l1_t3(self):
        self.assertEqual(_lookup_canonical("dev", "T3", "dev qa-L1"), ("sonnet", "high"))

    def test_dev_qa_l1_t4(self):
        self.assertEqual(_lookup_canonical("dev", "T4", "dev qa-L1"), ("sonnet", "high"))

    # dev qa-L2 row
    def test_dev_qa_l2_t1(self):
        self.assertEqual(_lookup_canonical("dev", "T1", "dev qa-L2"), ("sonnet", "high"))

    def test_dev_qa_l2_t2(self):
        self.assertEqual(_lookup_canonical("dev", "T2", "dev qa-L2"), ("sonnet", "high"))

    def test_dev_qa_l2_t3(self):
        self.assertEqual(_lookup_canonical("dev", "T3", "dev qa-L2"), ("sonnet", "high"))

    def test_dev_qa_l2_t4(self):
        self.assertEqual(_lookup_canonical("dev", "T4", "dev qa-L2"), ("opus", "high"))

    # code-reviewer row (loop-independent)
    def test_code_reviewer_t1(self):
        self.assertEqual(_lookup_canonical("code-reviewer", "T1", "code-reviewer L1"), ("haiku", "high"))

    def test_code_reviewer_t2(self):
        self.assertEqual(_lookup_canonical("code-reviewer", "T2", "code-reviewer L1"), ("haiku", "high"))

    def test_code_reviewer_t3(self):
        self.assertEqual(_lookup_canonical("code-reviewer", "T3", "code-reviewer L1"), ("sonnet", "medium"))

    def test_code_reviewer_t4(self):
        self.assertEqual(_lookup_canonical("code-reviewer", "T4", "code-reviewer L1"), ("sonnet", "medium"))

    # logic-reviewer row (loop-independent)
    def test_logic_reviewer_t1(self):
        self.assertEqual(_lookup_canonical("logic-reviewer", "T1", "logic-reviewer L1"), ("sonnet", "medium"))

    def test_logic_reviewer_t2(self):
        self.assertEqual(_lookup_canonical("logic-reviewer", "T2", "logic-reviewer L1"), ("sonnet", "medium"))

    def test_logic_reviewer_t3(self):
        self.assertEqual(_lookup_canonical("logic-reviewer", "T3", "logic-reviewer L1"), ("sonnet", "high"))

    def test_logic_reviewer_t4(self):
        self.assertEqual(_lookup_canonical("logic-reviewer", "T4", "logic-reviewer L1"), ("opus", "high"))

    # qa row (loop-independent)
    def test_qa_t1(self):
        self.assertEqual(_lookup_canonical("qa", "T1", "qa L1"), ("haiku", "high"))

    def test_qa_t2(self):
        self.assertEqual(_lookup_canonical("qa", "T2", "qa L1"), ("haiku", "high"))

    def test_qa_t3(self):
        self.assertEqual(_lookup_canonical("qa", "T3", "qa L1"), ("sonnet", "medium"))

    def test_qa_t4(self):
        self.assertEqual(_lookup_canonical("qa", "T4", "qa L1"), ("sonnet", "high"))

    # blocker-specialist / audit-agent are tier-independent (handled by caller)
    def test_unknown_role_with_unknown_loop_kind_returns_none(self):
        # Non-loop-independent role + loop_kind not in table → None
        self.assertIsNone(_lookup_canonical("unknown-role", "T1", "unknown-role L1"))

    def test_unknown_tier_returns_none(self):
        self.assertIsNone(_lookup_canonical("dev", "T9", "dev L1"))

    def test_unknown_loop_kind_returns_none(self):
        self.assertIsNone(_lookup_canonical("dev", "T1", "dev L9"))


# ===========================================================================
# _derive_loop_kind: loop-kind derivation from dispatch-manifest
# ===========================================================================

def _manifest_dispatch(dispatch_id, role, task_id, loop, pm_note=None, status="done"):
    """Build a minimal dispatch entry for use in test fixtures."""
    return {
        "dispatch_id": dispatch_id,
        "role": role,
        "task_id": task_id,
        "loop": loop,
        "pm_note": pm_note,
        "status": status,
    }


class TestDeriveLoopKind(unittest.TestCase):
    """Verify loop-kind derivation from actual_dispatches[]."""

    def test_dev_first_dispatch_is_l1(self):
        """No prior dev dispatch → dev L1."""
        dispatches = []
        result = _derive_loop_kind("T-001", "dev", dispatches)
        self.assertEqual(result, "dev L1")

    def test_dev_second_dispatch_after_reviewer_findings_is_l2(self):
        """Prior dev L1 + reviewer finding dispatch → dev L2."""
        dispatches = [
            _manifest_dispatch("d-T-001-dev-l1", "dev", "T-001", 1),
            _manifest_dispatch("d-T-001-code-reviewer-l1", "code-reviewer", "T-001", 1,
                                    pm_note="findings"),
        ]
        result = _derive_loop_kind("T-001", "dev", dispatches)
        self.assertEqual(result, "dev L2")

    def test_dev_third_dispatch_after_two_reviewer_cycles_is_l3(self):
        """Two prior dev dispatches → dev L3."""
        dispatches = [
            _manifest_dispatch("d-T-001-dev-l1", "dev", "T-001", 1),
            _manifest_dispatch("d-T-001-dev-l2", "dev", "T-001", 2),
        ]
        result = _derive_loop_kind("T-001", "dev", dispatches)
        self.assertEqual(result, "dev L3")

    def test_dev_qa_l1_after_qa_fail(self):
        """Prior dev dispatch + qa dispatch with pm_note=qa_fail → dev qa-L1."""
        dispatches = [
            _manifest_dispatch("d-T-001-dev-l1", "dev", "T-001", 1),
            _manifest_dispatch("d-T-001-qa-l1", "qa", "T-001", 1, pm_note="qa_fail"),
        ]
        result = _derive_loop_kind("T-001", "dev", dispatches)
        self.assertEqual(result, "dev qa-L1")

    def test_dev_qa_l2_after_two_qa_fails(self):
        """Two prior qa-fail dispatches → dev qa-L2."""
        dispatches = [
            _manifest_dispatch("d-T-001-dev-l1", "dev", "T-001", 1),
            _manifest_dispatch("d-T-001-qa-l1", "qa", "T-001", 1, pm_note="qa_fail"),
            _manifest_dispatch("d-T-001-dev-qa-l1", "dev", "T-001", 1, pm_note="qa_retry"),
            _manifest_dispatch("d-T-001-qa-l2", "qa", "T-001", 2, pm_note="qa_fail"),
        ]
        result = _derive_loop_kind("T-001", "dev", dispatches)
        self.assertEqual(result, "dev qa-L2")

    def test_code_reviewer_loop_kind(self):
        """code-reviewer → loop-independent loop kind 'code-reviewer L1'."""
        dispatches = []
        result = _derive_loop_kind("T-001", "code-reviewer", dispatches)
        self.assertIn("code-reviewer", result)

    def test_logic_reviewer_loop_kind(self):
        """logic-reviewer → loop-independent loop kind."""
        dispatches = []
        result = _derive_loop_kind("T-001", "logic-reviewer", dispatches)
        self.assertIn("logic-reviewer", result)

    def test_qa_loop_kind(self):
        """qa → loop-independent loop kind."""
        dispatches = []
        result = _derive_loop_kind("T-001", "qa", dispatches)
        self.assertIn("qa", result)

    def test_filters_other_task_dispatches(self):
        """Dispatches for other tasks must not influence T-001's loop count."""
        dispatches = [
            # T-002 dev dispatches — must NOT count for T-001
            _manifest_dispatch("d-T-002-dev-l1", "dev", "T-002", 1),
            _manifest_dispatch("d-T-002-dev-l2", "dev", "T-002", 2),
        ]
        result = _derive_loop_kind("T-001", "dev", dispatches)
        # T-001 has zero prior dev dispatches → L1
        self.assertEqual(result, "dev L1")


# ===========================================================================
# _read_task_tier: reads Tier: from tasks.md + AC-008 block on missing
# ===========================================================================

class TestReadTaskTier(unittest.TestCase):
    """Verify tasks.md Tier: field reading and mtime cache."""

    def setUp(self):
        self._tmpdir = Path(tempfile.mkdtemp())
        # Ensure no stale cache files interfere — clear /tmp ai-squad cache for our task ids
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass

    def test_reads_tier_from_tasks_md(self):
        tasks_content = _make_tasks_md("T-001", "T3")
        tasks_path = self._tmpdir / "T-001" / "tasks.md"
        tasks_path.parent.mkdir(parents=True)
        tasks_path.write_text(tasks_content)
        tier = _read_task_tier("T-001", self._tmpdir)
        self.assertEqual(tier, "T3")

    def test_returns_none_when_tier_absent(self):
        tasks_content = _make_tasks_md_no_tier("T-001")
        tasks_path = self._tmpdir / "T-001" / "tasks.md"
        tasks_path.parent.mkdir(parents=True)
        tasks_path.write_text(tasks_content)
        tier = _read_task_tier("T-001", self._tmpdir)
        self.assertIsNone(tier)

    def test_returns_none_when_tasks_md_missing(self):
        # No tasks.md created
        tier = _read_task_tier("T-999", self._tmpdir)
        self.assertIsNone(tier)

    def test_cache_hit_returns_same_tier(self):
        tasks_content = _make_tasks_md("T-001", "T4")
        tasks_path = self._tmpdir / "T-001" / "tasks.md"
        tasks_path.parent.mkdir(parents=True)
        tasks_path.write_text(tasks_content)
        tier1 = _read_task_tier("T-001", self._tmpdir)
        tier2 = _read_task_tier("T-001", self._tmpdir)
        self.assertEqual(tier1, "T4")
        self.assertEqual(tier2, "T4")

    def test_cache_invalidated_on_mtime_change(self):
        tasks_path = self._tmpdir / "T-001" / "tasks.md"
        tasks_path.parent.mkdir(parents=True)
        tasks_path.write_text(_make_tasks_md("T-001", "T2"))
        tier1 = _read_task_tier("T-001", self._tmpdir)
        self.assertEqual(tier1, "T2")
        # Rewrite with different tier and bump mtime explicitly
        tasks_path.write_text(_make_tasks_md("T-001", "T3"))
        import time; time.sleep(0.01)  # ensure mtime changes
        tasks_path.touch()  # force mtime update
        tier2 = _read_task_tier("T-001", self._tmpdir)
        self.assertEqual(tier2, "T3")

    def test_all_tier_values_parsed_correctly(self):
        for tier_val in ("T1", "T2", "T3", "T4"):
            tasks_path = self._tmpdir / f"T-{tier_val}" / "tasks.md"
            tasks_path.parent.mkdir(parents=True, exist_ok=True)
            tasks_path.write_text(_make_tasks_md(f"T-{tier_val}", tier_val))
            tier = _read_task_tier(f"T-{tier_val}", self._tmpdir)
            self.assertEqual(tier, tier_val, f"Expected {tier_val}, got {tier}")


# ===========================================================================
# AC-005: Work Packet mismatch blocks dispatch
# ===========================================================================

class TestAC005TierCalibrationMismatch(unittest.TestCase):
    """Verify that mismatched model/effort triggers a block decision."""

    def setUp(self):
        # Clear cache
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass

    def _run_verify(
        self,
        task_id: str,
        model: str,
        effort: str,
        tier: str,
        subagent_type: str,
        dispatches: list[dict] | None = None,
        session_dir: Path | None = None,
    ) -> dict:
        """Call _verify_tier_calibration_for_task with temp session context."""
        if dispatches is None:
            dispatches = []

        if session_dir is None:
            session_dir, manifest_path = _write_temp_files(task_id, tier, dispatches)

        # Build a minimal prompt
        prompt = f"""WorkPacket:
```yaml
task_id: {task_id}
model: {model}
effort: {effort}
tier: {tier}
subagent_type: {subagent_type}
```"""

        return _verify_tier_calibration_for_task(
            task_id=task_id,
            model=model,
            effort=effort,
            tier=tier,
            subagent_type=subagent_type,
            prompt=prompt,
            session_dir=session_dir,
        )

    def test_correct_calibration_dev_l1_t4_allows(self):
        """sonnet+high for dev L1 T4 → canonical match → allow."""
        result = self._run_verify("T-009", "sonnet", "high", "T4", "dev")
        self.assertNotIn("decision", result, f"Unexpected block: {result}")

    def test_incorrect_calibration_dev_l1_t4_blocks(self):
        """opus+high for dev L1 T4 → canonical is sonnet+high → block."""
        result = self._run_verify("T-009", "opus", "high", "T4", "dev")
        self.assertEqual(result["decision"], "block")
        self.assertIn("tier_calibration_mismatch", result.get("reason", ""))

    def test_block_reason_includes_expected_and_got(self):
        """Block reason must name expected and got values."""
        result = self._run_verify("T-009", "opus", "medium", "T4", "dev")
        reason = result.get("reason", "")
        self.assertIn("expected", reason)
        self.assertIn("got", reason)

    def test_correct_calibration_dev_l1_t1_haiku_high(self):
        """haiku+high for dev L1 T1 → canonical match → allow."""
        result = self._run_verify("T-001", "haiku", "high", "T1", "dev")
        self.assertNotIn("decision", result)

    def test_mismatch_dev_l1_t1_sonnet_blocks(self):
        """sonnet+high for dev L1 T1 → canonical is haiku+high → block."""
        result = self._run_verify("T-001", "sonnet", "high", "T1", "dev")
        self.assertEqual(result["decision"], "block")

    def test_correct_dev_l3_t4_opus_high(self):
        """opus+high for dev L3 T4 → canonical match → allow."""
        # Simulate 2 prior dev dispatches → L3
        dispatches = [
            {"dispatch_id": "d-T-001-dev-l1", "role": "dev", "task_id": "T-001", "loop": 1,
             "pm_note": None, "status": "done"},
            {"dispatch_id": "d-T-001-dev-l2", "role": "dev", "task_id": "T-001", "loop": 2,
             "pm_note": None, "status": "done"},
        ]
        session_dir, _ = _write_temp_files("T-001", "T4", dispatches)
        result = self._run_verify("T-001", "opus", "high", "T4", "dev",
                                  dispatches=dispatches, session_dir=session_dir)
        self.assertNotIn("decision", result)

    def test_code_reviewer_t3_sonnet_medium_allows(self):
        """sonnet+medium for code-reviewer T3 → canonical match → allow."""
        result = self._run_verify("T-001", "sonnet", "medium", "T3", "code-reviewer")
        self.assertNotIn("decision", result)

    def test_logic_reviewer_t4_opus_high_allows(self):
        """opus+high for logic-reviewer T4 → canonical match → allow."""
        result = self._run_verify("T-001", "opus", "high", "T4", "logic-reviewer")
        self.assertNotIn("decision", result)

    def test_qa_t4_sonnet_high_allows(self):
        """sonnet+high for qa T4 → canonical match → allow."""
        result = self._run_verify("T-001", "sonnet", "high", "T4", "qa")
        self.assertNotIn("decision", result)

    def test_qa_t1_haiku_high_allows(self):
        """haiku+high for qa T1 → canonical match → allow."""
        result = self._run_verify("T-001", "haiku", "high", "T1", "qa")
        self.assertNotIn("decision", result)


# ===========================================================================
# AC-008: tier_missing blocks dispatch
# ===========================================================================

class TestAC008TierMissing(unittest.TestCase):
    """Verify that tasks.md missing a Tier: field blocks with tier_missing."""

    def setUp(self):
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass

    def test_tier_missing_in_tasks_md_blocks(self):
        """tasks.md lacks Tier: for T-001 → block with tier_missing reason."""
        session_dir, _ = _write_temp_files("T-001", None, [])
        prompt = """WorkPacket:
```yaml
task_id: T-001
model: sonnet
effort: high
subagent_type: dev
```"""
        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="high",
            tier="",
            subagent_type="dev",
            prompt=prompt,
            session_dir=session_dir,
        )
        self.assertEqual(result["decision"], "block")
        self.assertIn("tier_missing", result.get("reason", ""))

    def test_tier_missing_reason_names_task_id(self):
        """Block reason for tier_missing must mention the task id."""
        session_dir, _ = _write_temp_files("T-001", None, [])
        prompt = """WorkPacket:
```yaml
task_id: T-001
model: sonnet
effort: high
subagent_type: dev
```"""
        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="high",
            tier="",
            subagent_type="dev",
            prompt=prompt,
            session_dir=session_dir,
        )
        self.assertIn("T-001", result.get("reason", ""))

    def test_tier_in_wp_but_missing_in_tasks_md_blocks(self):
        """Work Packet has tier but tasks.md lacks Tier: → block (tasks.md is authoritative)."""
        session_dir, _ = _write_temp_files("T-001", None, [])
        prompt = """WorkPacket:
```yaml
task_id: T-001
model: sonnet
effort: high
tier: T3
subagent_type: dev
```"""
        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="high",
            tier="T3",
            subagent_type="dev",
            prompt=prompt,
            session_dir=session_dir,
        )
        # tasks.md is missing Tier → should block
        self.assertEqual(result["decision"], "block")
        self.assertIn("tier_missing", result.get("reason", ""))


# ===========================================================================
# AC-007 (role short-circuit) — full main() integration for audit/blocker
# ===========================================================================

class TestAC007RoleShortCircuitFullPipeline(unittest.TestCase):
    """Audit/blocker short-circuit must still fire even after T-009 path added."""

    def _run_main(self, payload: dict) -> tuple[int, str]:
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

    def _fenced(self, **fields) -> str:
        lines = ["WorkPacket:", "```yaml"]
        for k, v in fields.items():
            lines.append(f"  {k}: {v}")
        lines.append("```")
        return "\n".join(lines)

    def test_audit_agent_silent_allow_no_session_dir_needed(self):
        """audit-agent → short-circuit allow; no tasks.md read needed."""
        prompt = self._fenced(
            task_id="T-001", model="haiku", effort="medium",
            tier="T3", subagent_type="audit-agent"
        )
        rc, out = self._run_main({"tool_input": {"prompt": prompt}})
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_blocker_specialist_silent_allow_no_session_dir_needed(self):
        """blocker-specialist → short-circuit allow; no tasks.md read needed."""
        prompt = self._fenced(
            task_id="T-001", model="opus", effort="xhigh",
            tier="T4", subagent_type="blocker-specialist"
        )
        rc, out = self._run_main({"tool_input": {"prompt": prompt}})
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")


# ===========================================================================
# NFR-004: latency < 50ms per dispatch
# ===========================================================================

class TestNFR004Latency(unittest.TestCase):
    """Benchmark _verify_tier_calibration_for_task against 50ms limit."""

    def setUp(self):
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass
        # Write a representative 30-task tasks.md
        self._session_dir = Path(tempfile.mkdtemp())
        task_dir = self._session_dir / "T-001"
        task_dir.mkdir(parents=True)
        tasks_lines = ["---\nid: TASKS-TEST\nstatus: approved\n---\n\n# Tasks\n\n"]
        for i in range(1, 31):
            tier = ["T1", "T2", "T3", "T4"][i % 4]
            tasks_lines.append(
                f"## T-{i:03d} Task {i}\n"
                f"**Files:** some/file_{i}.py\n"
                f"**Tier:** {tier}\n"
                f"**Estimated complexity:** medium\n\n"
            )
        (task_dir / "tasks.md").write_text("".join(tasks_lines))
        # Write manifest
        manifest = {"schema_version": 1, "task_id": "TEST", "actual_dispatches": []}
        (self._session_dir / "dispatch-manifest.json").write_text(json.dumps(manifest))

    def test_latency_under_50ms_cold_start(self):
        """Cold-start (no cache) call must complete in < 50ms."""
        prompt = """WorkPacket:
```yaml
task_id: T-001
model: haiku
effort: high
tier: T1
subagent_type: dev
```"""
        duration_ms = timeit.timeit(
            lambda: _verify_tier_calibration_for_task(
                task_id="T-001",
                model="haiku",
                effort="high",
                tier="T1",
                subagent_type="dev",
                prompt=prompt,
                session_dir=self._session_dir,
            ),
            number=1,
        ) * 1000
        self.assertLess(duration_ms, 50, f"Cold start took {duration_ms:.1f}ms, expected < 50ms")

    def test_latency_under_50ms_cache_warm(self):
        """Cache-warm call (second call, same tasks.md) must complete in < 50ms."""
        prompt = """WorkPacket:
```yaml
task_id: T-001
model: haiku
effort: high
tier: T1
subagent_type: dev
```"""
        # Warm the cache
        _verify_tier_calibration_for_task(
            task_id="T-001",
            model="haiku",
            effort="high",
            tier="T1",
            subagent_type="dev",
            prompt=prompt,
            session_dir=self._session_dir,
        )
        # Benchmark the warm call
        duration_ms = timeit.timeit(
            lambda: _verify_tier_calibration_for_task(
                task_id="T-001",
                model="haiku",
                effort="high",
                tier="T1",
                subagent_type="dev",
                prompt=prompt,
                session_dir=self._session_dir,
            ),
            number=5,
        ) * 1000 / 5
        self.assertLess(duration_ms, 50, f"Warm avg {duration_ms:.1f}ms, expected < 50ms")


# ===========================================================================
# AC-008 invariant: task section absent → tier_missing (no fallback scan)
# ===========================================================================

class TestAC008TaskSectionAbsentNoFallback(unittest.TestCase):
    """When the ## T-XXX section is not found in tasks.md, return None (no fallback scan)."""

    def setUp(self):
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass
        # clear in-process cache
        _mod._tier_cache.clear()

    def test_section_absent_returns_none_not_first_tier(self):
        """tasks.md has T-002 with Tier:T3, but we ask for T-001 → None (not T3)."""
        content = """---
id: TASKS-TEST
status: approved
---

# Tasks

## T-002 Some other task
**Files:** some/file.py
**Tier:** T3
**Estimated complexity:** medium
"""
        result = _mod._extract_tier_for_task(content, "T-001")
        self.assertIsNone(
            result,
            f"Expected None when T-001 section absent, got {result!r}. "
            "Fallback scan must be removed."
        )

    def test_section_absent_blocks_with_tier_missing(self):
        """Whole-pipeline: T-001 section absent in tasks.md → block tier_missing."""
        tmpdir = Path(tempfile.mkdtemp())
        task_dir = tmpdir / "T-001"
        task_dir.mkdir(parents=True)
        # Write a tasks.md that only has T-002, not T-001
        (task_dir / "tasks.md").write_text("""---
id: TASKS-TEST
---

## T-002 Other task
**Tier:** T2
""")
        manifest = {"schema_version": 1, "task_id": "TEST", "actual_dispatches": []}
        (tmpdir / "dispatch-manifest.json").write_text(json.dumps(manifest))

        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="high",
            tier="",
            subagent_type="dev",
            prompt="WorkPacket:\n```yaml\ntask_id: T-001\nmodel: sonnet\neffort: high\nsubagent_type: dev\n```",
            session_dir=tmpdir,
        )
        self.assertEqual(result["decision"], "block")
        self.assertIn("tier_missing", result.get("reason", ""))

    def test_section_absent_does_not_use_tier_from_other_section(self):
        """Even if another task has Tier:T4, absent-section returns None — never T4."""
        content = """---
id: TASKS-TEST
---

## T-099 Unrelated task
**Tier:** T4
"""
        result = _mod._extract_tier_for_task(content, "T-001")
        self.assertIsNone(result)


# ===========================================================================
# AC-005 partial_failure: malformed manifest → block; no manifest + L2 → block
# ===========================================================================

class TestAC005ManifestMalformedAndL2Block(unittest.TestCase):
    """Distinguish 'no manifest' (L1 ok) vs 'malformed manifest' (block)."""

    def setUp(self):
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass
        _mod._tier_cache.clear()

    def _make_session(self, tier: str, manifest_content: str | None) -> Path:
        tmpdir = Path(tempfile.mkdtemp())
        task_dir = tmpdir / "T-001"
        task_dir.mkdir(parents=True)
        (task_dir / "tasks.md").write_text(_make_tasks_md("T-001", tier))
        if manifest_content is not None:
            (tmpdir / "dispatch-manifest.json").write_text(manifest_content)
        return tmpdir

    def test_no_manifest_dev_l1_dispatch_id_allows(self):
        """No manifest + dispatch_id ending -l1 → L1 inferred → allow (legitimate first dispatch)."""
        session_dir = self._make_session("T2", None)  # no manifest file
        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="medium",
            tier="T2",
            subagent_type="dev",
            prompt="WorkPacket:\n```yaml\ntask_id: T-001\ndispatch_id: d-T-001-dev-l1\nmodel: sonnet\neffort: medium\nsubagent_type: dev\n```",
            session_dir=session_dir,
        )
        # No prior dispatches → dev L1; sonnet+medium for T2 is canonical → allow
        self.assertNotIn("decision", result, f"Unexpected block: {result}")

    def test_malformed_manifest_blocks(self):
        """Manifest exists but contains invalid JSON → block with manifest_malformed."""
        session_dir = self._make_session("T2", "NOT VALID JSON {{{")
        result = _load_manifest_dispatches(session_dir, "T-001")
        # _load_manifest_dispatches should signal malformation, not silently return []
        # We check the full pipeline blocks
        full_result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="medium",
            tier="T2",
            subagent_type="dev",
            prompt="WorkPacket:\n```yaml\ntask_id: T-001\ndispatch_id: d-T-001-dev-l2\nmodel: sonnet\neffort: medium\nsubagent_type: dev\n```",
            session_dir=session_dir,
        )
        self.assertEqual(full_result["decision"], "block")
        self.assertIn("manifest_malformed", full_result.get("reason", ""),
                      f"Expected manifest_malformed in reason, got: {full_result}")

    def test_no_manifest_dispatch_id_l2_blocks(self):
        """No manifest + dispatch_id ending -l2 → cannot verify loop → block."""
        session_dir = self._make_session("T4", None)  # no manifest
        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="high",
            tier="T4",
            subagent_type="dev",
            prompt="WorkPacket:\n```yaml\ntask_id: T-001\ndispatch_id: d-T-001-dev-l2\nmodel: sonnet\neffort: high\nsubagent_type: dev\n```",
            session_dir=session_dir,
        )
        self.assertEqual(result["decision"], "block",
                         f"Expected block for L2 dispatch with no manifest, got: {result}")
        self.assertIn("manifest_malformed", result.get("reason", "").lower() +
                      result.get("reason", ""),
                      f"Expected manifest_malformed in reason, got: {result}")

    def test_no_manifest_dispatch_id_l3_blocks(self):
        """No manifest + dispatch_id ending -l3 → block."""
        session_dir = self._make_session("T3", None)
        result = _verify_tier_calibration_for_task(
            task_id="T-001",
            model="sonnet",
            effort="high",
            tier="T3",
            subagent_type="dev",
            prompt="WorkPacket:\n```yaml\ntask_id: T-001\ndispatch_id: d-T-001-dev-l3\nmodel: sonnet\neffort: high\nsubagent_type: dev\n```",
            session_dir=session_dir,
        )
        self.assertEqual(result["decision"], "block")


# ===========================================================================
# AC-009: Task tool `model` parameter enforcement (root-cause cost fix)
# ===========================================================================
# Background: prior to this AC, the orchestrator populated `model` inside the
# Work Packet YAML (descriptive text), but did NOT pass the `model` parameter
# of the Task tool itself. Claude Code's Task tool then fell back to
# "inherit from parent" — the orchestrator's own model (typically opus).
# Result: qa/dev dispatches that the calibration table said should run on
# haiku/sonnet actually ran on opus, multiplying real cost by 3-12×.
#
# These tests pin the new behavior: when canonical model is derivable,
# the Task tool `model` param MUST be present AND match.

class TestAC009ToolModelEnforcement(unittest.TestCase):
    """Verify the Task tool `model` param is enforced against canonical."""

    def setUp(self):
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass
        _mod._tier_cache.clear()

    def _run_verify_with_tool_model(
        self,
        task_id: str,
        tier: str,
        subagent_type: str,
        tool_model: str | None,
        model: str = "",
        effort: str = "",
    ) -> dict:
        """Call _verify_tier_calibration_for_task with a real session_dir
        and explicit tool_model.  model/effort default empty (AC-006 path)
        so the tool_model enforcement runs in isolation."""
        session_dir, _ = _write_temp_files(task_id, tier, [])
        prompt = f"WorkPacket:\n```yaml\ntask_id: {task_id}\nsubagent_type: {subagent_type}\n```"
        return _verify_tier_calibration_for_task(
            task_id=task_id,
            model=model,
            effort=effort,
            tier=tier,
            subagent_type=subagent_type,
            prompt=prompt,
            tool_model=tool_model,
            session_dir=session_dir,
        )

    def test_tool_model_none_skips_enforcement(self):
        """tool_model=None (legacy callers) → skip the new check, fall through to allow."""
        result = self._run_verify_with_tool_model(
            "T-001", "T1", "qa", tool_model=None,
        )
        self.assertNotIn("decision", result, f"Got: {result}")

    def test_tool_model_empty_string_blocks_with_missing_reason(self):
        """tool_model='' (param omitted by orchestrator) → block: task_tool_model_missing."""
        result = self._run_verify_with_tool_model(
            "T-001", "T1", "qa", tool_model="",
        )
        self.assertEqual(result["decision"], "block")
        self.assertIn("task_tool_model_missing", result.get("reason", ""))
        # Reason must name the canonical model the orchestrator should have passed.
        self.assertIn("haiku", result.get("reason", ""),
                      "Block reason should suggest canonical model (haiku for qa T1)")

    def test_tool_model_mismatch_qa_t1_opus_blocks(self):
        """qa T1 canonical=haiku, tool_model=opus → block: task_tool_model_mismatch.

        This is the EXACT bug we found in FEAT-004: qa ran in opus despite
        tier_calibration saying haiku.  Hook must block.
        """
        result = self._run_verify_with_tool_model(
            "T-001", "T1", "qa", tool_model="opus",
        )
        self.assertEqual(result["decision"], "block",
                         f"Expected block when tool_model='opus' but canonical='haiku': {result}")
        self.assertIn("task_tool_model_mismatch", result.get("reason", ""))
        # Reason should name both the wrong model and the canonical.
        self.assertIn("opus", result.get("reason", ""))
        self.assertIn("haiku", result.get("reason", ""))

    def test_tool_model_matches_canonical_allows(self):
        """qa T1 canonical=haiku, tool_model=haiku → allow."""
        result = self._run_verify_with_tool_model(
            "T-001", "T1", "qa", tool_model="haiku",
        )
        self.assertNotIn("decision", result, f"Got: {result}")

    def test_tool_model_case_insensitive(self):
        """Uppercase tool_model should normalize → 'HAIKU' matches canonical 'haiku'."""
        result = self._run_verify_with_tool_model(
            "T-001", "T1", "qa", tool_model="HAIKU",
        )
        self.assertNotIn("decision", result, f"Got: {result}")

    def test_tool_model_mismatch_dev_l1_t2(self):
        """dev L1 T2 canonical=sonnet, tool_model=opus → block."""
        result = self._run_verify_with_tool_model(
            "T-001", "T2", "dev", tool_model="opus",
        )
        self.assertEqual(result["decision"], "block")
        self.assertIn("task_tool_model_mismatch", result.get("reason", ""))

    def test_tool_model_matches_dev_l1_t3(self):
        """dev L1 T3 canonical=sonnet, tool_model=sonnet → allow."""
        result = self._run_verify_with_tool_model(
            "T-001", "T3", "dev", tool_model="sonnet",
        )
        self.assertNotIn("decision", result)

    def test_tool_model_with_workpacket_compare_both_must_match(self):
        """Work Packet model+effort populated AND tool_model populated → both checked.

        Order: tool_model check first (AC-009), then Work Packet (AC-005).
        Mismatch in either blocks.
        """
        session_dir, _ = _write_temp_files("T-001", "T1", [])
        prompt = "WorkPacket:\n```yaml\ntask_id: T-001\nmodel: haiku\neffort: high\nsubagent_type: qa\n```"
        # tool_model right, WP right → allow
        ok = _verify_tier_calibration_for_task(
            task_id="T-001", model="haiku", effort="high", tier="T1",
            subagent_type="qa", prompt=prompt,
            tool_model="haiku", session_dir=session_dir,
        )
        self.assertNotIn("decision", ok)

        # tool_model wrong, WP right → block on tool_model
        bad_tool = _verify_tier_calibration_for_task(
            task_id="T-001", model="haiku", effort="high", tier="T1",
            subagent_type="qa", prompt=prompt,
            tool_model="opus", session_dir=session_dir,
        )
        self.assertEqual(bad_tool["decision"], "block")
        self.assertIn("task_tool_model_mismatch", bad_tool.get("reason", ""))


class TestAC009MainPipeline(unittest.TestCase):
    """End-to-end via main(): verify tool_input.model is read from payload."""

    def setUp(self):
        for p in Path("/tmp").glob("ai-squad-tier-cache-*.json"):
            try:
                p.unlink()
            except OSError:
                pass
        _mod._tier_cache.clear()
        # Set up a fake project dir so _resolve_session_dir() returns something.
        self._project_dir = Path(tempfile.mkdtemp())
        session_root = self._project_dir / ".agent-session"
        task_dir = session_root / "T-001"
        task_dir.mkdir(parents=True)
        (task_dir / "tasks.md").write_text(_make_tasks_md("T-001", "T1"))
        (session_root / "dispatch-manifest.json").write_text(
            json.dumps({"schema_version": 1, "task_id": "T-001", "actual_dispatches": []})
        )
        self._prev_env = os.environ.get("CLAUDE_PROJECT_DIR")
        os.environ["CLAUDE_PROJECT_DIR"] = str(self._project_dir)

    def tearDown(self):
        if self._prev_env is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = self._prev_env

    def _payload(self, prompt: str, tool_model: str | None = None) -> dict:
        tool_input: dict = {"prompt": prompt}
        if tool_model is not None:
            tool_input["model"] = tool_model
        return {"tool_input": tool_input}

    def test_main_blocks_when_tool_model_missing(self):
        """main(): qa dispatch with no tool_input.model → block."""
        prompt = _fenced_packet(
            task_id="T-001", model="haiku", effort="high",
            tier="T1", subagent_type="qa",
        )
        rc, out = _run_main(self._payload(prompt))
        self.assertEqual(rc, 0)
        self.assertTrue(out.strip(), f"Expected block output, got: {out!r}")
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("task_tool_model_missing", result["reason"])

    def test_main_blocks_when_tool_model_wrong(self):
        """main(): qa T1 (canonical=haiku) with tool_input.model='opus' → block.

        This is the exact bug observed in FEAT-004.
        """
        prompt = _fenced_packet(
            task_id="T-001", model="haiku", effort="high",
            tier="T1", subagent_type="qa",
        )
        rc, out = _run_main(self._payload(prompt, tool_model="opus"))
        self.assertEqual(rc, 0)
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("task_tool_model_mismatch", result["reason"])

    def test_main_allows_when_tool_model_matches(self):
        """main(): qa T1 with tool_input.model='haiku' → allow."""
        prompt = _fenced_packet(
            task_id="T-001", model="haiku", effort="high",
            tier="T1", subagent_type="qa",
        )
        rc, out = _run_main(self._payload(prompt, tool_model="haiku"))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "", f"Expected silent allow, got: {out!r}")

    def test_main_audit_agent_short_circuits_before_tool_model_check(self):
        """audit-agent is tier-independent — AC-007 short-circuit fires
        BEFORE AC-009 even when tool_input.model absent."""
        prompt = _fenced_packet(
            task_id="T-001", model="haiku", effort="medium",
            tier="T1", subagent_type="audit-agent",
        )
        # No tool_model passed — still must allow due to AC-007.
        rc, out = _run_main(self._payload(prompt))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main()
