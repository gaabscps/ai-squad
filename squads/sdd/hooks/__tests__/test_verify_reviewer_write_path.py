#!/usr/bin/env python3
"""
Tests for verify-reviewer-write-path.py.

Covers:
  AC-007 — IF reviewer tries to write a file outside `outputs/`,
            the hook emits {decision: "block"}.
  AC-008 — The hook is a PreToolUse hook (blocks before write executes).

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_verify_reviewer_write_path.py -v
OR:
  python3 squads/sdd/hooks/__tests__/test_verify_reviewer_write_path.py
"""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "verify-reviewer-write-path.py"


def _run_hook(payload: str) -> tuple[dict, int]:
    """Run the hook subprocess with raw payload string on stdin.

    Returns (parsed_json, returncode).
    If stdout is empty, returns ({}, returncode).
    """
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


class TestVerifyReviewerWritePath(unittest.TestCase):

    # ------------------------------------------------------------------
    # AC-007: block writes outside outputs/
    # ------------------------------------------------------------------

    def test_block_path_outside_outputs(self):
        """Write to arbitrary path → block."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "squads/sdd/agents/code-reviewer.md"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("outside outputs/", result.get("reason", ""))
        self.assertEqual(code, 0)

    def test_block_path_absolute_outside_outputs(self):
        """Write to absolute path not starting with outputs/ → block."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "/etc/passwd"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    def test_block_path_relative_traversal(self):
        """Write attempting ../outputs/ bypass → block (does not start with outputs/)."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "../outputs/d-001.json"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # Allow: writes inside outputs/
    # ------------------------------------------------------------------

    def test_allow_path_inside_outputs(self):
        """Write to outputs/<dispatch_id>.json → allow (empty JSON object)."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/d-007.json"},
        })
        result, code = _run_hook(payload)
        # Allow is signalled by empty object {}
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    def test_allow_path_inside_outputs_nested(self):
        """Write to outputs/sub/d-007.json → allow (starts with outputs/)."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/sub/d-007.json"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # Malformed input
    # ------------------------------------------------------------------

    def test_block_malformed_json(self):
        """Non-JSON stdin → block with malformed reason."""
        result, code = _run_hook("not-json-at-all{{{")
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("malformed", result.get("reason", ""))
        self.assertEqual(code, 0)

    def test_block_missing_file_path(self):
        """Valid JSON but missing tool_input.file_path → block with malformed reason."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("malformed", result.get("reason", ""))
        self.assertEqual(code, 0)

    def test_block_missing_tool_input(self):
        """Valid JSON but tool_input key absent → block with malformed reason."""
        payload = json.dumps({"tool_name": "Write"})
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("malformed", result.get("reason", ""))
        self.assertEqual(code, 0)

    def test_block_empty_payload(self):
        """Empty JSON object → block with malformed reason."""
        result, code = _run_hook("{}")
        self.assertEqual(result.get("decision"), "block")
        self.assertIn("malformed", result.get("reason", ""))
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # Reason message includes the blocked path
    # ------------------------------------------------------------------

    def test_block_reason_contains_path(self):
        """Block reason message must include the attempted path."""
        path = "squads/sdd/hooks/some-file.py"
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": path},
        })
        result, code = _run_hook(payload)
        self.assertIn(path, result.get("reason", ""))

    # ------------------------------------------------------------------
    # AC-007 + AC-008: path traversal normalization (Fix 2)
    # ------------------------------------------------------------------

    def test_block_path_traversal_single_dotdot(self):
        """outputs/../secrets escapes outputs/ after normalization → block."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/../secrets"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    def test_block_path_traversal_double_dotdot(self):
        """outputs/../../etc/passwd escapes root after normalization → block."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/../../etc/passwd"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    def test_block_path_traversal_deep_escape(self):
        """outputs/sub/../../secrets is normalized to secrets → block."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/sub/../../secrets"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    def test_block_bare_outputs_directory(self):
        """outputs/ with no filename component → block (not a valid write target)."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result.get("decision"), "block")
        self.assertEqual(code, 0)

    def test_allow_outputs_nested_deep(self):
        """outputs/sub/dir/d-007.json stays inside outputs/ after normalization → allow."""
        payload = json.dumps({
            "tool_name": "Write",
            "tool_input": {"file_path": "outputs/sub/dir/d-007.json"},
        })
        result, code = _run_hook(payload)
        self.assertEqual(result, {})
        self.assertEqual(code, 0)

    # ------------------------------------------------------------------
    # AC-008: hook is declared PreToolUse in source
    # ------------------------------------------------------------------

    def test_hook_declared_pretooluse(self):
        """The hook source must declare PreToolUse (not PostToolUse)."""
        hook_text = _HOOK_SCRIPT.read_text(encoding="utf-8")
        self.assertIn("PreToolUse", hook_text)
        self.assertNotIn("PostToolUse", hook_text)


if __name__ == "__main__":
    unittest.main()
