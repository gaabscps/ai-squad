#!/usr/bin/env python3
"""Tests for guard-session-scope.py — orchestrator write-scope guard.

Covers:
  - Orchestrator may write inside .agent-session/<spec_id>/ (manifest, inputs/, session.yml).
  - Orchestrator may NOT write under .agent-session/<spec_id>/outputs/ — those are
    subagent-authored Output Packets; editing them is the FEAT-010 audit-gaming
    pattern, now blocked mechanically.
  - Orchestrator may NOT write source files outside .agent-session/.
  - Non-orchestrator callers are not constrained (default-allow).

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_guard_session_scope.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "guard-session-scope.py"


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


class TestGuardSessionScope(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.orch = _skill_transcript(self.tmp, "orchestrator")

    def tearDown(self):
        self._tmp.cleanup()

    def _payload(self, rel_path, transcript=None):
        return json.dumps({
            "tool_name": "Write",
            "transcript_path": transcript if transcript is not None else self.orch,
            "cwd": str(self.tmp),
            "tool_input": {"file_path": str(self.tmp / rel_path)},
        })

    # --- Camada B: outputs/ is off-limits to the orchestrator ---
    def test_deny_outputs_packet(self):
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/outputs/d-T-001-dev-l1.json"))
        self.assertEqual(_decision(result), "deny")
        self.assertIn("outputs", result["hookSpecificOutput"]["permissionDecisionReason"])

    # --- Spec A: the audit baseline is off-limits to the orchestrator ---
    def test_deny_audit_baseline(self):
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/audit-baseline.json"))
        self.assertEqual(_decision(result), "deny")
        self.assertIn("baseline", result["hookSpecificOutput"]["permissionDecisionReason"].lower())

    # --- orchestrator-owned paths inside .agent-session/ stay allowed ---
    def test_allow_inputs(self):
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/inputs/d-T-001-dev-l1.json"))
        self.assertEqual(result, {})

    def test_allow_manifest(self):
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/dispatch-manifest.json"))
        self.assertEqual(result, {})

    def test_allow_session_yml(self):
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/session.yml"))
        self.assertEqual(result, {})

    # --- existing invariant: no source edits outside .agent-session/ ---
    def test_deny_source_outside_session(self):
        result, _ = _run_hook(self._payload("src/auth/login.ts"))
        self.assertEqual(_decision(result), "deny")

    # --- guard only constrains the orchestrator ---
    def test_allow_non_orchestrator_caller(self):
        other = _skill_transcript(self.tmp, "spec-writer")
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/outputs/d-x.json", transcript=other))
        self.assertEqual(result, {})


if __name__ == "__main__":
    unittest.main()
