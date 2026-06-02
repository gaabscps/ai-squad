#!/usr/bin/env python3
"""Tests for manifest_append.py — atomic append to dispatch-manifest.json."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_CLI = _HOOKS_DIR / "manifest_append.py"


def _run_cli(manifest_path: Path, dispatch_json: str) -> tuple[dict, int, str, str]:
    """Invoke the CLI with manifest path as argv[1] and dispatch JSON on stdin.

    Returns (parsed_json, returncode, raw_stdout, raw_stderr). Tests assert the
    stdout/stderr routing contract: success -> stdout, failure -> stderr.
    """
    result = subprocess.run(
        [sys.executable, str(_CLI), str(manifest_path)],
        input=dispatch_json,
        capture_output=True,
        text=True,
        timeout=10,
        env=os.environ,
    )
    out = (result.stdout or result.stderr).strip()
    parsed = json.loads(out) if out else {}
    return parsed, result.returncode, result.stdout, result.stderr


def _seed_manifest(tmp: Path) -> Path:
    manifest = {
        "schema_version": 1,
        "spec_id": "FEAT-001",
        "expected_pipeline": [{"task_id": "T-001", "required_roles": ["dev"]}],
        "actual_dispatches": [],
    }
    p = tmp / "dispatch-manifest.json"
    p.write_text(json.dumps(manifest, indent=2))
    return p


class TestManifestAppend(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp())

    def test_append_adds_entry(self):
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-dev-l1", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": 1}
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 0)
        self.assertTrue(out["appended"])
        self.assertEqual(out["actual_dispatches_count"], 1)
        doc = json.loads(manifest.read_text())
        self.assertEqual(doc["actual_dispatches"][0]["dispatch_id"], "d-T-001-dev-l1")
        # expected_pipeline untouched
        self.assertEqual(len(doc["expected_pipeline"]), 1)
        self.assertEqual(stderr, "", "success must not write to stderr")
        self.assertNotEqual(stdout.strip(), "", "success must write to stdout")

    def test_missing_manifest_errors(self):
        out, rc, stdout, stderr = _run_cli(self._tmp / "nope.json", json.dumps({"dispatch_id": "x"}))
        self.assertEqual(rc, 1)
        self.assertFalse(out["appended"])
        self.assertIn("not found", out["error"].lower())
        self.assertEqual(stdout, "", "failure must not write to stdout")
        self.assertNotEqual(stderr.strip(), "", "failure must write to stderr")

    def test_malformed_stdin_errors(self):
        manifest = _seed_manifest(self._tmp)
        out, rc, stdout, stderr = _run_cli(manifest, "{not json")
        self.assertEqual(rc, 1)
        self.assertFalse(out["appended"])
        self.assertEqual(stdout, "", "failure must not write to stdout")
        self.assertNotEqual(stderr.strip(), "", "failure must write to stderr")

    def test_concurrent_appends_no_corruption(self):
        manifest = _seed_manifest(self._tmp)

        def worker(i: int):
            _run_cli(manifest, json.dumps(
                {"dispatch_id": f"d-T-001-dev-l{i}", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": i}))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(1, 11)]
        for t in threads: t.start()
        for t in threads: t.join()
        doc = json.loads(manifest.read_text())  # must be valid JSON
        self.assertEqual(len(doc["actual_dispatches"]), 10)


class TestReviewLoopGuard(unittest.TestCase):
    """FEAT-041 shift-left: a task-scoped dispatch entry must record a concrete
    review_loop (integer >= 1). The defect was dev fix-dispatch entries written
    with review_loop: null, caught only at the final audit sweep (d)."""

    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp())

    def test_dev_entry_with_null_review_loop_rejected(self):
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-dev-l2", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": None}
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 1)
        self.assertFalse(out["appended"])
        self.assertIn("review_loop", out["error"])
        # the malformed entry must NOT have been appended
        doc = json.loads(manifest.read_text())
        self.assertEqual(len(doc["actual_dispatches"]), 0)

    def test_qa_entry_missing_review_loop_rejected(self):
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-qa-l1", "task_id": "T-001",
                 "role": "qa", "status": "done"}  # review_loop absent
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 1)
        self.assertIn("review_loop", out["error"])

    def test_review_loop_zero_rejected(self):
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-dev-l1", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": 0}
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 1)
        self.assertIn("review_loop", out["error"])

    def test_review_loop_bool_rejected(self):
        """review_loop: true must not slip through as 'int' (bool is an int subclass)."""
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-dev-l1", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": True}
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 1)
        self.assertIn("review_loop", out["error"])

    def test_valid_dev_entry_still_appends(self):
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-dev-l2", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": 2}
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 0)
        self.assertTrue(out["appended"])

    def test_audit_agent_entry_exempt_from_review_loop(self):
        """Pipeline-scoped roles (audit-agent, committer) derive review_loop
        differently and are not blocked when it is absent."""
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-FEAT-001-audit-1", "role": "audit-agent",
                 "status": "done"}  # no task_id, no review_loop
        out, rc, stdout, stderr = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 0, stderr)
        self.assertTrue(out["appended"])


if __name__ == "__main__":
    unittest.main()
