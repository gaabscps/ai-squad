#!/usr/bin/env python3
"""Tests for track-edits.py — appends one carimbado line per edit to edits.jsonl.

Run: python3 -m pytest squads/sdd/hooks/__tests__/test_track_edits.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK = _HOOKS_DIR / "track-edits.py"

OBSERVED_YML = """\
schema_version: 1
session_id: OBS-001
mode: observed
intent: "fixar emails"
status: in_progress
created_at: 2026-06-13T14:00:00Z
"""

def _run(payload: dict) -> int:
    r = subprocess.run([sys.executable, str(_HOOK)],
                       input=json.dumps(payload), capture_output=True,
                       text=True, timeout=10, env=os.environ)
    return r.returncode

class TestTrackEdits(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.sdir = self.tmp / ".agent-session" / "OBS-001"
        self.sdir.mkdir(parents=True)
        (self.sdir / "session.yml").write_text(OBSERVED_YML, encoding="utf-8")
        self.edits = self.sdir / "edits.jsonl"

    def tearDown(self):
        self._tmp.cleanup()

    def _edit_payload(self, path: str):
        return {"hook_event_name": "PostToolUse", "tool_name": "Edit",
                "cwd": str(self.tmp), "session_id": "abc",
                "tool_input": {"file_path": path}}

    def test_edit_appends_one_line(self):
        code = _run(self._edit_payload(str(self.tmp / "src/app.ts")))
        self.assertEqual(code, 0)
        lines = self.edits.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(lines), 1)
        rec = json.loads(lines[0])
        self.assertEqual(rec["file"], "src/app.ts")   # relativo ao projeto
        self.assertRegex(rec["at"], r"^\d{4}-\d{2}-\d{2}T")

    def test_two_edits_append_two_lines(self):
        _run(self._edit_payload(str(self.tmp / "a.ts")))
        _run(self._edit_payload(str(self.tmp / "b.ts")))
        lines = self.edits.read_text(encoding="utf-8").strip().splitlines()
        self.assertEqual(len(lines), 2)

    def test_edit_inside_agent_session_is_ignored(self):
        # editar o próprio session.yml não deve virar marco
        _run(self._edit_payload(str(self.sdir / "session.yml")))
        self.assertFalse(self.edits.exists())

    def test_sdd_session_is_untouched(self):
        sdd = OBSERVED_YML.replace("mode: observed\n", "")
        (self.sdir / "session.yml").write_text(sdd, encoding="utf-8")
        _run(self._edit_payload(str(self.tmp / "a.ts")))
        self.assertFalse(self.edits.exists())

    def test_done_session_is_untouched(self):
        done = OBSERVED_YML.replace("status: in_progress", "status: done")
        (self.sdir / "session.yml").write_text(done, encoding="utf-8")
        _run(self._edit_payload(str(self.tmp / "a.ts")))
        self.assertFalse(self.edits.exists())

if __name__ == "__main__":
    unittest.main()
