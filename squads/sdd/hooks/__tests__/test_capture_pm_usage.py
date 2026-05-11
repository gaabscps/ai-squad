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


def _make_session_dir(tmp: Path, feature_id: str = "FEAT-004") -> Path:
    """Create .agent-session/<feature_id>/ with a minimal manifest."""
    session_dir = tmp / ".agent-session" / feature_id
    session_dir.mkdir(parents=True, exist_ok=True)
    manifest = _make_minimal_manifest()
    (session_dir / "dispatch-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
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

class TestAtomicWrite(unittest.TestCase):
    """Concurrent hook invocations must not corrupt the manifest."""

    def test_concurrent_writes_both_entries_written(self):
        """Two concurrent hook runs must both append their entries (flock race)."""
        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            session_dir = _make_session_dir(tmp)
            errors: list[str] = []

            def run_one(session_id: str) -> None:
                try:
                    payload = {
                        "stop_hook_active": False,
                        "session_id": session_id,
                        "usage": {"input_tokens": 100, "output_tokens": 50,
                                   "cache_creation_input_tokens": 0,
                                   "cache_read_input_tokens": 0},
                    }
                    _run_hook(payload, project_dir=tmp_str)
                except Exception as exc:
                    errors.append(str(exc))

            t1 = threading.Thread(target=run_one, args=("pm-concurrent-A",))
            t2 = threading.Thread(target=run_one, args=("pm-concurrent-B",))
            t1.start()
            t2.start()
            t1.join(timeout=15)
            t2.join(timeout=15)

            self.assertEqual(errors, [], f"Concurrent run raised errors: {errors}")
            manifest = json.loads(
                (session_dir / "dispatch-manifest.json").read_text(encoding="utf-8")
            )
            sessions = manifest.get("pm_sessions", [])
            ids = {s["session_id"] for s in sessions}
            self.assertEqual(ids, {"pm-concurrent-A", "pm-concurrent-B"},
                             f"Expected both session IDs in manifest, got: {ids}")


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


if __name__ == "__main__":
    unittest.main()
