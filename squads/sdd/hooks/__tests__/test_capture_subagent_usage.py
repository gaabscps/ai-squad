#!/usr/bin/env python3
"""
Tests for capture-subagent-usage.py.

Focus: the dispatch-id correlation paths (primary file-based stamp,
fallback transcript-based extraction). The fallback was added after
FEAT-004 / FEAT-005 lost 30+ dispatches' worth of usage data because
the PostToolUse `_session_id` stamper was not always firing.

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_capture_subagent_usage
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "capture-subagent-usage.py"

# Import the hook module directly so we can unit-test helpers without spawning
# subprocesses (the script's filename has a hyphen so we use spec_from_file_location).
_spec = importlib.util.spec_from_file_location(
    "capture_subagent_usage", _HOOK_SCRIPT
)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

extract_dispatch_id_from_transcript = _mod.extract_dispatch_id_from_transcript
find_packet_by_session = _mod.find_packet_by_session


def _write_jsonl(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for e in entries:
            fh.write(json.dumps(e) + "\n")


def _user_turn_with_workpacket(dispatch_id: str) -> dict:
    """Build a transcript user turn carrying the Work Packet YAML."""
    work_packet = (
        "WorkPacket:\n"
        "```yaml\n"
        "task_id: T-001\n"
        f"dispatch_id: {dispatch_id}\n"
        "model: sonnet\n"
        "effort: high\n"
        "tier: T2\n"
        "subagent_type: dev\n"
        "```"
    )
    return {
        "type": "user",
        "message": {"role": "user", "content": work_packet},
    }


def _user_turn_with_workpacket_blocks(dispatch_id: str) -> dict:
    """Same as above but with content as a list of blocks (alt transcript shape)."""
    work_packet = f"WorkPacket:\n```yaml\ndispatch_id: {dispatch_id}\n```"
    return {
        "type": "user",
        "message": {
            "role": "user",
            "content": [{"type": "text", "text": work_packet}],
        },
    }


class TestExtractDispatchIdFromTranscript(unittest.TestCase):

    def test_extracts_from_string_content(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            tp = tmp / "t.jsonl"
            _write_jsonl(tp, [
                _user_turn_with_workpacket("d-T-001-dev-l1"),
                {"type": "assistant", "message": {"role": "assistant", "content": "ok"}},
            ])
            self.assertEqual(
                extract_dispatch_id_from_transcript(tp),
                "d-T-001-dev-l1",
            )

    def test_extracts_from_content_blocks(self):
        """Some transcript shapes wrap content as a list of {type, text} blocks."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            tp = tmp / "t.jsonl"
            _write_jsonl(tp, [
                _user_turn_with_workpacket_blocks("d-T-007-qa-l2"),
            ])
            self.assertEqual(
                extract_dispatch_id_from_transcript(tp),
                "d-T-007-qa-l2",
            )

    def test_returns_none_when_transcript_missing(self):
        self.assertIsNone(
            extract_dispatch_id_from_transcript(Path("/nonexistent/file.jsonl"))
        )

    def test_returns_none_when_no_workpacket(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            tp = tmp / "t.jsonl"
            _write_jsonl(tp, [
                {"type": "user", "message": {"role": "user", "content": "just chatting"}},
            ])
            self.assertIsNone(extract_dispatch_id_from_transcript(tp))

    def test_skips_malformed_lines(self):
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            tp = tmp / "t.jsonl"
            # Write a malformed first line, valid second line.
            with tp.open("w", encoding="utf-8") as fh:
                fh.write("not-json\n")
                fh.write(json.dumps(_user_turn_with_workpacket("d-T-002-dev-l3")) + "\n")
            self.assertEqual(
                extract_dispatch_id_from_transcript(tp),
                "d-T-002-dev-l3",
            )

    def test_first_match_wins_when_multiple(self):
        """Some transcripts echo the Work Packet in later turns too."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            tp = tmp / "t.jsonl"
            _write_jsonl(tp, [
                _user_turn_with_workpacket("d-T-001-dev-l1"),
                _user_turn_with_workpacket("d-T-999-other-l1"),
            ])
            self.assertEqual(
                extract_dispatch_id_from_transcript(tp),
                "d-T-001-dev-l1",
            )

    def test_only_matches_canonical_d_prefix(self):
        """`dispatch_id: foobar` (no `d-` prefix) is ignored."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            tp = tmp / "t.jsonl"
            _write_jsonl(tp, [
                {"type": "user", "message": {
                    "role": "user",
                    "content": "dispatch_id: notvalid",
                }},
                _user_turn_with_workpacket("d-T-005-dev-l1"),
            ])
            # First message has `dispatch_id: notvalid` — regex requires d- prefix
            # → must skip and match the second.
            self.assertEqual(
                extract_dispatch_id_from_transcript(tp),
                "d-T-005-dev-l1",
            )


def _run_hook_subprocess(payload: dict, project_dir: str) -> int:
    """Spawn the hook with payload on stdin; return exit code."""
    env = {**os.environ, "CLAUDE_PROJECT_DIR": project_dir}
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=10,
        env=env,
    )
    return result.returncode


