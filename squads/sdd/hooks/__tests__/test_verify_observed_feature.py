import importlib.util
import io
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "verify_observed_feature", str(_LIB / "verify-observed-feature.py"))
vof = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vof)

BASE = (
    "schema_version: 1\nsession_id: OBS-001\nmode: observed\n"
    'intent: "x"\nstatus: in_progress\ncreated_at: 2026-07-06T00:00:00Z\n'
)


def _run(tmp_path, yaml_text, monkeypatch, capsys):
    spec = tmp_path / ".agent-session" / "OBS-001"
    spec.mkdir(parents=True)
    target = spec / "session.yml"
    target.write_text(yaml_text, encoding="utf-8")
    payload = {
        "tool_input": {"file_path": str(target)},
        "cwd": str(tmp_path),
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    rc = vof.main()
    out = capsys.readouterr().out.strip()
    return rc, (json.loads(out) if out else None)


def test_bloco_valido_passa(tmp_path, monkeypatch, capsys):
    rc, out = _run(tmp_path, BASE + 'feature:\n  id: PAY-1\n  key: PAY-1\n  name: "Export"\n', monkeypatch, capsys)
    assert rc == 0
    assert out is None


def test_sem_feature_bloqueia(tmp_path, monkeypatch, capsys):
    rc, out = _run(tmp_path, BASE, monkeypatch, capsys)
    assert rc == 0
    assert out["decision"] == "block"
    assert "feature" in out["reason"]


def test_key_torta_bloqueia(tmp_path, monkeypatch, capsys):
    rc, out = _run(tmp_path, BASE + 'feature:\n  id: pay1\n  key: pay-1x\n  name: "X"\n', monkeypatch, capsys)
    assert rc == 0
    assert out["decision"] == "block"


def test_yaml_nao_observado_ignora(tmp_path, monkeypatch, capsys):
    rc, out = _run(tmp_path, "spec_id: FEAT-001\nschema_version: 1\ncurrent_phase: specify\nplanned_phases: []\n", monkeypatch, capsys)
    assert rc == 0
    assert out is None


def test_arquivo_fora_de_agent_session_ignora(tmp_path, monkeypatch, capsys):
    other = tmp_path / "session.yml"
    other.write_text(BASE, encoding="utf-8")
    payload = {"tool_input": {"file_path": str(other)}, "cwd": str(tmp_path)}
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    assert vof.main() == 0
    assert capsys.readouterr().out.strip() == ""
