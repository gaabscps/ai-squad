#!/usr/bin/env python3
"""Tests for verify-pipeline-completeness.py (FEAT-008 Gap B)."""
from __future__ import annotations

import atexit
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path

# Skill-scope gate stub.
_ORCH_TRANSCRIPT = Path(tempfile.NamedTemporaryFile(
    mode="w", suffix=".jsonl", delete=False
).name)
_ORCH_TRANSCRIPT.write_text(
    "Base directory for this Skill: /tmp/.claude/skills/orchestrator\n",
    encoding="utf-8",
)
atexit.register(lambda: _ORCH_TRANSCRIPT.unlink(missing_ok=True))

_HOOK_PATH = Path(__file__).resolve().parents[1] / "verify-pipeline-completeness.py"
_spec = importlib.util.spec_from_file_location("verify_pipeline_completeness", _HOOK_PATH)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]
main = _mod.main


def _make_workpacket(task_id: str, session_id: str, subagent_type: str) -> str:
    return (
        "WorkPacket:\n"
        "```yaml\n"
        f"session_id: {session_id}\n"
        f"task_id: {task_id}\n"
        f"subagent_type: {subagent_type}\n"
        "```\n"
    )


def _run_main(payload: dict, env_project_dir: str | None = None) -> tuple[int, str]:
    sys.stdin = StringIO(json.dumps(payload))
    captured = StringIO()
    saved_stdout = sys.stdout
    sys.stdout = captured
    saved_env = os.environ.get("CLAUDE_PROJECT_DIR")
    try:
        if env_project_dir:
            os.environ["CLAUDE_PROJECT_DIR"] = env_project_dir
        rc = main()
    finally:
        sys.stdout = saved_stdout
        if saved_env is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = saved_env
        sys.stdin = sys.__stdin__
    return rc, captured.getvalue()


class TestPipelineCompleteness(unittest.TestCase):
    def setUp(self) -> None:
        self._project = Path(tempfile.mkdtemp())
        self._session_dir = self._project / ".agent-session"
        self._session_dir.mkdir()
        self._feat_dir = self._session_dir / "FEAT-099"
        self._feat_dir.mkdir()

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self._project, ignore_errors=True)

    def _write_manifest(self, dispatches: list[dict]) -> None:
        (self._feat_dir / "dispatch-manifest.json").write_text(
            json.dumps({
                "schema_version": 1,
                "expected_pipeline": [],
                "actual_dispatches": dispatches,
            }),
            encoding="utf-8",
        )

    def _write_tasks_md(self, body: str) -> None:
        (self._feat_dir / "tasks.md").write_text(body, encoding="utf-8")

    def _qa_payload(self, task_id: str) -> dict:
        return {
            "tool_input": {
                "prompt": _make_workpacket(task_id, "FEAT-099", "qa"),
                "model": "haiku",
                "subagent_type": "qa",
            },
            "transcript_path": str(_ORCH_TRANSCRIPT),
        }

    def test_non_qa_dispatch_silent_allow(self):
        payload = {
            "tool_input": {
                "prompt": _make_workpacket("T-001", "FEAT-099", "dev"),
                "model": "haiku",
                "subagent_type": "dev",
            },
            "transcript_path": str(_ORCH_TRANSCRIPT),
        }
        rc, out = _run_main(payload, env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_qa_with_cr_and_lr_done_allow(self):
        self._write_tasks_md("## T-001 task\n**Tier:** T1\n")
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
            {"task_id": "T-001", "role": "code-reviewer", "status": "done"},
            {"task_id": "T-001", "role": "logic-reviewer", "status": "needs_review"},
        ])
        rc, out = _run_main(self._qa_payload("T-001"), env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_qa_without_cr_lr_blocked(self):
        self._write_tasks_md("## T-001 task\n**Tier:** T1\n")
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
        ])
        rc, out = _run_main(self._qa_payload("T-001"), env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertTrue(out.strip(), f"expected block payload, got: {out!r}")
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("pipeline_incomplete", result["reason"])

    def test_qa_without_cr_lr_but_skip_marker_allow(self):
        self._write_tasks_md(
            "## T-001 task\n**Tier:** T1\n**Skip reviewers:** budget — cost cap exception\n"
        )
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
        ])
        rc, out = _run_main(self._qa_payload("T-001"), env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_qa_only_cr_missing_lr_blocked(self):
        self._write_tasks_md("## T-001 task\n**Tier:** T1\n")
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
            {"task_id": "T-001", "role": "code-reviewer", "status": "done"},
        ])
        rc, out = _run_main(self._qa_payload("T-001"), env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("logic-reviewer", result["reason"])

    def test_qa_skip_marker_for_different_task_does_not_help(self):
        self._write_tasks_md(
            "## T-001 task\n**Tier:** T1\n\n"
            "## T-002 task\n**Tier:** T1\n**Skip reviewers:** unrelated\n"
        )
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
        ])
        rc, out = _run_main(self._qa_payload("T-001"), env_project_dir=str(self._project))
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")


if __name__ == "__main__":
    unittest.main()