class TestFallbackCorrelation(unittest.TestCase):
    """End-to-end: when _session_id stamp is absent, fallback to transcript dispatch_id."""

    def _make_session(self, tmp: Path) -> Path:
        session_dir = tmp / ".agent-session" / "FEAT-099"
        outputs = session_dir / "outputs"
        outputs.mkdir(parents=True)
        manifest = {
            "schema_version": 2,
            "task_id": "FEAT-099",
            "actual_dispatches": [
                {
                    "dispatch_id": "d-T-001-dev-l1",
                    "task_id": "T-001",
                    "role": "dev",
                    "started_at": "2026-05-11T05:00:00Z",
                    "completed_at": "2026-05-11T05:05:00Z",
                    "status": "done",
                    "loop": 1,
                    "pm_note": None,
                    "tier_calibration": {
                        "tier": "T2", "model": "sonnet",
                        "effort": "high", "loop_kind": "dev L1",
                    },
                },
            ],
        }
        (session_dir / "dispatch-manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        return session_dir

    def test_fallback_populates_usage_when_session_id_unstamped(self):
        """No packet has _session_id stamp → fallback path extracts dispatch_id
        from transcript and still writes usage to the manifest entry."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = self._make_session(tmp)

            # Write an UNSTAMPED output packet (no _session_id field).
            (session_dir / "outputs" / "d-T-001-dev-l1.json").write_text(
                json.dumps({
                    "dispatch_id": "d-T-001-dev-l1",
                    "status": "done",
                    # no _session_id — primary correlation path fails
                }), encoding="utf-8",
            )

            # Build a transcript with the Work Packet + 2 assistant turns with usage.
            transcript = tmp / "subagent-transcript.jsonl"
            _write_jsonl(transcript, [
                _user_turn_with_workpacket("d-T-001-dev-l1"),
                {
                    "timestamp": "2026-05-11T05:01:00Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-4-6",
                        "usage": {
                            "input_tokens": 1000,
                            "output_tokens": 500,
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 100,
                        },
                    },
                },
                {
                    "timestamp": "2026-05-11T05:02:00Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-4-6",
                        "usage": {
                            "input_tokens": 2000,
                            "output_tokens": 800,
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 0,
                        },
                    },
                },
            ])

            payload = {
                "stop_hook_active": False,
                "session_id": "subagent-session-abc",
                "transcript_path": str(transcript),
            }
            rc = _run_hook_subprocess(payload, str(tmp))
            self.assertEqual(rc, 0)

            updated = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = updated["actual_dispatches"][0]
            usage = entry.get("usage", {})
            # Fallback successfully populated usage.
            self.assertEqual(usage.get("input_tokens"), 3000, f"got: {usage}")
            self.assertEqual(usage.get("output_tokens"), 1300, f"got: {usage}")

    def test_primary_path_wins_when_session_id_stamped(self):
        """When _session_id is stamped, primary path is used (faster + intended)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = self._make_session(tmp)

            # Write a STAMPED output packet.
            (session_dir / "outputs" / "d-T-001-dev-l1.json").write_text(
                json.dumps({
                    "dispatch_id": "d-T-001-dev-l1",
                    "status": "done",
                    "_session_id": "subagent-session-xyz",
                }), encoding="utf-8",
            )

            transcript = tmp / "transcript.jsonl"
            _write_jsonl(transcript, [
                _user_turn_with_workpacket("d-T-001-dev-l1"),
                {
                    "timestamp": "2026-05-11T05:01:00Z",
                    "message": {
                        "role": "assistant",
                        "model": "claude-sonnet-4-6",
                        "usage": {
                            "input_tokens": 100,
                            "output_tokens": 50,
                            "cache_creation_input_tokens": 0,
                            "cache_read_input_tokens": 0,
                        },
                    },
                },
            ])
            payload = {
                "stop_hook_active": False,
                "session_id": "subagent-session-xyz",
                "transcript_path": str(transcript),
            }
            rc = _run_hook_subprocess(payload, str(tmp))
            self.assertEqual(rc, 0)

            entry = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )["actual_dispatches"][0]
            self.assertEqual(entry["usage"]["input_tokens"], 100)


if __name__ == "__main__":
    unittest.main()
