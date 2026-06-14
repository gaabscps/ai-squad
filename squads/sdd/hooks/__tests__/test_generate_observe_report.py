#!/usr/bin/env python3
"""Tests for generate-observe-report.py — Stop hook, observed parecer.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_generate_observe_report.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "generate-observe-report.py"

OBSERVED_YML = """\
schema_version: 1
session_id: OBS-001
mode: observed
intent: "fixar emails na dashboard"
status: done
output_locale: pt-BR
observed_sessions:
  - "chat-abc-123"
decisions:
  - what: "usa VPButton"
    why: "é o botão do DS"
    rejected: "Button legacy"
"""


def _run_hook(payload: dict, cwd: Path) -> int:
    return subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=json.dumps(payload), capture_output=True, text=True, timeout=15,
        env={**os.environ, "CLAUDE_PROJECT_DIR": str(cwd)},
    ).returncode


class TestGenerateObserveReport(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.session_dir = self.tmp / ".agent-session" / "OBS-001"
        self.session_dir.mkdir(parents=True)
        (self.session_dir / "session.yml").write_text(OBSERVED_YML, encoding="utf-8")

    def tearDown(self):
        self._tmp.cleanup()

    def test_writes_report_md_for_observed(self):
        payload = {"hook_event_name": "Stop", "session_id": "chat-abc-123", "cwd": str(self.tmp)}
        code = _run_hook(payload, self.tmp)
        self.assertEqual(code, 0)
        report = self.session_dir / "report.md"
        self.assertTrue(report.exists())
        self.assertIn("usa VPButton", report.read_text(encoding="utf-8"))

    def test_skips_non_observed(self):
        (self.session_dir / "session.yml").write_text(
            OBSERVED_YML.replace("mode: observed", "mode: sdd"), encoding="utf-8")
        payload = {"hook_event_name": "Stop", "session_id": "chat-abc-123", "cwd": str(self.tmp)}
        code = _run_hook(payload, self.tmp)
        self.assertEqual(code, 0)
        self.assertFalse((self.session_dir / "report.md").exists())


if __name__ == "__main__":
    unittest.main()
