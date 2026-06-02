#!/usr/bin/env python3
"""Tests for verify-dispatch-packet.py — PostToolUse(Task) packet detection."""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK = _HOOKS_DIR / "verify-dispatch-packet.py"


def _load_main():
    spec = importlib.util.spec_from_file_location("verify_dispatch_packet", str(_HOOK))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_main(mod, payload: dict, project_dir: Path) -> tuple[int, str]:
    stdin_bak, stdout_bak = sys.stdin, sys.stdout
    env_bak = os.environ.get("CLAUDE_PROJECT_DIR")
    os.environ["CLAUDE_PROJECT_DIR"] = str(project_dir)
    try:
        sys.stdin = StringIO(json.dumps(payload))
        buf = StringIO()
        sys.stdout = buf
        rc = mod.main()
    finally:
        sys.stdin, sys.stdout = stdin_bak, stdout_bak
        if env_bak is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = env_bak
    return rc, buf.getvalue()


_VALID_PACKET = {
    "spec_id": "FEAT-001", "dispatch_id": "d-T-001-cr-l1", "task_id": "T-001",
    "role": "code-reviewer", "status": "done", "summary": "ok",
    "evidence": [], "usage": None, "findings": [],
}


def _make_session(tmp: Path, spec_id="FEAT-001") -> Path:
    session = tmp / ".agent-session" / spec_id
    (session / "outputs").mkdir(parents=True, exist_ok=True)
    (session / "session.yml").write_text("current_owner: orchestrator\ncurrent_phase: implementation\n")
    return session


def _payload(subagent_type: str, dispatch_id: str) -> dict:
    return {
        "tool_name": "Task",
        "tool_input": {
            "subagent_type": subagent_type,
            "prompt": f"Work Packet\ndispatch_id: {dispatch_id}\ntask_id: T-001",
        },
        "tool_response": {"content": "done"},
    }


class TestVerifyDispatchPacket(unittest.TestCase):
    def setUp(self):
        self.mod = _load_main()
        self.tmp = Path(tempfile.mkdtemp())

    def test_missing_packet_emits_additional_context(self):
        _make_session(self.tmp)  # outputs/ empty -> packet missing
        rc, out = _run_main(self.mod, _payload("code-reviewer", "d-T-001-cr-l1"), self.tmp)
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        ctx = doc["hookSpecificOutput"]["additionalContext"]
        self.assertIn("d-T-001-cr-l1", ctx)
        self.assertIn("packet", ctx.lower())

    def test_valid_packet_is_silent(self):
        session = _make_session(self.tmp)
        (session / "outputs" / "d-T-001-cr-l1.json").write_text(json.dumps(_VALID_PACKET))
        rc, out = _run_main(self.mod, _payload("code-reviewer", "d-T-001-cr-l1"), self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")

    def test_invalid_packet_emits_additional_context(self):
        session = _make_session(self.tmp)
        bad = dict(_VALID_PACKET)
        del bad["status"]  # missing required field
        (session / "outputs" / "d-T-001-cr-l1.json").write_text(json.dumps(bad))
        rc, out = _run_main(self.mod, _payload("code-reviewer", "d-T-001-cr-l1"), self.tmp)
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        self.assertIn("d-T-001-cr-l1", doc["hookSpecificOutput"]["additionalContext"])

    def test_non_phase4_subagent_is_silent(self):
        _make_session(self.tmp)
        rc, out = _run_main(self.mod, _payload("Explore", "whatever"), self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")

    def test_no_dispatch_id_is_silent(self):
        _make_session(self.tmp)
        payload = {"tool_name": "Task", "tool_input": {"subagent_type": "dev", "prompt": "no id here"}}
        rc, out = _run_main(self.mod, payload, self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")


if __name__ == "__main__":
    unittest.main()
