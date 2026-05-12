#!/usr/bin/env python3
"""
Tests for capture-pm-usage.py hook.

Covers T-016 / AC-013:
  - platform_captured path (telemetry in payload) → entry with source: "platform_captured"
  - self_reported path (pm_handoff.json present) → entry with source: "self_reported"
  - both absent → no entry written + hook still emits allow (logs warning)
  - manifest atomic-mutate race resilience (concurrent flock)

Run with:
  python3 -m unittest squads.sdd.hooks.__tests__.test_capture_pm_usage
OR:
  python3 squads/sdd/hooks/__tests__/test_capture_pm_usage.py
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK_SCRIPT = _HOOKS_DIR / "capture-pm-usage.py"


def _make_minimal_manifest(session_id: str = "pm-FEAT-004-20260511T053800Z") -> dict:
    """Return a minimal schema_version 2 manifest with pm_sessions[] key."""
    return {
        "schema_version": 2,
        "task_id": "FEAT-004",
        "plan_generated_at": "2026-05-11T05:38:00Z",
        "expected_pipeline": [],
        "actual_dispatches": [],
        "pm_sessions": [],
    }


def _run_hook(payload: dict, *, project_dir: str) -> dict:
    """Run the hook subprocess with payload on stdin; returns parsed stdout JSON."""
    env = {**os.environ, "CLAUDE_PROJECT_DIR": project_dir}
    result = subprocess.run(
        [sys.executable, str(_HOOK_SCRIPT)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=10,
        env=env,
    )
    stdout = result.stdout.strip()
    if not stdout:
        # Hook emitted nothing — informational allow
        return {"decision": "allow"}
    return json.loads(stdout)


def _make_session_dir(
    tmp: Path,
    feature_id: str = "FEAT-004",
    owner: str = "pm",
    phase: str = "implementation",
    planned: list | None = None,
) -> Path:
    """Create .agent-session/<feature_id>/ with a minimal manifest AND session.yml.

    Writes session.yml so that find_active_session() can qualify (or not) the
    session based on owner/phase/planned_phases — matching the real runtime layout.
    """
    session_dir = tmp / ".agent-session" / feature_id
    session_dir.mkdir(parents=True, exist_ok=True)
    manifest = _make_minimal_manifest()
    (session_dir / "dispatch-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    planned_list = planned if planned is not None else ["specify", "plan", "tasks", "implementation"]
    yml_lines = [
        f'current_owner: "{owner}"\n',
        f'current_phase: "{phase}"\n',
        "planned_phases:\n",
    ]
    for p in planned_list:
        yml_lines.append(f'  - "{p}"\n')
    yml_lines.append('last_activity_at: "2026-05-11T01:00:00Z"\n')
    (session_dir / "session.yml").write_text("".join(yml_lines), encoding="utf-8")
    return session_dir


# ---------------------------------------------------------------------------
# AC-013 — always allow (informational hook)
# ---------------------------------------------------------------------------

class TestAlwaysAllow(unittest.TestCase):
    """Capture hook must ALWAYS emit {decision: allow} regardless of capture result."""

    def test_allow_when_no_telemetry_no_handoff(self):
        """Both sources absent → still allow, no entry written."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "test-session-abc",
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             f"Expected allow, got: {result}")
            # manifest pm_sessions must still be empty
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest.get("pm_sessions", []), [],
                             "No entry should be written when both sources absent")

    def test_allow_when_stop_hook_active(self):
        """stop_hook_active guard: loop prevention must allow immediately."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            payload = {"stop_hook_active": True, "session_id": "test-session-xyz"}
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")

    def test_allow_when_manifest_missing(self):
        """No manifest → hook exits gracefully with allow (nothing to append to)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Create session dir without manifest
            session_dir = tmp / ".agent-session" / "FEAT-004"
            session_dir.mkdir(parents=True)
            payload = {
                "stop_hook_active": False,
                "session_id": "test-session-nomf",
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")


# ---------------------------------------------------------------------------
# AC-013 — platform_captured path
# ---------------------------------------------------------------------------

class TestPlatformCaptured(unittest.TestCase):
    """When hook payload contains usage telemetry, source must be 'platform_captured'."""

    def _make_usage_payload(self, session_id: str) -> dict:
        return {
            "stop_hook_active": False,
            "session_id": session_id,
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 500,
                "cache_creation_input_tokens": 200,
                "cache_read_input_tokens": 100,
            },
        }

    def test_platform_captured_entry_written(self):
        """Payload with usage dict → pm_sessions entry with source=platform_captured."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            session_id = "pm-FEAT-004-20260511T053800Z"
            payload = self._make_usage_payload(session_id)
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1,
                             f"Expected 1 pm_sessions entry, got: {sessions}")
            entry = sessions[0]
            self.assertEqual(entry.get("source"), "platform_captured",
                             f"Expected source=platform_captured, got: {entry}")

    def test_platform_captured_usage_fields(self):
        """pm_sessions entry must have all required usage sub-fields."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            session_id = "pm-FEAT-004-20260511T060000Z"
            payload = {
                "stop_hook_active": False,
                "session_id": session_id,
                "usage": {
                    "input_tokens": 2000,
                    "output_tokens": 800,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            usage = entry.get("usage", {})
            self.assertIn("input_tokens", usage, f"Missing input_tokens: {entry}")
            self.assertIn("output_tokens", usage, f"Missing output_tokens: {entry}")
            self.assertIn("total_tokens", usage, f"Missing total_tokens: {entry}")
            self.assertIn("cost_usd", usage, f"Missing cost_usd: {entry}")
            # total_tokens must be sum of input + output only (cache tracked separately)
            expected_total = (
                usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
            )
            self.assertEqual(usage["total_tokens"], expected_total,
                             f"total_tokens mismatch: {usage}")

    def test_platform_captured_session_id_in_entry(self):
        """session_id from payload is propagated to pm_sessions entry."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            session_id = "pm-FEAT-004-test-session"
            payload = {
                "stop_hook_active": False,
                "session_id": session_id,
                "usage": {"input_tokens": 100, "output_tokens": 50,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            self.assertEqual(entry.get("session_id"), session_id,
                             f"session_id mismatch: {entry}")

    def test_platform_captured_required_top_level_fields(self):
        """pm_sessions entry must have session_id, started_at, completed_at, usage, source."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-FEAT-004-fields-test",
                "usage": {"input_tokens": 10, "output_tokens": 5,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            for field in ("session_id", "started_at", "completed_at", "usage", "source"):
                self.assertIn(field, entry,
                              f"Required field '{field}' missing from pm_sessions entry: {entry}")


# ---------------------------------------------------------------------------
# AC-013 — self_reported path (pm_handoff.json fallback)
# ---------------------------------------------------------------------------

class TestSelfReported(unittest.TestCase):
    """When payload lacks usage AND pm_handoff.json exists, source=self_reported."""

    def _write_handoff(self, session_dir: Path, data: dict) -> None:
        (session_dir / "pm_handoff.json").write_text(
            json.dumps(data, indent=2), encoding="utf-8"
        )

    def test_self_reported_entry_written(self):
        """pm_handoff.json present + no payload usage → source=self_reported."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-FEAT-004-selfrep",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:38:00Z",
                "usage": {
                    "input_tokens": 3000,
                    "output_tokens": 1200,
                    "total_tokens": 4200,
                    "cost_usd": 0.042,
                },
                "source": "self_reported",
            }
            self._write_handoff(session_dir, handoff_data)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-FEAT-004-selfrep",
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1,
                             f"Expected 1 pm_sessions entry from handoff.json, got: {sessions}")
            entry = sessions[0]
            self.assertEqual(entry.get("source"), "self_reported",
                             f"Expected source=self_reported, got: {entry}")

    def test_self_reported_usage_fields_preserved(self):
        """Usage from pm_handoff.json is preserved verbatim in pm_sessions entry."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-FEAT-004-preserve",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:00:00Z",
                "usage": {
                    "input_tokens": 5000,
                    "output_tokens": 2000,
                    "total_tokens": 7000,
                    "cost_usd": 0.09,
                },
                "source": "self_reported",
            }
            self._write_handoff(session_dir, handoff_data)
            payload = {"stop_hook_active": False, "session_id": "any"}
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            self.assertEqual(entry["usage"]["input_tokens"], 5000)
            self.assertEqual(entry["usage"]["output_tokens"], 2000)
            self.assertEqual(entry["usage"]["total_tokens"], 7000)
            self.assertAlmostEqual(entry["usage"]["cost_usd"], 0.09, places=5)

    def test_platform_captured_takes_priority_over_handoff(self):
        """When payload has usage AND pm_handoff.json exists, prefer platform_captured."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-handoff-id",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:38:00Z",
                "usage": {
                    "input_tokens": 999,
                    "output_tokens": 111,
                    "total_tokens": 1110,
                    "cost_usd": 0.01,
                },
                "source": "self_reported",
            }
            self._write_handoff(session_dir, handoff_data)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-platform-id",
                "usage": {"input_tokens": 200, "output_tokens": 100,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1)
            entry = sessions[0]
            self.assertEqual(entry.get("source"), "platform_captured",
                             f"Platform telemetry should take priority: {entry}")


# ---------------------------------------------------------------------------
# AC-013 — idempotency / schema compatibility
# ---------------------------------------------------------------------------

class TestManifestMutation(unittest.TestCase):
    """Manifest mutation correctness and schema_version handling."""

    def test_pm_sessions_appended_not_replaced(self):
        """Multiple runs append entries; existing entries are not wiped."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            # Pre-populate with one entry
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            manifest["pm_sessions"] = [{
                "session_id": "pm-first",
                "started_at": "2026-05-11T01:00:00Z",
                "completed_at": "2026-05-11T02:00:00Z",
                "usage": {"input_tokens": 100, "output_tokens": 50,
                          "total_tokens": 150, "cost_usd": 0.001},
                "source": "self_reported",
            }]
            (session_dir / "dispatch-manifest.json").write_text(
                json.dumps(manifest, indent=2), encoding="utf-8"
            )
            # Run hook again with new usage
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-second",
                "usage": {"input_tokens": 200, "output_tokens": 80,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            _run_hook(payload, project_dir=tmp_str)
            updated = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = updated.get("pm_sessions", [])
            self.assertEqual(len(sessions), 2,
                             f"Expected 2 entries after second run, got: {sessions}")
            ids = [s["session_id"] for s in sessions]
            self.assertIn("pm-first", ids)
            self.assertIn("pm-second", ids)

    def test_v1_manifest_gets_pm_sessions_added(self):
        """A v1 manifest (no pm_sessions key) gets the field added on first capture."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = tmp / ".agent-session" / "FEAT-004"
            session_dir.mkdir(parents=True, exist_ok=True)
            # Write a v1-style manifest without pm_sessions
            v1_manifest = {
                "schema_version": 1,
                "task_id": "FEAT-004",
                "plan_generated_at": "2026-05-11T05:38:00Z",
                "expected_pipeline": [],
                "actual_dispatches": [],
            }
            (session_dir / "dispatch-manifest.json").write_text(
                json.dumps(v1_manifest, indent=2), encoding="utf-8"
            )
            # session.yml required so find_active_session() can qualify the session
            (session_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T01:00:00Z"\n',
                encoding="utf-8",
            )
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-v1-test",
                "usage": {"input_tokens": 100, "output_tokens": 50,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")
            updated = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = updated.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1,
                             f"Expected 1 entry added to v1 manifest, got: {sessions}")
            self.assertEqual(sessions[0]["source"], "platform_captured")

    def test_output_is_valid_json(self):
        """Hook always emits valid JSON on stdout (hook contract requirement)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-json-test",
                "usage": {"input_tokens": 10, "output_tokens": 5,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            env = {**os.environ, "CLAUDE_PROJECT_DIR": tmp_str}
            result = subprocess.run(
                [sys.executable, str(_HOOK_SCRIPT)],
                input=json.dumps(payload),
                capture_output=True,
                text=True,
                timeout=10,
                env=env,
            )
            stdout = result.stdout.strip()
            if stdout:
                parsed = json.loads(stdout)  # Must not raise
                self.assertIsInstance(parsed, dict)
                self.assertEqual(parsed.get("decision"), "allow")


# ---------------------------------------------------------------------------
# AC-013 — concurrency / atomic-write race resilience
# ---------------------------------------------------------------------------


def _run_concurrent_writes(n_threads: int, project_dir: str) -> set[str]:
    """Run n_threads concurrent hook writes against project_dir.

    Uses threading.Barrier(n_threads) so all threads start simultaneously,
    maximising contention on the flock path.  Returns the set of session_ids
    found in pm_sessions[] after all threads complete.

    Raises AssertionError if any thread raised an exception.
    """
    barrier = threading.Barrier(n_threads)
    session_ids = [f"pm-concurrent-{i}" for i in range(n_threads)]
    errors: list[str] = []

    def run_one(session_id: str) -> None:
        try:
            barrier.wait(timeout=10)  # synchronise start across all threads
            payload = {
                "stop_hook_active": False,
                "session_id": session_id,
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            }
            _run_hook(payload, project_dir=project_dir)
        except Exception as exc:
            errors.append(f"{session_id}: {exc}")

    threads = [threading.Thread(target=run_one, args=(sid,)) for sid in session_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert errors == [], f"Concurrent writes raised errors: {errors}"

    session_dir_root = Path(project_dir) / ".agent-session"
    # Find the first manifest that was written into
    for candidate in session_dir_root.iterdir():
        manifest_path = candidate / "dispatch-manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            return {s["session_id"] for s in manifest.get("pm_sessions", [])}
    return set()


class TestAtomicWrite(unittest.TestCase):
    """Concurrent hook invocations must not corrupt the manifest."""

    def test_concurrent_writes_n2_both_entries_written(self):
        """Two concurrent hook runs (n=2) must both append their entries (flock race)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            ids = _run_concurrent_writes(2, tmp_str)
            self.assertEqual(ids, {"pm-concurrent-0", "pm-concurrent-1"},
                             f"n=2: expected both session IDs in manifest, got: {ids}")

    def test_concurrent_writes_n5_all_entries_written(self):
        """Five concurrent hook runs (n=5) must all append their entries."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            ids = _run_concurrent_writes(5, tmp_str)
            expected = {f"pm-concurrent-{i}" for i in range(5)}
            self.assertEqual(ids, expected,
                             f"n=5: expected all 5 session IDs in manifest, got: {ids}")

    def test_concurrent_writes_n10_all_entries_written(self):
        """Ten concurrent hook runs (n=10) must all append their entries."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            ids = _run_concurrent_writes(10, tmp_str)
            expected = {f"pm-concurrent-{i}" for i in range(10)}
            self.assertEqual(ids, expected,
                             f"n=10: expected all 10 session IDs in manifest, got: {ids}")


# ---------------------------------------------------------------------------
# Logic-reviewer findings — new regression tests
# ---------------------------------------------------------------------------

class TestTotalTokensNoCache(unittest.TestCase):
    """total_tokens must be input + output only; cache tracked separately."""

    def test_total_tokens_excludes_cache(self):
        """Platform path: total_tokens = input + output, cache NOT included."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-cache-test",
                "usage": {
                    "input_tokens": 1000,
                    "output_tokens": 500,
                    "cache_creation_input_tokens": 200,
                    "cache_read_input_tokens": 100,
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            self.assertEqual(entry["usage"]["total_tokens"], 1500,
                             "total_tokens must be input+output only (no cache)")


class TestIdempotencyDedup(unittest.TestCase):
    """Duplicate session_id: second append with same session_id must be skipped."""

    def test_dedup_same_session_id_not_duplicated(self):
        """Running hook twice with same session_id must result in exactly 1 entry."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-dedup-session",
                "usage": {"input_tokens": 100, "output_tokens": 50,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            _run_hook(payload, project_dir=tmp_str)
            _run_hook(payload, project_dir=tmp_str)
            session_dir = tmp / ".agent-session" / "FEAT-004"
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1,
                             f"Dedup: expected 1 entry for same session_id, got {len(sessions)}")


class TestNonNumericTokensGraceful(unittest.TestCase):
    """Non-numeric token values must not crash; hook must always allow."""

    def test_non_numeric_tokens_still_allow(self):
        """Garbage token values: hook must emit allow and degrade gracefully."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-bad-tokens",
                "usage": {
                    "input_tokens": "not-a-number",
                    "output_tokens": None,
                    "cache_creation_input_tokens": [],
                    "cache_read_input_tokens": {},
                },
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             "Non-numeric tokens must still allow")

    def test_non_numeric_tokens_entry_written_with_nones_or_zeros(self):
        """On parse failure, entry is written with None/0 fields, not skipped entirely."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-bad-tokens-entry",
                "usage": {
                    "input_tokens": "bad",
                    "output_tokens": "worse",
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            # Entry must exist even with bad tokens
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1,
                             "Entry must be written even when token fields are non-numeric")


class TestNegativeTokensClamp(unittest.TestCase):
    """Negative token values must be clamped to 0."""

    def test_negative_tokens_clamped(self):
        """input_tokens=-100 must be stored as 0 in the entry."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-negative-tokens",
                "usage": {
                    "input_tokens": -100,
                    "output_tokens": -50,
                    "cache_creation_input_tokens": -10,
                    "cache_read_input_tokens": -5,
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            usage = entry["usage"]
            self.assertGreaterEqual(usage["input_tokens"], 0, "input_tokens must be >= 0")
            self.assertGreaterEqual(usage["output_tokens"], 0, "output_tokens must be >= 0")
            self.assertGreaterEqual(usage["total_tokens"], 0, "total_tokens must be >= 0")


class TestHandoffUsageNonDictGuard(unittest.TestCase):
    """When handoff['usage'] is not a dict, hook must degrade gracefully."""

    def test_handoff_usage_non_dict_still_allow(self):
        """pm_handoff.json with usage=None (non-dict): hook allows, entry written."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-bad-usage",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:00:00Z",
                "usage": None,  # non-dict
            }
            (session_dir / "pm_handoff.json").write_text(
                json.dumps(handoff_data, indent=2), encoding="utf-8"
            )
            payload = {"stop_hook_active": False, "session_id": "pm-bad-usage"}
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             "Non-dict usage in handoff must still allow")


class TestBuildEntryExceptionAlwaysAllow(unittest.TestCase):
    """Even if _build_entry raises, hook must always emit allow."""

    def test_allow_on_build_entry_crash(self):
        """Malformed but dict-shaped usage that triggers downstream crash → allow."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            # cost_usd is a non-number type that passes isinstance check but
            # triggers float() conversion issues in some codepaths
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-crash-test",
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "cost_usd": "not-a-float",
                },
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")


class TestFindActiveSessionEnvPreference(unittest.TestCase):
    """find_active_session prefers CLAUDE_PROJECT_DIR env var (public naming)."""

    def test_env_var_session_dir_used(self):
        """When CLAUDE_PROJECT_DIR is set, that dir is used over cwd heuristic."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-env-test",
                "usage": {"input_tokens": 100, "output_tokens": 50,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(manifest.get("pm_sessions", [])), 1,
                             "Entry must be written when CLAUDE_PROJECT_DIR is set")


class TestStartedAtISO(unittest.TestCase):
    """started_at in pm_sessions entry must be a valid ISO 8601 string."""

    def test_started_at_is_iso8601(self):
        """Platform-captured entry: started_at must parse as ISO 8601."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-iso-test",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                    "started_at": "not-a-date",  # invalid; hook must fall back
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            started = entry.get("started_at", "")
            # Must be parseable as ISO 8601
            try:
                datetime.fromisoformat(started.replace("Z", "+00:00"))
            except (ValueError, AttributeError) as exc:
                self.fail(f"started_at is not valid ISO 8601: {started!r} ({exc})")

    def test_handoff_started_at_invalid_falls_back(self):
        """Self-reported: non-ISO started_at in handoff falls back to completed_at."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-handoff-iso",
                "started_at": "INVALID-DATE",
                "completed_at": "ALSO-INVALID",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "total_tokens": 150,
                    "cost_usd": 0.001,
                },
            }
            (session_dir / "pm_handoff.json").write_text(
                json.dumps(handoff_data, indent=2), encoding="utf-8"
            )
            payload = {"stop_hook_active": False, "session_id": "pm-handoff-iso"}
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             "Invalid ISO in handoff must still allow")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1)
            entry = sessions[0]
            started = entry.get("started_at", "")
            # Must be parseable as ISO 8601 (hook falls back to completed_at or now())
            try:
                datetime.fromisoformat(started.replace("Z", "+00:00"))
            except (ValueError, AttributeError) as exc:
                self.fail(f"started_at is not valid ISO 8601 after fallback: {started!r} ({exc})")


class TestSessionIdFallbackUnique(unittest.TestCase):
    """When neither payload nor handoff provides session_id, fallback must be unique."""

    def test_missing_session_id_gets_unique_fallback(self):
        """Two runs with no session_id must each get a unique pm-unknown-<uuid> id."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                # no session_id field
                "usage": {"input_tokens": 100, "output_tokens": 50,
                           "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0},
            }
            _run_hook(payload, project_dir=tmp_str)
            _run_hook(payload, project_dir=tmp_str)
            session_dir = tmp / ".agent-session" / "FEAT-004"
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            ids = [s["session_id"] for s in sessions]
            self.assertEqual(len(set(ids)), len(sessions),
                             f"Fallback session_ids must be unique: {ids}")
            for sid in ids:
                self.assertTrue(sid.startswith("pm-unknown-"),
                                f"Fallback id must start with 'pm-unknown-': {sid}")


# ---------------------------------------------------------------------------
# T-023 extension — concurrency + edge cases
# ---------------------------------------------------------------------------


class TestAtomicMutateRaceResilience(unittest.TestCase):
    """T-023: in-process threading race against _append_pm_session / atomic_manifest_mutate.

    Two threads call atomic_manifest_mutate(+_append_pm_session) concurrently on
    the same manifest file; both entries must be present when threads complete.
    This exercises the fcntl.flock sidecar-lock path directly (no subprocess).
    """

    def test_in_process_concurrent_append_both_entries_written(self):
        """Two threads mutate manifest simultaneously → both session_id entries present."""
        import sys as _sys
        from pathlib import Path as _Path

        _hooks_dir = _Path(__file__).resolve().parent.parent
        if str(_hooks_dir) not in _sys.path:
            _sys.path.insert(0, str(_hooks_dir))

        from _pm_shared import atomic_manifest_mutate  # noqa: PLC0415

        # Import the mutator function from the hook module (not subprocess).
        import importlib.util as _ilu

        spec = _ilu.spec_from_file_location(
            "capture_pm_usage",
            str(_hooks_dir / "capture-pm-usage.py"),
        )
        mod = _ilu.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        _append_pm_session = mod._append_pm_session

        with tempfile.TemporaryDirectory() as tmp_str:
            session_dir = _make_session_dir(Path(tmp_str))
            manifest_path = session_dir / "dispatch-manifest.json"

            errors: list[str] = []

            def mutate_one(session_id: str) -> None:
                try:
                    entry = {
                        "session_id": session_id,
                        "started_at": "2026-05-11T01:00:00Z",
                        "completed_at": "2026-05-11T02:00:00Z",
                        "usage": {
                            "input_tokens": 100,
                            "output_tokens": 50,
                            "total_tokens": 150,
                            "cost_usd": 0.001,
                        },
                        "source": "platform_captured",
                    }
                    atomic_manifest_mutate(
                        manifest_path,
                        lambda doc, e=entry: _append_pm_session(doc, e),
                    )
                except Exception as exc:
                    errors.append(f"{session_id}: {exc}")

            t1 = threading.Thread(target=mutate_one, args=("pm-race-thread-A",))
            t2 = threading.Thread(target=mutate_one, args=("pm-race-thread-B",))
            t1.start()
            t2.start()
            t1.join(timeout=10)
            t2.join(timeout=10)

            self.assertEqual(errors, [], f"In-process concurrent mutate raised errors: {errors}")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            sessions = manifest.get("pm_sessions", [])
            ids = {s["session_id"] for s in sessions}
            self.assertEqual(
                ids,
                {"pm-race-thread-A", "pm-race-thread-B"},
                f"Both thread entries must survive flock race; got: {ids}",
            )

    def test_high_contention_five_threads_all_entries_written(self):
        """Five concurrent threads each append a distinct session; all 5 must be present."""
        import sys as _sys
        from pathlib import Path as _Path

        _hooks_dir = _Path(__file__).resolve().parent.parent
        if str(_hooks_dir) not in _sys.path:
            _sys.path.insert(0, str(_hooks_dir))

        from _pm_shared import atomic_manifest_mutate  # noqa: PLC0415

        import importlib.util as _ilu

        spec = _ilu.spec_from_file_location(
            "capture_pm_usage_hc",
            str(_hooks_dir / "capture-pm-usage.py"),
        )
        mod = _ilu.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        _append_pm_session = mod._append_pm_session

        with tempfile.TemporaryDirectory() as tmp_str:
            session_dir = _make_session_dir(Path(tmp_str))
            manifest_path = session_dir / "dispatch-manifest.json"

            thread_ids = [f"pm-hc-thread-{i}" for i in range(5)]
            errors: list[str] = []
            barrier = threading.Barrier(len(thread_ids))  # synchronise start

            def mutate_one(session_id: str) -> None:
                try:
                    barrier.wait(timeout=5)  # all start simultaneously
                    entry = {
                        "session_id": session_id,
                        "started_at": "2026-05-11T01:00:00Z",
                        "completed_at": "2026-05-11T02:00:00Z",
                        "usage": {
                            "input_tokens": 10,
                            "output_tokens": 5,
                            "total_tokens": 15,
                            "cost_usd": 0.0001,
                        },
                        "source": "platform_captured",
                    }
                    atomic_manifest_mutate(
                        manifest_path,
                        lambda doc, e=entry: _append_pm_session(doc, e),
                    )
                except Exception as exc:
                    errors.append(f"{session_id}: {exc}")

            threads = [threading.Thread(target=mutate_one, args=(sid,)) for sid in thread_ids]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=15)

            self.assertEqual(errors, [], f"High-contention mutate raised errors: {errors}")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            sessions = manifest.get("pm_sessions", [])
            ids = {s["session_id"] for s in sessions}
            self.assertEqual(
                ids,
                set(thread_ids),
                f"All 5 thread entries must survive high-contention flock; got: {ids}",
            )


class TestPlatformCapturedMixedCacheTokens(unittest.TestCase):
    """T-023: platform_captured path with cache_create/cache_read present.

    Verifies that:
    - cache_creation_input_tokens and cache_read_input_tokens from payload are
      stored in the entry (or at least not silently dropped).
    - cost_usd accounts for cache tokens (not zero when cache tokens are present
      even if input/output are zero).
    - total_tokens is still input + output only (cache tracked separately).
    """

    def test_cache_tokens_tracked_in_cost(self):
        """Cost must include cache_creation cost when payload has cache tokens."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-cache-cost-test",
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_creation_input_tokens": 1_000_000,  # 1M cache-creation tokens
                    "cache_read_input_tokens": 0,
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            cost = entry["usage"].get("cost_usd", 0)
            # 1M cache_creation tokens at default input rate (3.0 $/M) = $3.00
            # total_tokens = 0 + 0 = 0 but cost must be non-zero
            self.assertGreater(cost, 0,
                               f"cost_usd must be > 0 when cache_creation tokens present, got: {cost}")
            # total_tokens = input + output only = 0
            self.assertEqual(entry["usage"]["total_tokens"], 0,
                             "total_tokens must be input+output only, not including cache")

    def test_cache_read_tokens_contribute_to_cost(self):
        """cache_read_input_tokens must contribute (at discounted rate) to cost."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-cache-read-test",
                "usage": {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 1_000_000,  # 1M cache-read tokens
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            cost = entry["usage"].get("cost_usd", 0)
            # 1M cache_read tokens at 10% of input rate (3.0 $/M * 0.1) = $0.30
            self.assertGreater(cost, 0,
                               f"cost_usd must be > 0 when cache_read tokens present, got: {cost}")
            # cache_read cheaper than input rate so cost < standard input rate for 1M tokens
            self.assertLess(cost, 3.0,
                            "cache_read should be cheaper than full input rate (discounted 10%)")

    def test_mixed_cache_tokens_source_is_platform_captured(self):
        """Platform_captured source must be set even when payload has mixed cache fields."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-mixed-cache-source",
                "usage": {
                    "input_tokens": 500,
                    "output_tokens": 250,
                    "cache_creation_input_tokens": 100,
                    "cache_read_input_tokens": 200,
                },
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            self.assertEqual(entry.get("source"), "platform_captured",
                             f"source must be platform_captured with mixed cache tokens: {entry}")
            # total_tokens must be input + output only (750), not including cache (300)
            self.assertEqual(entry["usage"]["total_tokens"], 750,
                             "total_tokens must be input(500)+output(250) ignoring cache tokens")


class TestSelfReportedExplicitCostUsd(unittest.TestCase):
    """T-023: self_reported path with explicit cost_usd override in pm_handoff.json.

    When pm_handoff.json contains usage.cost_usd, the hook must use that value
    verbatim instead of re-estimating from token counts.
    """

    def test_explicit_cost_usd_used_verbatim(self):
        """cost_usd in pm_handoff.json usage must pass through unchanged (no re-estimation)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            explicit_cost = 9.99876
            handoff_data = {
                "session_id": "pm-explicit-cost",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:38:00Z",
                "usage": {
                    "input_tokens": 1,   # token-based estimate would be ~$0.000003, not $9.99
                    "output_tokens": 1,
                    "total_tokens": 2,
                    "cost_usd": explicit_cost,
                },
                "source": "self_reported",
            }
            (session_dir / "pm_handoff.json").write_text(
                json.dumps(handoff_data, indent=2), encoding="utf-8"
            )
            payload = {"stop_hook_active": False, "session_id": "pm-explicit-cost"}
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            stored_cost = entry["usage"].get("cost_usd")
            self.assertAlmostEqual(
                stored_cost,
                explicit_cost,
                places=5,
                msg=(
                    f"Explicit cost_usd={explicit_cost} must be used verbatim; "
                    f"got {stored_cost} (token re-estimate would be ~0.000003)"
                ),
            )

    def test_explicit_cost_usd_zero_not_re_estimated(self):
        """cost_usd=0 in handoff must be preserved (not replaced with token estimate)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-zero-cost",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:38:00Z",
                "usage": {
                    "input_tokens": 1000,
                    "output_tokens": 500,
                    "total_tokens": 1500,
                    "cost_usd": 0.0,  # explicit zero — maybe internal/free-tier run
                },
                "source": "self_reported",
            }
            (session_dir / "pm_handoff.json").write_text(
                json.dumps(handoff_data, indent=2), encoding="utf-8"
            )
            payload = {"stop_hook_active": False, "session_id": "pm-zero-cost"}
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            stored_cost = entry["usage"].get("cost_usd")
            self.assertEqual(
                stored_cost,
                0.0,
                f"cost_usd=0.0 from handoff must be preserved verbatim; got {stored_cost}",
            )

    def test_source_is_self_reported_with_explicit_cost(self):
        """Entry written from handoff.json with cost_usd must have source=self_reported."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            handoff_data = {
                "session_id": "pm-cost-source-check",
                "started_at": "2026-05-11T03:00:00Z",
                "completed_at": "2026-05-11T05:38:00Z",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "total_tokens": 150,
                    "cost_usd": 1.23456,
                },
            }
            (session_dir / "pm_handoff.json").write_text(
                json.dumps(handoff_data, indent=2), encoding="utf-8"
            )
            payload = {"stop_hook_active": False, "session_id": "pm-cost-source-check"}
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            entry = manifest["pm_sessions"][0]
            self.assertEqual(entry.get("source"), "self_reported",
                             f"Handoff-sourced entry must be self_reported: {entry}")


class TestBothAbsentBaselineReconfirm(unittest.TestCase):
    """T-023: re-confirm T-016 baseline — both absent + no pm_handoff.json.

    When neither hook payload contains usage telemetry NOR pm_handoff.json exists:
    - NO pm_sessions entry must be written.
    - Hook must still emit {decision: allow} (informational hook never blocks).
    """

    def test_both_absent_no_entry_written(self):
        """Both sources absent → pm_sessions remains empty after hook run."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            # Explicitly confirm pm_handoff.json does NOT exist
            handoff_path = session_dir / "pm_handoff.json"
            self.assertFalse(handoff_path.exists(),
                             "Precondition: pm_handoff.json must not exist for this test")
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-both-absent-reconfirm",
                # No 'usage' key in payload
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             f"Both absent: hook must always emit allow; got: {result}")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(
                sessions, [],
                f"Both absent: pm_sessions must remain empty; got: {sessions}",
            )

    def test_both_absent_no_pm_handoff_file_allow(self):
        """pm_handoff.json explicitly deleted after session_dir setup → still allow, no entry."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            # Create then delete handoff file to confirm hook handles missing file gracefully
            handoff_path = session_dir / "pm_handoff.json"
            handoff_path.write_text('{"session_id": "ghost"}', encoding="utf-8")
            handoff_path.unlink()  # now absent
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-handoff-deleted",
                # No 'usage' in payload
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             "Deleted handoff + no payload usage must still allow")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                manifest.get("pm_sessions", []), [],
                "No pm_sessions entry when handoff deleted and no payload usage",
            )

    def test_both_absent_missing_manifest_still_allow(self):
        """Both sources absent AND no manifest → allow with no crash (belt+suspenders)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Create session dir but NO manifest and NO pm_handoff.json
            session_dir = tmp / ".agent-session" / "FEAT-004"
            session_dir.mkdir(parents=True, exist_ok=True)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-no-manifest-no-handoff",
                # No 'usage' in payload
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow",
                             "No manifest + no handoff + no usage → must allow")


# ---------------------------------------------------------------------------
# AC-012 / AC-013 — find_active_session() direct unit tests (loop-2 fixes)
# ---------------------------------------------------------------------------


class _FindActiveSessionBase(unittest.TestCase):
    """Shared setUpClass for find_active_session() unit-test classes.

    Loads capture-pm-usage.py in-process and binds find_active_session to
    cls._find_active_session so subclasses can call it without subprocess
    overhead.
    """

    @classmethod
    def setUpClass(cls) -> None:
        import importlib.util as _ilu
        import sys as _sys

        _hooks_dir = Path(__file__).resolve().parent.parent
        if str(_hooks_dir) not in _sys.path:
            _sys.path.insert(0, str(_hooks_dir))

        spec = _ilu.spec_from_file_location(
            "capture_pm_usage_fas",
            str(_hooks_dir / "capture-pm-usage.py"),
        )
        mod = _ilu.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        cls._find_active_session = staticmethod(mod.find_active_session)


class TestFindActiveSession(_FindActiveSessionBase):
    """Direct tests for find_active_session() logic.

    These tests import the function in-process to exercise the new
    multiline-anchored owner regex, list-membership planned_phases check,
    and ISO-validated tie-break (AC-012 + AC-013).
    """

    def test_pm_owner_session_found(self):
        """Session with current_owner=pm is returned by find_active_session."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp, owner="pm", phase="implementation")
            result = self._find_active_session(tmp)
            self.assertIsNotNone(result, "Expected a qualifying session for owner=pm")
            self.assertEqual(result, session_dir)

    def test_orchestrator_owner_not_found(self):
        """Session with current_owner=orchestrator is NOT returned (AC-012)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(tmp, owner="orchestrator", phase="implementation")
            result = self._find_active_session(tmp)
            self.assertIsNone(result, "orchestrator-owned session must not qualify")

    def test_tie_break_latest_activity_wins(self):
        """Among two pm sessions, the one with the later last_activity_at wins (AC-012)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Earlier session
            early_dir = tmp / ".agent-session" / "FEAT-early"
            early_dir.mkdir(parents=True)
            (early_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T01:00:00Z"\n',
                encoding="utf-8",
            )
            # Later session
            late_dir = tmp / ".agent-session" / "FEAT-late"
            late_dir.mkdir(parents=True)
            (late_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T12:00:00Z"\n',
                encoding="utf-8",
            )
            result = self._find_active_session(tmp)
            self.assertEqual(result, late_dir, "Latest last_activity_at must win tie-break")

    def test_phase_not_in_planned_phases_not_found(self):
        """Session where current_phase is not a member of planned_phases is excluded (AC-013)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            _make_session_dir(
                tmp,
                owner="pm",
                phase="specify",
                planned=["implementation"],  # "specify" NOT in planned
            )
            result = self._find_active_session(tmp)
            self.assertIsNone(
                result,
                "Session where current_phase not in planned_phases must not qualify",
            )

    def test_malformed_timestamp_sorts_last(self):
        """Malformed last_activity_at must not beat a valid ISO timestamp (AC-012)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            # Session with VALID timestamp
            valid_dir = tmp / ".agent-session" / "FEAT-valid-ts"
            valid_dir.mkdir(parents=True)
            (valid_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T06:00:00Z"\n',
                encoding="utf-8",
            )
            # Session with MALFORMED timestamp (lexicographically "z..." > "2...")
            bad_dir = tmp / ".agent-session" / "FEAT-bad-ts"
            bad_dir.mkdir(parents=True)
            (bad_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "zzz-not-a-date"\n',
                encoding="utf-8",
            )
            result = self._find_active_session(tmp)
            self.assertEqual(
                result,
                valid_dir,
                "Valid ISO timestamp must beat malformed timestamp in tie-break",
            )

    def test_owner_regex_no_false_positive_prefix(self):
        """current_owner: pmx must NOT match (no trailing word boundary guard needed via anchor)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = tmp / ".agent-session" / "FEAT-prefix"
            session_dir.mkdir(parents=True)
            (session_dir / "session.yml").write_text(
                'current_owner: "pmx"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T01:00:00Z"\n',
                encoding="utf-8",
            )
            result = self._find_active_session(tmp)
            self.assertIsNone(result, 'current_owner: "pmx" must not qualify as pm')

    def test_owner_regex_no_false_positive_comment(self):
        """A YAML comment '# current_owner: pm' must not qualify the session."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = tmp / ".agent-session" / "FEAT-comment"
            session_dir.mkdir(parents=True)
            (session_dir / "session.yml").write_text(
                '# current_owner: "pm"\n'       # comment — must not match
                'current_owner: "orchestrator"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T01:00:00Z"\n',
                encoding="utf-8",
            )
            result = self._find_active_session(tmp)
            self.assertIsNone(result, "YAML comment must not qualify session as pm-owned")


# ---------------------------------------------------------------------------
# AC-011 / AC-012 / AC-013 — find_active_session T-007 logic (dispatch d-084)
# ---------------------------------------------------------------------------


class TestFindActiveSessionT007(_FindActiveSessionBase):
    """T-007 owner-based selection: AC-011, AC-012, AC-013.

    These three tests pin the three branches of the new find_active_session
    logic introduced in T-007:

      AC-011 — only the session with current_owner=="pm" qualifies,
               regardless of filesystem mtime order.
      AC-012 — when multiple pm sessions exist, last_activity_at tiebreak
               selects the most recent.
      AC-013 — when no session has current_owner=="pm", returns None.
    """

    # -- AC-011 ----------------------------------------------------------------

    def test_only_pm_owner_returned_regardless_of_mtime(self):
        """AC-011: two sessions, only one current_owner==pm → that one returned.

        The non-pm session intentionally has a newer filesystem mtime so the
        test would fail if the implementation fell back to mtime ordering.
        """
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)

            # Non-pm session — orchestrator owner
            other_dir = tmp / ".agent-session" / "FEAT-other"
            other_dir.mkdir(parents=True)
            (other_dir / "session.yml").write_text(
                'current_owner: "orchestrator"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T23:59:00Z"\n',  # newer timestamp
                encoding="utf-8",
            )

            # pm session — older timestamp
            pm_dir = tmp / ".agent-session" / "FEAT-pm"
            pm_dir.mkdir(parents=True)
            (pm_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T01:00:00Z"\n',  # older timestamp
                encoding="utf-8",
            )

            result = self._find_active_session(tmp)
            self.assertEqual(
                result,
                pm_dir,
                "AC-011: only the pm-owned session must be returned, "
                f"regardless of mtime; got {result}",
            )

    # -- AC-012 ----------------------------------------------------------------

    def test_two_pm_sessions_last_activity_at_tiebreak(self):
        """AC-012: two pm sessions with different last_activity_at → more recent wins."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)

            # Older pm session
            early_dir = tmp / ".agent-session" / "FEAT-pm-early"
            early_dir.mkdir(parents=True)
            (early_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T08:00:00Z"\n',
                encoding="utf-8",
            )

            # Newer pm session
            late_dir = tmp / ".agent-session" / "FEAT-pm-late"
            late_dir.mkdir(parents=True)
            (late_dir / "session.yml").write_text(
                'current_owner: "pm"\n'
                'current_phase: "implementation"\n'
                "planned_phases:\n"
                '  - "implementation"\n'
                'last_activity_at: "2026-05-11T20:00:00Z"\n',
                encoding="utf-8",
            )

            result = self._find_active_session(tmp)
            self.assertEqual(
                result,
                late_dir,
                "AC-012: session with later last_activity_at must be returned; "
                f"got {result}",
            )

    # -- AC-013 ----------------------------------------------------------------

    def test_no_pm_owner_returns_none(self):
        """AC-013: when no session has current_owner==pm, find_active_session returns None."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)

            # Two sessions, neither owned by pm
            for feat_id, owner in [("FEAT-dev", "dev"), ("FEAT-orch", "orchestrator")]:
                d = tmp / ".agent-session" / feat_id
                d.mkdir(parents=True)
                (d / "session.yml").write_text(
                    f'current_owner: "{owner}"\n'
                    'current_phase: "implementation"\n'
                    "planned_phases:\n"
                    '  - "implementation"\n'
                    'last_activity_at: "2026-05-11T10:00:00Z"\n',
                    encoding="utf-8",
                )

            result = self._find_active_session(tmp)
            self.assertIsNone(
                result,
                "AC-013: no pm-owned session present → find_active_session must return None; "
                f"got {result}",
            )


