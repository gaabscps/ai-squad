#!/usr/bin/env python3
"""Tests for verify-impl-seal.py — the Checkpoint B decisions/evidence gate.

FEAT-013 lesson: the implementer reached Checkpoint B with decisions[] and
evidence[] absent from session.yml — the rationalizations (e.g. duplicating
masks.cpf despite the Reuse Map entry) stayed invisible to the human. This
hook makes the seal mechanical: a session.yml write that declares
attention.kind: final_approval (or status: done) is denied unless decisions:
and evidence: are present and non-empty in the resulting file.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_verify_impl_seal.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "verify-impl-seal.py"


def _run_hook(payload: str) -> tuple[dict, int]:
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=payload, capture_output=True, text=True, timeout=10, env=os.environ,
    )
    stdout = result.stdout.strip()
    return (json.loads(stdout) if stdout else {}), result.returncode


def _skill_transcript(tmp_dir: Path, skill: str) -> str:
    transcript = tmp_dir / f"transcript-{skill}.jsonl"
    line = json.dumps({
        "role": "user",
        "content": f"Base directory for this skill: /home/u/.claude/skills/{skill}",
    })
    transcript.write_text(line + "\n", encoding="utf-8")
    return str(transcript)


def _decision(result: dict) -> str:
    return (result.get("hookSpecificOutput") or {}).get("permissionDecision", "")


WITH_TRAIL = """\
decisions:
  - id: D-IMPL-01
    what: "algo"
evidence:
  - kind: tests
    result: "10 pass"
"""


class TestVerifyImplSeal(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.impl = _skill_transcript(self.tmp, "implementer")
        self.session_dir = self.tmp / ".agent-session" / "FEAT-013"
        self.session_dir.mkdir(parents=True)
        self.session_yml = self.session_dir / "session.yml"

    def tearDown(self):
        self._tmp.cleanup()

    def _payload(self, tool="Write", content=None, new_string=None,
                 rel_path=".agent-session/FEAT-013/session.yml", transcript=None):
        tool_input = {"file_path": str(self.tmp / rel_path)}
        if content is not None:
            tool_input["content"] = content
        if new_string is not None:
            tool_input["new_string"] = new_string
        return json.dumps({
            "tool_name": tool,
            "transcript_path": transcript if transcript is not None else self.impl,
            "cwd": str(self.tmp),
            "tool_input": tool_input,
        })

    # --- the FEAT-013 case: seal without trail -> deny ---
    def test_deny_final_approval_without_decisions(self):
        result, _ = _run_hook(self._payload(
            content="status: needs_attention\nattention:\n  kind: final_approval\n"))
        self.assertEqual(_decision(result), "deny")
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("decisions", reason)

    def test_deny_done_without_evidence(self):
        result, _ = _run_hook(self._payload(
            content="status: done\ndecisions:\n  - id: D-1\n    what: x\n"))
        self.assertEqual(_decision(result), "deny")

    def test_deny_empty_decisions_list(self):
        result, _ = _run_hook(self._payload(
            content="status: done\ndecisions: []\nevidence:\n  - kind: tests\n"))
        self.assertEqual(_decision(result), "deny")

    # --- trail present -> allow ---
    def test_allow_seal_with_trail_in_content(self):
        result, _ = _run_hook(self._payload(
            content="status: done\nattention:\n  kind: final_approval\n" + WITH_TRAIL))
        self.assertEqual(_decision(result), "")

    def test_allow_edit_seal_when_trail_already_in_file(self):
        self.session_yml.write_text("status: implementing\n" + WITH_TRAIL, encoding="utf-8")
        result, _ = _run_hook(self._payload(
            tool="Edit", new_string="status: needs_attention\nattention:\n  kind: final_approval\n"))
        self.assertEqual(_decision(result), "")

    # --- out of jurisdiction -> allow ---
    def test_allow_non_seal_session_write(self):
        result, _ = _run_hook(self._payload(
            content="status: implementing\nplan_approved_at: x\n"))
        self.assertEqual(_decision(result), "")

    def test_allow_other_files(self):
        result, _ = _run_hook(self._payload(
            rel_path="src/app.ts", content="status: done"))
        self.assertEqual(_decision(result), "")

    def test_allow_other_skill(self):
        pm = _skill_transcript(self.tmp, "pm")
        result, _ = _run_hook(self._payload(
            content="status: done\n", transcript=pm))
        self.assertEqual(_decision(result), "")


if __name__ == "__main__":
    unittest.main()
