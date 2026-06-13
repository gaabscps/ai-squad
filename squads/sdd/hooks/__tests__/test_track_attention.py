#!/usr/bin/env python3
"""Tests for track-attention.py — mechanical needs_attention for observed sessions.

Pivot premise (observability OS): the aiOS "needs your attention" column must
NOT depend on model discipline. The signal is mechanical: AskUserQuestion
firing means the session is blocked on the human; the next UserPromptSubmit
means the human engaged. The hook flips session.yml status accordingly —
but ONLY for free/observed sessions (`mode: observed`); SDD sessions manage
their own status machine and are never touched.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_track_attention.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "track-attention.py"


def _run_hook(payload: dict) -> int:
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=json.dumps(payload), capture_output=True, text=True, timeout=10,
        env=os.environ,
    )
    return result.returncode


OBSERVED_YML = """\
schema_version: 1
session_id: OBS-001
mode: observed
intent: "fixar emails na dashboard"
status: in_progress
output_locale: pt-BR
"""


class TestTrackAttention(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.session_dir = self.tmp / ".agent-session" / "OBS-001"
        self.session_dir.mkdir(parents=True)
        self.session_yml = self.session_dir / "session.yml"

    def tearDown(self):
        self._tmp.cleanup()

    def _ask_payload(self):
        return {
            "hook_event_name": "PreToolUse",
            "tool_name": "AskUserQuestion",
            "cwd": str(self.tmp),
            "tool_input": {"questions": []},
        }

    def _prompt_payload(self):
        return {
            "hook_event_name": "UserPromptSubmit",
            "cwd": str(self.tmp),
            "prompt": "resposta do humano",
        }

    def test_ask_user_question_flips_to_needs_attention(self):
        self.session_yml.write_text(OBSERVED_YML, encoding="utf-8")
        code = _run_hook(self._ask_payload())
        self.assertEqual(code, 0)
        text = self.session_yml.read_text(encoding="utf-8")
        self.assertIn("status: needs_attention", text)
        self.assertIn("kind: input", text)
        # other fields preserved
        self.assertIn('intent: "fixar emails na dashboard"', text)

    def test_user_prompt_clears_needs_attention(self):
        self.session_yml.write_text(
            OBSERVED_YML.replace("status: in_progress",
                                 "status: needs_attention\nattention:\n  kind: input"),
            encoding="utf-8")
        _run_hook(self._prompt_payload())
        text = self.session_yml.read_text(encoding="utf-8")
        self.assertIn("status: in_progress", text)
        self.assertNotIn("needs_attention", text)
        self.assertNotIn("kind: input", text)

    def test_user_prompt_noop_when_already_in_progress(self):
        self.session_yml.write_text(OBSERVED_YML, encoding="utf-8")
        before = self.session_yml.read_text(encoding="utf-8")
        _run_hook(self._prompt_payload())
        self.assertEqual(self.session_yml.read_text(encoding="utf-8"), before)

    def test_sdd_session_without_mode_is_untouched(self):
        sdd = OBSERVED_YML.replace("mode: observed\n", "")
        self.session_yml.write_text(sdd, encoding="utf-8")
        _run_hook(self._ask_payload())
        self.assertEqual(self.session_yml.read_text(encoding="utf-8"), sdd)

    def test_done_session_is_never_flipped(self):
        done = OBSERVED_YML.replace("status: in_progress", "status: done")
        self.session_yml.write_text(done, encoding="utf-8")
        _run_hook(self._ask_payload())
        self.assertEqual(self.session_yml.read_text(encoding="utf-8"), done)

    def test_abandoned_session_is_never_flipped(self):
        abandoned = OBSERVED_YML.replace("status: in_progress", "status: abandoned")
        self.session_yml.write_text(abandoned, encoding="utf-8")
        _run_hook(self._ask_payload())
        self.assertEqual(self.session_yml.read_text(encoding="utf-8"), abandoned)

    def test_no_session_dir_is_silent(self):
        self.session_yml.unlink(missing_ok=True)
        code = _run_hook(self._ask_payload())
        self.assertEqual(code, 0)


    # ------------------------------------------------------------------
    # Task 7a — blocks.jsonl event appending
    # ------------------------------------------------------------------

    def test_ask_appends_blocked_event(self):
        self.session_yml.write_text(OBSERVED_YML, encoding="utf-8")
        _run_hook(self._ask_payload())
        blocks_file = self.session_dir / "blocks.jsonl"
        self.assertTrue(blocks_file.exists(), "blocks.jsonl should have been created")
        lines = [l for l in blocks_file.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines), 1, "exactly one event line expected")
        rec = json.loads(lines[0])
        self.assertEqual(rec["event"], "blocked")
        self.assertEqual(rec["kind"], "input")
        self.assertRegex(rec["at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_prompt_appends_resumed_event(self):
        self.session_yml.write_text(
            OBSERVED_YML.replace("status: in_progress",
                                 "status: needs_attention\nattention:\n  kind: input"),
            encoding="utf-8",
        )
        _run_hook(self._prompt_payload())
        blocks_file = self.session_dir / "blocks.jsonl"
        self.assertTrue(blocks_file.exists(), "blocks.jsonl should have been created")
        lines = [l for l in blocks_file.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines), 1)
        rec = json.loads(lines[0])
        self.assertEqual(rec["event"], "resumed")
        self.assertNotIn("kind", rec)
        self.assertRegex(rec["at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_no_block_event_without_flip(self):
        # Already at needs_attention → ask payload → no flip → no blocks.jsonl
        already_blocked = OBSERVED_YML.replace(
            "status: in_progress", "status: needs_attention\nattention:\n  kind: input"
        )
        self.session_yml.write_text(already_blocked, encoding="utf-8")
        _run_hook(self._ask_payload())
        self.assertFalse(
            (self.session_dir / "blocks.jsonl").exists(),
            "blocks.jsonl must NOT be created when there is no flip",
        )

    def test_sdd_session_writes_no_block(self):
        sdd = OBSERVED_YML.replace("mode: observed\n", "")
        self.session_yml.write_text(sdd, encoding="utf-8")
        _run_hook(self._ask_payload())
        self.assertFalse(
            (self.session_dir / "blocks.jsonl").exists(),
            "SDD sessions must not produce blocks.jsonl",
        )


if __name__ == "__main__":
    unittest.main()
