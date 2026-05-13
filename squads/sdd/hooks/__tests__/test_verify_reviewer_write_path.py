#!/usr/bin/env python3
"""
Tests for verify-reviewer-write-path.py.

Covers:
  AC-007 — IF reviewer tries to write a file outside `outputs/`,
            the hook emits {decision: "block"}.
  AC-008 — The hook is a PreToolUse hook (blocks before write executes).
  Bug #3 — Hook is registered globally; it must scope itself to reviewer
            subagent context (via transcript_path scan) and default-allow
            for any other caller.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_verify_reviewer_write_path.py -v
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_reviewer_write_path.py
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "verify-reviewer-write-path.py"


def _run_hook(payload: str) -> tuple[dict, int]:
    """Run the hook subprocess with raw payload string on stdin."""
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=10,
        env=os.environ,
    )
    stdout = result.stdout.strip()
    if not stdout:
        return {}, result.returncode
    return json.loads(stdout), result.returncode


def _make_reviewer_transcript(tmp_dir: Path, role: str = "code-reviewer") -> str:
    """Write a minimal JSONL transcript containing the reviewer Work Packet marker.

    Returns the absolute path as a string, suitable for the hook payload's
    `transcript_path` field.
    """
    transcript = tmp_dir / "transcript.jsonl"
    work_packet = (
        "Work Packet\n"
        f"subagent_type: {role}\n"
        "task_id: T-001\n"
    )
    line = json.dumps({"role": "user", "content": work_packet})
    transcript.write_text(line + "\n", encoding="utf-8")
    return str(transcript)


class TestVerifyReviewerWritePath(unittest.TestCase):

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)
        # Default: every payload constructed in tests gets a reviewer
        # transcript so the existing "block bad path" coverage still applies.
        self.reviewer_transcript = _make_reviewer_transcript(self.tmp_path)

    def tearDown(self):
        self._tmp.cleanup()

    def _payload(self, file_path, *, transcript_path=None, omit_tool_input=False, omit_file_path=False):
        body = {
            "tool_name": "Write",
            "transcript_path": transcript_path if transcript_path is not None else self.reviewer_transcript,
        }
        if not omit_tool_input:
            tool_input = {} if omit_file_path else {"file_path": file_path}
            body["tool_input"] = tool_input
        return json.dumps(body)

    # ------------------------------------------------------------------
    # Default-allow when caller is NOT a reviewer subagent (Bug #3)
    # ------------------------------------------------------------------

    def test_allow_when_no_transcript_path(self):
        """No transcript_path in payload → cannot identify caller → allow."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "/etc/passwd"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    def test_allow_when_transcript_lacks_reviewer_marker(self):
        """Transcript exists but no reviewer subagent_type marker → allow."""
        non_reviewer = self.tmp_path / "non-reviewer.jsonl"
        non_reviewer.write_text(
            json.dumps({"role": "user", "content": "Hello there, no marker here."}) + "\n",
            encoding="utf-8",
        )
        payload = self._payload("/etc/passwd", transcript_path=str(non_reviewer))
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    def test_allow_when_transcript_missing_file(self):
        """transcript_path points to a non-existent file → allow."""
        payload = self._payload("/etc/passwd", transcript_path=str(self.tmp_path / "ghost.jsonl"))
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    def test_detect_logic_reviewer(self):
        """logic-reviewer marker also triggers enforcement."""
        transcript = _make_reviewer_transcript(self.tmp_path, role="logic-reviewer")
        payload = self._payload("squads/sdd/agents/x.md", transcript_path=transcript)
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")

    # ------------------------------------------------------------------
    # AC-007: block writes outside outputs/ when caller IS a reviewer
    # ------------------------------------------------------------------

    def test_block_path_outside_outputs(self):
        payload = self._payload("squads/sdd/agents/code-reviewer.md")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("outside outputs/", result.get("reason", ""))
        self.assertEqual(code, 0)

    def test_block_path_absolute_outside_outputs(self):
        payload = self._payload("/etc/passwd")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    def test_block_path_relative_traversal(self):
        payload = self._payload("../outputs/d-001.json")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # Allow: writes inside outputs/
    # ------------------------------------------------------------------

    def test_allow_path_inside_outputs(self):
        payload = self._payload("outputs/d-007.json")
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    def test_allow_path_inside_outputs_nested(self):
        payload = self._payload("outputs/sub/d-007.json")
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # Malformed input (reviewer context): hook is fail-open. The reviewer
    # subagent has its own scoping invariants — we'd rather miss a block
    # than emit a false-positive against a non-reviewer caller.
    # ------------------------------------------------------------------

    def test_allow_malformed_json(self):
        result, code = _run_hook("not-json-at-all{{{")
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    def test_block_missing_file_path(self):
        """Reviewer context + tool_input.file_path missing → block as malformed."""
        payload = self._payload(None, omit_file_path=True)
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("malformed", result.get("reason", ""))

    def test_block_missing_tool_input(self):
        """Reviewer context + tool_input absent → block as malformed."""
        payload = self._payload(None, omit_tool_input=True)
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("malformed", result.get("reason", ""))

    def test_allow_empty_payload(self):
        """Empty JSON object → no reviewer context → allow."""
        result, code = _run_hook("{}")
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # Reason message includes the blocked path
    # ------------------------------------------------------------------

    def test_block_reason_contains_path(self):
        path = "squads/sdd/hooks/some-file.py"
        payload = self._payload(path)
        result, code = _run_hook(payload)
        self.assertIn(path, result.get("reason", ""))

    # ------------------------------------------------------------------
    # Path traversal normalization (still applies inside reviewer context)
    # ------------------------------------------------------------------

    def test_block_path_traversal_single_dotdot(self):
        payload = self._payload("outputs/../secrets")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")

    def test_block_path_traversal_double_dotdot(self):
        payload = self._payload("outputs/../../etc/passwd")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")

    def test_block_path_traversal_deep_escape(self):
        payload = self._payload("outputs/sub/../../secrets")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")

    def test_block_bare_outputs_directory(self):
        payload = self._payload("outputs/")
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")

    def test_allow_outputs_nested_deep(self):
        payload = self._payload("outputs/sub/dir/d-007.json")
        result, code = _run_hook(payload)
        self.assertEqual(result, {})

    # ------------------------------------------------------------------
    # AC-008: hook is declared PreToolUse in source
    # ------------------------------------------------------------------

    def test_hook_declared_pretooluse(self):
        hook_text = _HOOK_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("PreToolUse", hook_text)
        self.assertNotIn("PostToolUse", hook_text)


if __name__ == "__main__":
    unittest.main()
