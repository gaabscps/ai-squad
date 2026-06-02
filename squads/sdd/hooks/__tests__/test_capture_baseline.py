import importlib.util
import io
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "capture_baseline", str(_LIB / "capture-baseline.py"))
cb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cb)


def _wire(monkeypatch, skill, repo_root, dirty, session_id="SESS-1"):
    monkeypatch.setattr(cb, "detect_active_skill", lambda p: skill)
    monkeypatch.setattr(cb, "resolve_project_root", lambda p: repo_root)
    monkeypatch.setattr(cb.audit_baseline, "dirty_paths", lambda p: dirty)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"session_id": session_id})))


def test_captures_baseline_on_first_orchestrator_dispatch(tmp_path, monkeypatch):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "orchestrator", tmp_path, dirty=[".gitignore", "README.md"])
    assert cb.main() == 0
    data = json.loads((sd / "audit-baseline.json").read_text())
    assert data["dirty_paths"] == [".gitignore", "README.md"]
    assert data["captured_at_session"] == "SESS-1"


def test_idempotent_does_not_overwrite_existing_baseline(tmp_path, monkeypatch):
    # --resume / --restart must REUSE the original baseline, never recapture
    # (recapturing would absorb the prior run's edits as pre-existing).
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    (sd / "audit-baseline.json").write_text('{"schema_version": 1, "dirty_paths": ["original"]}')
    _wire(monkeypatch, "orchestrator", tmp_path, dirty=["something-else"])
    assert cb.main() == 0
    data = json.loads((sd / "audit-baseline.json").read_text())
    assert data["dirty_paths"] == ["original"]   # untouched


def test_skips_when_not_orchestrator(tmp_path, monkeypatch):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "dev", tmp_path, dirty=["x"])
    assert cb.main() == 0
    assert not (sd / "audit-baseline.json").exists()


def test_skips_when_no_session(tmp_path, monkeypatch):
    _wire(monkeypatch, "orchestrator", tmp_path, dirty=["x"])   # no .agent-session/
    assert cb.main() == 0   # no crash, nothing written
