import importlib.util
import io
import json
import sys
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "register_impl_session", str(_LIB / "register-impl-session.py"))
ris = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ris)


def test_register_creates_field_when_absent(tmp_path):
    sy = tmp_path / "session.yml"
    sy.write_text("id: FEAT-001\ncurrent_phase: implementation\n")
    assert ris.register_session(sy, "AAA") is True
    text = sy.read_text()
    assert "implementation_sessions:" in text
    assert '- "AAA"' in text


def test_register_appends_to_existing_block(tmp_path):
    sy = tmp_path / "session.yml"
    sy.write_text('id: FEAT-001\nimplementation_sessions:\n  - "AAA"\n')
    assert ris.register_session(sy, "BBB") is True
    text = sy.read_text()
    assert '- "AAA"' in text and '- "BBB"' in text


def test_register_is_idempotent(tmp_path):
    sy = tmp_path / "session.yml"
    sy.write_text('id: FEAT-001\nimplementation_sessions:\n  - "AAA"\n')
    assert ris.register_session(sy, "AAA") is False
    assert sy.read_text().count('"AAA"') == 1


def test_register_skips_unknown_or_empty(tmp_path):
    sy = tmp_path / "session.yml"
    sy.write_text("id: FEAT-001\n")
    assert ris.register_session(sy, "unknown") is False
    assert ris.register_session(sy, "") is False
    assert "implementation_sessions" not in sy.read_text()


def test_find_active_session_requires_session_yml(tmp_path):
    base = tmp_path / ".agent-session"
    (base / "FEAT-001").mkdir(parents=True)
    (base / "FEAT-001" / "session.yml").write_text("id: FEAT-001\n")
    (base / "stray").mkdir()  # no session.yml -> ignored
    got = ris.find_active_session(tmp_path)
    assert got is not None and got.name == "FEAT-001"


def _wire(monkeypatch, skill, repo_root, session_id="AAA"):
    monkeypatch.setattr(ris, "detect_active_skill", lambda p: skill)
    monkeypatch.setattr(ris, "resolve_project_root", lambda p: repo_root)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"session_id": session_id})))


def test_main_registers_on_orchestrator_stop(tmp_path, monkeypatch):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    (sd / "dispatch-manifest.json").write_text("{}")
    _wire(monkeypatch, "orchestrator", tmp_path)
    assert ris.main() == 0
    assert '- "AAA"' in (sd / "session.yml").read_text()


def test_main_skips_when_not_orchestrator(tmp_path, monkeypatch):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    (sd / "dispatch-manifest.json").write_text("{}")
    _wire(monkeypatch, "spec-writer", tmp_path)
    assert ris.main() == 0
    assert "implementation_sessions" not in (sd / "session.yml").read_text()


def test_main_skips_without_manifest(tmp_path, monkeypatch):
    # An orchestrator session that dispatched no Phase 4 pipeline has nothing
    # to scope — don't pollute session.yml.
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "orchestrator", tmp_path)
    assert ris.main() == 0
    assert "implementation_sessions" not in (sd / "session.yml").read_text()