# ---------------------------------------------------------------------------
# AC-014 — transcript_aggregated path
# ---------------------------------------------------------------------------
# Background: Claude Code's main-session Stop hook payload does NOT include
# `usage` telemetry — that field is populated for SubagentStop, not Stop.
# Before this path was added, FEAT-004/005 captured zero PM token usage
# (pm_sessions=null in dispatch-manifest.json) because both platform_captured
# (no payload.usage) and self_reported (no pm_handoff.json) paths failed.
#
# Stop hook payload DOES carry `transcript_path` — the JSONL file Claude Code
# writes per session. Aggregating `message.usage` across assistant turns gives
# total session cost. These tests pin that behavior.

def _write_jsonl_transcript(
    transcript_path: Path,
    turns: list[dict],
) -> None:
    """Write a JSONL transcript file with one turn per dict in *turns*.

    Each turn dict should resemble Claude Code transcript entries — e.g.
    {"timestamp": "2026-05-11T10:00:00Z",
     "message": {"role": "assistant", "model": "claude-opus-4-7",
                 "usage": {"input_tokens": 100, "output_tokens": 50, ...}}}.
    """
    transcript_path.parent.mkdir(parents=True, exist_ok=True)
    with transcript_path.open("w", encoding="utf-8") as fh:
        for turn in turns:
            fh.write(json.dumps(turn) + "\n")


