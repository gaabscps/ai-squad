#!/usr/bin/env python3
"""Tests for guard-write-scope.py — the /implementer write fence.

The fence enforces Checkpoint A's contract mechanically (FEAT-013 lesson:
prose alone didn't hold — jest.setup.js +76 lines landed outside the
approved_write_scope and masked real behavior):

  - While the implementer Skill is active and the Session is implementing,
    Write/Edit outside `approved_write_scope` is denied with an instruction
    to escalate (attention.kind: input) instead of silently widening scope.
  - Before Checkpoint A (no approved_write_scope yet) ALL source writes are
    denied — the plan-of-attack phase is read-only on source.
  - `.agent-session/` paths are always allowed (trail + artifacts).
  - status done lifts the fence; non-implementer callers are never constrained.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_guard_write_scope.py -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "guard-write-scope.py"


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


SESSION_YML_IMPLEMENTING = """\
task_id: FEAT-013
status: implementing
approved_write_scope:
  - features/signup/services/signupService.ts
  - features/signup/components/steps/partners/   # diretório novo
  - "features/signup/types/api.types.ts"
"""


class TestGuardWriteScope(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.impl = _skill_transcript(self.tmp, "implementer")
        self.session_dir = self.tmp / ".agent-session" / "FEAT-013"
        self.session_dir.mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _write_session(self, text):
        (self.session_dir / "session.yml").write_text(text, encoding="utf-8")

    def _payload(self, rel_path, transcript=None, tool="Write"):
        return json.dumps({
            "tool_name": tool,
            "transcript_path": transcript if transcript is not None else self.impl,
            "cwd": str(self.tmp),
            "tool_input": {"file_path": str(self.tmp / rel_path)},
        })

    # --- fence active: outside scope is denied with escalation guidance ---
    def test_deny_outside_scope_while_implementing(self):
        self._write_session(SESSION_YML_IMPLEMENTING)
        result, _ = _run_hook(self._payload("jest.setup.js"))
        self.assertEqual(_decision(result), "deny")
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("attention", reason)  # tells the implementer to escalate

    def test_allow_exact_file_in_scope(self):
        self._write_session(SESSION_YML_IMPLEMENTING)
        result, code = _run_hook(self._payload("features/signup/services/signupService.ts"))
        self.assertEqual(_decision(result), "")
        self.assertEqual(code, 0)

    def test_allow_inside_scoped_directory_with_inline_comment(self):
        self._write_session(SESSION_YML_IMPLEMENTING)
        result, _ = _run_hook(
            self._payload("features/signup/components/steps/partners/index.tsx"))
        self.assertEqual(_decision(result), "")

    def test_allow_quoted_scope_entry(self):
        self._write_session(SESSION_YML_IMPLEMENTING)
        result, _ = _run_hook(self._payload("features/signup/types/api.types.ts"))
        self.assertEqual(_decision(result), "")

    def test_allow_agent_session_paths_always(self):
        self._write_session(SESSION_YML_IMPLEMENTING)
        result, _ = _run_hook(self._payload(".agent-session/FEAT-013/session.yml"))
        self.assertEqual(_decision(result), "")

    # --- pre-Checkpoint A: no approved scope -> all source writes denied ---
    def test_deny_source_write_before_checkpoint_a(self):
        self._write_session("task_id: FEAT-013\nstatus: needs_attention\n")
        result, _ = _run_hook(self._payload("features/signup/hooks/useSignup.tsx"))
        self.assertEqual(_decision(result), "deny")
        reason = result["hookSpecificOutput"]["permissionDecisionReason"]
        self.assertIn("Checkpoint A", reason)

    # --- fence lifted after the seal ---
    def test_allow_after_done(self):
        self._write_session("task_id: FEAT-013\nstatus: done\napproved_write_scope:\n  - src/a.ts\n")
        result, _ = _run_hook(self._payload("qualquer/arquivo.ts"))
        self.assertEqual(_decision(result), "")

    # --- non-implementer callers untouched ---
    def test_allow_other_skill(self):
        self._write_session(SESSION_YML_IMPLEMENTING)
        designer = _skill_transcript(self.tmp, "designer")
        result, _ = _run_hook(self._payload("jest.setup.js", transcript=designer))
        self.assertEqual(_decision(result), "")

    # --- observed mode (à la carte fence; /observe sessions) ---
    def test_observed_mode_enforces_declared_scope(self):
        self._write_session(
            "session_id: OBS-001\nmode: observed\nstatus: in_progress\n"
            "approved_write_scope:\n  - src/feature/\n")
        observe = _skill_transcript(self.tmp, "observe")
        result, _ = _run_hook(self._payload("jest.setup.js", transcript=observe))
        self.assertEqual(_decision(result), "deny")
        result, _ = _run_hook(self._payload("src/feature/a.ts", transcript=observe))
        self.assertEqual(_decision(result), "")

    def test_observed_mode_without_scope_is_free(self):
        # No Checkpoint A in free sessions: no declared scope -> no fence.
        self._write_session("session_id: OBS-001\nmode: observed\nstatus: in_progress\n")
        observe = _skill_transcript(self.tmp, "observe")
        result, _ = _run_hook(self._payload("qualquer/arquivo.ts", transcript=observe))
        self.assertEqual(_decision(result), "")

    def test_allow_when_no_session_dir(self):
        # No .agent-session at all (e.g. dogfood/dev usage) — fail open.
        for child in self.session_dir.iterdir():
            child.unlink()
        self.session_dir.rmdir()
        (self.tmp / ".agent-session" / "FEAT-013").parent.rmdir()
        result, _ = _run_hook(self._payload("src/livre.ts"))
        self.assertEqual(_decision(result), "")


if __name__ == "__main__":
    unittest.main()
