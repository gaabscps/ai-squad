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

    mod.generate(session_dir, diff_provider=lambda files: "")

    out = session_dir / "cost-report.json"
    assert out.is_file()
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["spec_id"] == "FEAT-101"


def test_generate_writes_no_cost_report_json_when_no_costs(tmp_path):
    session_dir = tmp_path / "FEAT-102"
    session_dir.mkdir()

    mod.generate(session_dir, diff_provider=lambda files: "")

    assert not (session_dir / "cost-report.json").exists()


def test_main_routes_cost_report_to_owner_after_close(tmp_path, monkeypatch):
    """
    Bug: the final Stop of a closed observed contract writes costs/session-*.json
    to the owner dir (via resolve_capture_session), but generate-session-report
    was routing via find_active_session (mtime-newest), landing cost-report.json
    on a different sibling. The owner's cost-report.json was permanently stale.

    Fix: main() must use the same ownership routing as capture-session-cost.
    """
    import io
    import os

    # Owner: closed observed contract that adopted chat session "S1".
    owner = tmp_path / ".agent-session" / "FEAT-OBS-1"
    owner_costs = owner / "costs"
    owner_costs.mkdir(parents=True)
    (owner / "session.yml").write_text(
        'mode: observed\nstatus: done\nobserved_sessions:\n  - "S1"\n',
        encoding="utf-8",
    )
    (owner_costs / "session-S1.json").write_text(
        json.dumps({
            "scope": "session",
            "session_id": "S1",
            "planning": {"total_cost_usd": 3.0, "unpriced_models": []},
            "orchestration": {"total_cost_usd": 0.0, "unpriced_models": []},
        }),
        encoding="utf-8",
    )

    # Newer sibling: pipeline session with higher mtime — the wrong route.
    newer = tmp_path / ".agent-session" / "FEAT-002"
    newer_costs = newer / "costs"
    newer_costs.mkdir(parents=True)
    (newer / "session.yml").write_text("status: active\n", encoding="utf-8")
    (newer_costs / "session-S2.json").write_text(
        json.dumps({
            "scope": "session",
            "planning": {"total_cost_usd": 1.0, "unpriced_models": []},
            "orchestration": {"total_cost_usd": 0.0, "unpriced_models": []},
        }),
        encoding="utf-8",
    )

    # Owner gets an older mtime so find_active_session would pick the sibling.
    old_mtime = newer.stat().st_mtime - 100
    os.utime(owner, (old_mtime, old_mtime))

    monkeypatch.setattr(
        "sys.stdin",
        io.StringIO(json.dumps({"session_id": "S1", "cwd": str(tmp_path)})),
    )

    rc = mod.main()
    assert rc == 0

    # Owner dir must receive cost-report.json (it owns session S1).
    owner_report = owner / "cost-report.json"
    assert owner_report.exists(), "cost-report.json must land in the owner dir, not the mtime-newest sibling"
    written = json.loads(owner_report.read_text(encoding="utf-8"))
    assert written["spec_id"] == "FEAT-OBS-1"

    # Newer sibling must not get a cost-report.json for S1's Stop.
    assert not (newer / "cost-report.json").exists()
