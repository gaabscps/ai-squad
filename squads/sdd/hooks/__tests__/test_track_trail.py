#!/usr/bin/env python3
"""Tests for track-trail.py — live Bash trail for observed sessions.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_track_trail.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "track-trail.py"

OBSERVED_YML = """\
schema_version: 1
session_id: OBS-001
mode: observed
intent: "fixar emails na dashboard"
status: in_progress
output_locale: pt-BR
"""


def _run_hook(payload: dict) -> int:
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=json.dumps(payload), capture_output=True, text=True, timeout=10,
        env=os.environ,
    )
    return result.returncode


class TestTrackTrail(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.session_dir = self.tmp / ".agent-session" / "OBS-001"
        self.session_dir.mkdir(parents=True)
        (self.session_dir / "session.yml").write_text(OBSERVED_YML, encoding="utf-8")
        self.trail = self.session_dir / "trail.jsonl"

    def tearDown(self):
        self._tmp.cleanup()

    def _bash_payload(self, cmd: str):
        return {
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "cwd": str(self.tmp),
            "tool_input": {"command": cmd},
        }

    def test_bash_appends_trail_event(self):
        code = _run_hook(self._bash_payload("npm test"))
        self.assertEqual(code, 0)
        self.assertTrue(self.trail.exists())
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["kind"], "run")
        self.assertEqual(ev["tool"], "Bash")
        self.assertEqual(ev["summary"], "npm test")
        self.assertIn("at", ev)

    def test_trail_emit_command_is_suppressed(self):
        # O helper trail-emit roda como Bash e ja escreveu a linha decision;
        # o hook NAO deve gravar uma linha run duplicada para esse comando.
        cmd = 'python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/trail-emit.py" decision --what "X"'
        code = _run_hook(self._bash_payload(cmd))
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())

    def test_mention_of_helper_is_not_suppressed(self):
        # Apenas MENCIONAR o script (sem invocar o subcomando) vira run normal.
        code = _run_hook(self._bash_payload("cat .claude/hooks/trail-emit.py"))
        self.assertEqual(code, 0)
        self.assertTrue(self.trail.exists())
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["kind"], "run")

    def test_read_tool_is_ignored(self):
        payload = {
            "hook_event_name": "PostToolUse", "tool_name": "Read",
            "cwd": str(self.tmp), "tool_input": {"file_path": "x.ts"},
        }
        code = _run_hook(payload)
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())

    def test_non_observed_session_is_ignored(self):
        (self.session_dir / "session.yml").write_text(
            OBSERVED_YML.replace("mode: observed", "mode: sdd"), encoding="utf-8")
        code = _run_hook(self._bash_payload("npm test"))
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())

    def test_product_session_suppresses_run(self):
        # Sessao observada de PRODUTO: a timeline de produto nasce limpa, sem
        # comandos Bash (ruido de engenharia). O hook nao grava o marco run.
        (self.session_dir / "session.yml").write_text(
            OBSERVED_YML + "work_type: product\n", encoding="utf-8")
        code = _run_hook(self._bash_payload("npm test"))
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())

    def test_dev_work_type_still_appends_run(self):
        # work_type explicito 'dev' (ou ausente) mantem o comportamento: grava run.
        (self.session_dir / "session.yml").write_text(
            OBSERVED_YML + "work_type: dev\n", encoding="utf-8")
        code = _run_hook(self._bash_payload("npm test"))
        self.assertEqual(code, 0)
        self.assertTrue(self.trail.exists())
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["kind"], "run")

    def test_empty_command_is_ignored(self):
        code = _run_hook(self._bash_payload(""))
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())


if __name__ == "__main__":
    unittest.main()