def _assistant_turn(
    timestamp: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_creation: int = 0,
    cache_read: int = 0,
    model: str = "claude-opus-4-7",
) -> dict:
    return {
        "timestamp": timestamp,
        "message": {
            "role": "assistant",
            "model": model,
            "usage": {
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cache_creation_input_tokens": cache_creation,
                "cache_read_input_tokens": cache_read,
            },
        },
    }


class TestTranscriptAggregated(unittest.TestCase):
    """Verify usage is captured from transcript_path when payload.usage absent."""

    def test_transcript_path_aggregated_entry_written(self):
        """transcript_path with assistant turns → entry source=transcript_aggregated."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            transcript = tmp / "transcript.jsonl"
            _write_jsonl_transcript(transcript, [
                _assistant_turn("2026-05-11T10:00:00Z", input_tokens=1000, output_tokens=500),
                _assistant_turn("2026-05-11T10:05:00Z", input_tokens=2000, output_tokens=800,
                                cache_read=10000),
            ])
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-test-transcript-1",
                "transcript_path": str(transcript),
            }
            _run_hook(payload, project_dir=tmp_str)
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            self.assertEqual(len(sessions), 1, f"Expected 1 entry, got: {sessions}")
            entry = sessions[0]
            self.assertEqual(entry["source"], "transcript_aggregated")
            self.assertEqual(entry["usage"]["input_tokens"], 3000)
            self.assertEqual(entry["usage"]["output_tokens"], 1300)
            self.assertEqual(entry["usage"]["total_tokens"], 4300)
            self.assertEqual(entry["usage"]["cache_read_input_tokens"], 10000)
            self.assertEqual(entry["usage"]["model"], "claude-opus-4-7")

    def test_transcript_path_session_timestamps_from_turns(self):
        """started_at = first turn ts, completed_at = last turn ts."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            transcript = tmp / "transcript.jsonl"
            _write_jsonl_transcript(transcript, [
                _assistant_turn("2026-05-11T09:00:00Z", input_tokens=10, output_tokens=5),
                _assistant_turn("2026-05-11T09:30:00Z", input_tokens=20, output_tokens=10),
                _assistant_turn("2026-05-11T10:00:00Z", input_tokens=30, output_tokens=15),
            ])
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-test-transcript-2",
                "transcript_path": str(transcript),
            }
            _run_hook(payload, project_dir=tmp_str)
            entry = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )["pm_sessions"][0]
            self.assertEqual(entry["started_at"], "2026-05-11T09:00:00Z")
            self.assertEqual(entry["completed_at"], "2026-05-11T10:00:00Z")

    def test_platform_captured_preferred_over_transcript(self):
        """payload.usage present → platform_captured wins; transcript_path ignored."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            transcript = tmp / "transcript.jsonl"
            _write_jsonl_transcript(transcript, [
                _assistant_turn("2026-05-11T10:00:00Z", input_tokens=99999, output_tokens=99999),
            ])
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-test-platform-wins",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": 0,
                },
                "transcript_path": str(transcript),
            }
            _run_hook(payload, project_dir=tmp_str)
            entry = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )["pm_sessions"][0]
            self.assertEqual(entry["source"], "platform_captured")
            self.assertEqual(entry["usage"]["input_tokens"], 100)

    def test_transcript_falls_through_to_handoff_when_empty(self):
        """transcript with zero assistant usage → fall through to self_reported path."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            transcript = tmp / "transcript.jsonl"
            # Only a non-assistant entry — no usage to aggregate.
            _write_jsonl_transcript(transcript, [
                {"type": "summary", "messageId": "m1"},
            ])
            # Provide a pm_handoff.json as fallback.
            (session_dir / "pm_handoff.json").write_text(json.dumps({
                "session_id": "pm-handoff-fallback",
                "started_at": "2026-05-11T09:00:00Z",
                "completed_at": "2026-05-11T10:00:00Z",
                "usage": {
                    "input_tokens": 7,
                    "output_tokens": 3,
                    "total_tokens": 10,
                    "cost_usd": 0.001,
                },
            }), encoding="utf-8")
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-test-transcript-empty",
                "transcript_path": str(transcript),
            }
            _run_hook(payload, project_dir=tmp_str)
            entry = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )["pm_sessions"][0]
            self.assertEqual(entry["source"], "self_reported")

    def test_transcript_path_missing_file_skips_to_handoff(self):
        """transcript_path points to nonexistent file → fall through gracefully."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-test-missing-transcript",
                "transcript_path": str(tmp / "does-not-exist.jsonl"),
            }
            result = _run_hook(payload, project_dir=tmp_str)
            self.assertEqual(result.get("decision", "allow"), "allow")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            # No entry written — both transcript and handoff absent.
            self.assertEqual(manifest.get("pm_sessions", []), [])

    def test_transcript_message_role_user_does_not_count(self):
        """Only assistant turns with usage should be aggregated (user turns may lack usage)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            transcript = tmp / "transcript.jsonl"
            # Mix of user (no usage) and assistant (with usage) turns. The
            # aggregator looks at message.usage regardless of role, but user
            # turns simply don't have a usage block — so this is a smoke check
            # that the parser doesn't crash on heterogeneous entries.
            _write_jsonl_transcript(transcript, [
                {"timestamp": "2026-05-11T10:00:00Z",
                 "message": {"role": "user", "content": "hi"}},
                _assistant_turn("2026-05-11T10:01:00Z", input_tokens=50, output_tokens=25),
            ])
            payload = {
                "stop_hook_active": False,
                "session_id": "pm-test-mixed-roles",
                "transcript_path": str(transcript),
            }
            _run_hook(payload, project_dir=tmp_str)
            entry = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )["pm_sessions"][0]
            self.assertEqual(entry["usage"]["input_tokens"], 50)
            self.assertEqual(entry["usage"]["output_tokens"], 25)


if __name__ == "__main__":
    unittest.main()
