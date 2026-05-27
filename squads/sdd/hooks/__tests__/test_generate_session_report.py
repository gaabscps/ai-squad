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
