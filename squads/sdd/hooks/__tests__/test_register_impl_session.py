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


def test_resolve_dispatch_session_requires_session_yml(tmp_path):
    base = tmp_path / ".agent-session"
    (base / "FEAT-001").mkdir(parents=True)
    (base / "FEAT-001" / "session.yml").write_text("id: FEAT-001\n")
    (base / "stray").mkdir()  # no session.yml -> ignored
    # No Work Packet → falls back to newest-mtime session.yml-bearing dir.
    got = ris.resolve_dispatch_session({}, tmp_path)
    assert got is not None and got.name == "FEAT-001"


def test_main_registers_against_spec_id_not_mtime(tmp_path, monkeypatch):
    # The implementation session id must land on the Session the dispatch
    # actually targets (FEAT-002 via its Work Packet), not the mtime-newest
    # sibling (FEAT-001, e.g. just touched by the aiOS observer).
    import os
    a = tmp_path / ".agent-session" / "FEAT-001"
    a.mkdir(parents=True)
    (a / "session.yml").write_text("id: FEAT-001\n")
    b = tmp_path / ".agent-session" / "FEAT-002"
    b.mkdir(parents=True)
    (b / "session.yml").write_text("id: FEAT-002\n")
    os.utime(a, (2_000, 2_000))   # FEAT-001 newest by mtime
    os.utime(b, (1_000, 1_000))
    monkeypatch.setattr(ris, "detect_active_skill", lambda p: "orchestrator")
    monkeypatch.setattr(ris, "resolve_project_root", lambda p: tmp_path)
    payload = {
        "session_id": "SESS-2",
        "tool_input": {"prompt": "WorkPacket:\n```yaml\nspec_id: FEAT-002\n```\n"},
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    assert ris.main() == 0
    assert '- "SESS-2"' in (b / "session.yml").read_text()
    assert "implementation_sessions" not in (a / "session.yml").read_text()


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


def test_main_registers_without_manifest(tmp_path, monkeypatch):
    # At PreToolUse(Task) the dispatch IS the signal a pipeline is running —
    # the manifest may not exist on the first dispatch. Register anyway.
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "orchestrator", tmp_path)
    assert ris.main() == 0
    assert '- "AAA"' in (sd / "session.yml").read_text()
