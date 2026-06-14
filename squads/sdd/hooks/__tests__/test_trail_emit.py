#!/usr/bin/env python3
"""Tests for trail-emit.py — model-invoked emitter of decision markers.

The model runs `python3 .../trail-emit.py decision --what ... [--why ...]` and the
script resolves the open observed session, stamps `at` mechanically, and appends one
{kind:"decision"} line to trail.jsonl. JSON is built from argv (json.dumps), so shell
quoting / accents survive — the failure mode that a printf-based C1 would hit.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_trail_emit.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_EMIT_SCRIPT = _HOOKS_DIR / "trail-emit.py"

OBSERVED_YML = """\
schema_version: 1
session_id: OBS-001
mode: observed
intent: "fixar emails na dashboard"
status: in_progress
output_locale: pt-BR
"""


def _run_emit(project_dir: Path, args: list[str]) -> int:
    env = dict(os.environ)
    env["CLAUDE_PROJECT_DIR"] = str(project_dir)
    result = subprocess.run(
        [sys.executable, str(_EMIT_SCRIPT), *args],
        capture_output=True, text=True, timeout=10, env=env,
    )
    return result.returncode


class TestTrailEmit(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.session_dir = self.tmp / ".agent-session" / "OBS-001"
        self.session_dir.mkdir(parents=True)
        (self.session_dir / "session.yml").write_text(OBSERVED_YML, encoding="utf-8")
        self.trail = self.session_dir / "trail.jsonl"

    def tearDown(self):
        self._tmp.cleanup()

    def test_decision_appends_to_trail(self):
        code = _run_emit(self.tmp, ["decision", "--what", "usa JWT", "--why", "stateless"])
        self.assertEqual(code, 0)
        self.assertTrue(self.trail.exists())
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["kind"], "decision")
        self.assertEqual(ev["what"], "usa JWT")
        self.assertEqual(ev["why"], "stateless")
        self.assertIsNone(ev["rejected"])
        self.assertIsNone(ev["ref"])
        self.assertIn("at", ev)

    def test_optional_fields_recorded(self):
        code = _run_emit(self.tmp, [
            "decision", "--what", "X", "--rejected", "Y", "--ref", "src/a.ts",
        ])
        self.assertEqual(code, 0)
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["rejected"], "Y")
        self.assertEqual(ev["ref"], "src/a.ts")
        self.assertIsNone(ev["why"])

    def test_quotes_and_accents_preserved(self):
        # O caso que um C1 com printf corromperia: aspas + acentos + %.
        code = _run_emit(self.tmp, [
            "decision", "--what", 'usa "aspas" e ção', "--why", "porquê: 50%",
        ])
        self.assertEqual(code, 0)
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["what"], 'usa "aspas" e ção')
        self.assertEqual(ev["why"], "porquê: 50%")

    def test_appends_not_overwrites(self):
        _run_emit(self.tmp, ["decision", "--what", "primeira"])
        _run_emit(self.tmp, ["decision", "--what", "segunda"])
        lines = [l for l in self.trail.read_text(encoding="utf-8").splitlines() if l.strip()]
        self.assertEqual(len(lines), 2)
        self.assertEqual(json.loads(lines[0])["what"], "primeira")
        self.assertEqual(json.loads(lines[1])["what"], "segunda")

    def test_non_observed_session_not_recorded(self):
        (self.session_dir / "session.yml").write_text(
            OBSERVED_YML.replace("mode: observed", "mode: sdd"), encoding="utf-8")
        code = _run_emit(self.tmp, ["decision", "--what", "X"])
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())

    def test_terminal_session_not_recorded(self):
        (self.session_dir / "session.yml").write_text(
            OBSERVED_YML.replace("status: in_progress", "status: done"), encoding="utf-8")
        code = _run_emit(self.tmp, ["decision", "--what", "X"])
        self.assertEqual(code, 0)
        self.assertFalse(self.trail.exists())

    def test_picks_observed_over_newer_non_observed(self):
        # Uma sessão SDD mais recente (mtime maior) não deve roubar a decisão
        # nem fazer o helper desistir: a OBS aberta ao lado é a alvo.
        import time
        sdd = self.tmp / ".agent-session" / "FEAT-999"
        sdd.mkdir(parents=True)
        (sdd / "session.yml").write_text(
            OBSERVED_YML.replace("mode: observed", "mode: sdd").replace("OBS-001", "FEAT-999"),
            encoding="utf-8")
        old = time.time() - 1000
        os.utime(self.session_dir, (old, old))  # OBS dir fica mais antigo que a SDD
        code = _run_emit(self.tmp, ["decision", "--what", "X"])
        self.assertEqual(code, 0)
        self.assertTrue(self.trail.exists())
        ev = json.loads(self.trail.read_text(encoding="utf-8").strip())
        self.assertEqual(ev["what"], "X")

    def test_no_session_fails_open(self):
        # Sem .agent-session: nunca derruba (exit 0), só não grava.
        empty = Path(self._tmp.name) / "empty"
        empty.mkdir()
        code = _run_emit(empty, ["decision", "--what", "X"])
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
