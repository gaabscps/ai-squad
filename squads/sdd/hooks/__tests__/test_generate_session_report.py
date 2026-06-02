import importlib.util
import json
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("generate_session_report", str(_HOOKS / "generate-session-report.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def _seed(sd):
    (sd / "costs").mkdir(parents=True)
    (sd / "costs" / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 1.0, "agent_id": "a", "unpriced_models": []}))


def test_writes_report_html_when_pipeline_active(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    rc = mod.generate(sd, diff_provider=lambda files: "")
    assert rc == 0
    out = sd / "report.html"
    assert out.exists()
    assert "FEAT-001" in out.read_text()


def test_skips_when_no_costs(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-002"
    sd.mkdir(parents=True)
    rc = mod.generate(sd, diff_provider=lambda files: "")
    assert rc == 0
    assert not (sd / "report.html").exists()  # guard: no pipeline -> no report


def _load_gen_hook():
    import importlib.util
    p = Path(__file__).resolve().parents[1] / "generate-session-report.py"
    spec = importlib.util.spec_from_file_location("generate_session_report", str(p))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_generate_emits_cost_report_json_when_costs_present(tmp_path):
    session_dir = tmp_path / "FEAT-101"
    costs = session_dir / "costs"
    costs.mkdir(parents=True)
    (costs / "session-s1.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 4.0, "unpriced_models": []},
        "orchestration": {"total_cost_usd": 1.0, "unpriced_models": []},
    }))
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "agent_id": "a", "unpriced_models": []}))

    gen = _load_gen_hook()
    gen.generate(session_dir, diff_provider=lambda files: "")

    out = session_dir / "cost-report.json"
    assert out.is_file()
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["spec_id"] == "FEAT-101"


def test_generate_writes_no_cost_report_json_when_no_costs(tmp_path):
    session_dir = tmp_path / "FEAT-102"
    session_dir.mkdir()

    gen = _load_gen_hook()
    gen.generate(session_dir, diff_provider=lambda files: "")

    assert not (session_dir / "cost-report.json").exists()
