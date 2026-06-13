#!/usr/bin/env python3
"""Tests for materialize-observed-diff.py — Stop hook that freezes git diff
base_sha into diff.json for observed sessions.

Run: python3 -m pytest squads/sdd/hooks/__tests__/test_materialize_observed_diff.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK = _HOOKS_DIR / "materialize-observed-diff.py"


def _git(cwd, *args):
    subprocess.run(["git", "-C", str(cwd), *args],
                   capture_output=True, text=True, check=True)


def _run(payload: dict) -> subprocess.CompletedProcess:
    r = subprocess.run([sys.executable, str(_HOOK)],
                       input=json.dumps(payload), capture_output=True,
                       text=True, timeout=20, env=os.environ)
    return r


class TestMaterializeDiff(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        _git(self.tmp, "init")
        _git(self.tmp, "config", "user.email", "t@t.t")
        _git(self.tmp, "config", "user.name", "t")
        (self.tmp / "app.ts").write_text("const a = 1\n", encoding="utf-8")
        _git(self.tmp, "add", "-A")
        _git(self.tmp, "commit", "-m", "base")
        self.base = subprocess.run(
            ["git", "-C", str(self.tmp), "rev-parse", "HEAD"],
            capture_output=True, text=True
        ).stdout.strip()
        self.sdir = self.tmp / ".agent-session" / "OBS-001"
        self.sdir.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _stop_payload(self):
        return {"hook_event_name": "Stop", "cwd": str(self.tmp), "session_id": "abc"}

    def _write_yml(self, *, status="done", base=None, mode="observed",
                   sid="OBS-001", owned=True):
        """Write a session.yml for the current test's sdir.

        owned=True appends observed_sessions: ["abc"] so that
        resolve_capture_session finds this dir via find_owner_session even
        when status is terminal (done/abandoned).
        """
        lines = ["schema_version: 1", f"session_id: {sid}"]
        if mode:
            lines.append(f"mode: {mode}")
        lines += ["intent: x", f"status: {status}", "created_at: 2026-06-13T14:00:00Z"]
        if base:
            lines.append(f"base_sha: {base}")
        if owned:
            lines += ["observed_sessions:", '  - "abc"']
        (self.sdir / "session.yml").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ------------------------------------------------------------------
    # Test 1: normal path — base_sha present, file modified after base commit
    # ------------------------------------------------------------------
    def test_diff_json_lists_changed_file_with_counts(self):
        self._write_yml(status="done", base=self.base, owned=True)
        (self.tmp / "app.ts").write_text("const a = 2\nconst b = 3\n", encoding="utf-8")

        r = _run(self._stop_payload())
        self.assertEqual(r.returncode, 0, f"hook stderr: {r.stderr}")

        diff_path = self.sdir / "diff.json"
        self.assertTrue(diff_path.exists(), "diff.json was not created")

        data = json.loads(diff_path.read_text(encoding="utf-8"))
        self.assertEqual(data["base_sha"], self.base)

        paths = [f["path"] for f in data["files"]]
        self.assertIn("app.ts", paths, f"app.ts not in diff files: {paths}")

        app_entry = next(f for f in data["files"] if f["path"] == "app.ts")
        self.assertGreaterEqual(app_entry["added"], 1,
                                "expected at least 1 added line in app.ts")
        self.assertIn("const b = 3", app_entry["patch"],
                      "expected 'const b = 3' in app.ts patch")

    # ------------------------------------------------------------------
    # Test 2: diff vs base_sha survives an intermediate commit
    # ------------------------------------------------------------------
    def test_diff_survives_intermediate_commit(self):
        self._write_yml(status="done", base=self.base, owned=True)
        (self.tmp / "app.ts").write_text("const a = 999\n", encoding="utf-8")
        _git(self.tmp, "add", "-A")
        _git(self.tmp, "commit", "-m", "mid")

        r = _run(self._stop_payload())
        self.assertEqual(r.returncode, 0, f"hook stderr: {r.stderr}")

        diff_path = self.sdir / "diff.json"
        self.assertTrue(diff_path.exists(), "diff.json was not created")

        data = json.loads(diff_path.read_text(encoding="utf-8"))
        paths = [f["path"] for f in data["files"]]
        self.assertIn("app.ts", paths,
                      "app.ts should appear in diff vs base_sha even after intermediate commit")

    # ------------------------------------------------------------------
    # Test 3: no base_sha in yml → fallback to HEAD (shows uncommitted change)
    # ------------------------------------------------------------------
    def test_no_base_sha_falls_back_to_head(self):
        self._write_yml(status="done", base=None, owned=True)
        # Modify app.ts but do NOT commit — HEAD diff will show the change
        (self.tmp / "app.ts").write_text("const a = 42\n", encoding="utf-8")

        r = _run(self._stop_payload())
        self.assertEqual(r.returncode, 0, f"hook stderr: {r.stderr}")

        diff_path = self.sdir / "diff.json"
        self.assertTrue(diff_path.exists(), "diff.json was not created")

        data = json.loads(diff_path.read_text(encoding="utf-8"))
        paths = [f["path"] for f in data["files"]]
        self.assertIn("app.ts", paths,
                      "app.ts should appear via HEAD fallback (uncommitted change)")

    # ------------------------------------------------------------------
    # Test 4: non-observed session (no mode: line, not owned) → no diff.json
    # ------------------------------------------------------------------
    def test_sdd_session_produces_no_diff_json(self):
        # Use a separate dir for the SDD session so it doesn't conflict with OBS-001
        sdd_dir = self.tmp / ".agent-session" / "FEAT-001"
        sdd_dir.mkdir(parents=True)
        # mode=None → no mode line; owned=False → no observed_sessions
        lines = ["schema_version: 1", "session_id: FEAT-001",
                 "intent: x", "status: done", "created_at: 2026-06-13T14:00:00Z"]
        (sdd_dir / "session.yml").write_text("\n".join(lines) + "\n", encoding="utf-8")

        payload = {"hook_event_name": "Stop", "cwd": str(self.tmp), "session_id": "abc"}
        r = _run(payload)
        self.assertEqual(r.returncode, 0, f"hook stderr: {r.stderr}")
        self.assertFalse((sdd_dir / "diff.json").exists(),
                         "SDD session should not produce diff.json")


if __name__ == "__main__":
    unittest.main()
