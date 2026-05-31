import importlib.util
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("cost_report", str(_LIB / "cost_report.py"))
cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cr)


def test_aggregates_planning_and_implementation(tmp_path):
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "session-s1.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 4.0, "unpriced_models": []},
        "orchestration": {"total_cost_usd": 1.0, "unpriced_models": []},
    }))
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "agent_id": "a", "unpriced_models": []}))
    (costs / "agent-b.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 3.0, "agent_id": "b", "unpriced_models": []}))

    rep = cr.build_cost_report(tmp_path)
    assert rep["planning_cost_usd"] == 4.0
    assert rep["orchestration_cost_usd"] == 1.0
    assert rep["implementation_cost_usd"] == 5.0
    assert rep["total_cost_usd"] == 10.0
    assert rep["subagent_count"] == 2


def test_flags_unpriced_models(tmp_path):
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 0.0, "agent_id": "a",
        "unpriced_models": ["mystery-model"]}))
    rep = cr.build_cost_report(tmp_path)
    assert "mystery-model" in rep["unpriced_models"]
    assert rep["complete"] is False


def test_markdown_renders(tmp_path):
    (tmp_path / "costs").mkdir()
    rep = cr.build_cost_report(tmp_path)
    md = cr.render_markdown(rep, "FEAT-001")
    assert "FEAT-001" in md
    assert "Total" in md


def test_backfill_creates_missing_cost_files(tmp_path):
    # one subagent transcript on disk, but no cost file yet
    tr = tmp_path / "agent-zzz.jsonl"
    tr.write_text('{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":'
                  '{"id":"q","model":"m","usage":{"input_tokens":10,"output_tokens":0}}}\n')
    prices = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}

    backfilled = cr.backfill_missing(tmp_path, [str(tr)], prices)

    assert backfilled == ["zzz"]
    f = tmp_path / "costs" / "agent-zzz.json"
    assert f.exists()
    data = json.loads(f.read_text())
    assert data["total_cost_usd"] == 10.0
    assert data["backfilled"] is True


def test_empty_costs_is_incomplete(tmp_path):
    # Zero captures must NOT report complete:true (the FEAT-010 bug — a
    # $0/0-subagent report claiming "complete").
    (tmp_path / "costs").mkdir()
    rep = cr.build_cost_report(tmp_path)
    assert rep["subagent_count"] == 0
    assert rep["total_cost_usd"] == 0.0
    assert rep["complete"] is False


def test_complete_true_when_captured_and_priced(tmp_path):
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "agent_id": "a",
        "unpriced_models": []}))
    rep = cr.build_cost_report(tmp_path)
    assert rep["subagent_count"] == 1
    assert rep["complete"] is True


def test_captured_but_unpriced_is_incomplete(tmp_path):
    # Tokens captured but a model lacked a price → tokens present, but report
    # is honestly flagged incomplete (never a silently-low total).
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 0.0, "agent_id": "a",
        "unpriced_models": ["mystery"]}))
    rep = cr.build_cost_report(tmp_path)
    assert rep["subagent_count"] == 1
    assert rep["complete"] is False


def test_backfill_skips_existing(tmp_path):
    (tmp_path / "costs").mkdir()
    (tmp_path / "costs" / "agent-zzz.json").write_text('{"agent_id":"zzz","total_cost_usd":5.0}')
    tr = tmp_path / "agent-zzz.jsonl"
    tr.write_text('{"type":"assistant","message":{"id":"q","model":"m","usage":{"input_tokens":10}}}\n')
    backfilled = cr.backfill_missing(tmp_path, [str(tr)], {"m": {"input_per_mtok": 1.0, "output_per_mtok": 1.0}})
    assert backfilled == []  # already present, untouched
    assert json.loads((tmp_path / "costs" / "agent-zzz.json").read_text())["total_cost_usd"] == 5.0


def _bm(inp, out, cr_, cc):
    return {"m": {"input_tokens": inp, "output_tokens": out,
                  "cache_read_input_tokens": cr_, "cache_creation_input_tokens": cc,
                  "cost_by_type": {"input": float(inp), "output": float(out) * 2,
                                   "cache_read": float(cr_) * 0.10, "cache_creation": float(cc) * 1.25},
                  "cost_usd": inp + out * 2 + cr_ * 0.10 + cc * 1.25, "messages": 1}}


def test_tokens_aggregated_by_phase_and_type(tmp_path):
    costs = tmp_path / "costs"; costs.mkdir()
    # file total_cost_usd derives from by_model cost_usd so reconciliation holds.
    pl, orch, impl = _bm(100, 50, 1000, 80), _bm(200, 60, 2000, 90), _bm(300, 70, 3000, 100)
    (costs / "session-s1.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": pl["m"]["cost_usd"], "unpriced_models": [], "by_model": pl},
        "orchestration": {"total_cost_usd": orch["m"]["cost_usd"], "unpriced_models": [], "by_model": orch},
    }))
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": impl["m"]["cost_usd"], "unpriced_models": [],
        "by_model": impl}))
    rep = cr.build_cost_report(tmp_path)
    tok = rep["tokens"]
    assert tok["by_phase"]["planning"]["input"] == 100
    assert tok["by_type"]["input"] == 600         # 100+200+300
    assert tok["by_type"]["output"] == 180        # 50+60+70
    assert tok["total"] == 600 + 180 + 6000 + 270
    tc = rep["token_cost"]
    assert round(sum(tc["by_type"].values()), 6) == rep["total_cost_usd"]


def test_tokens_fallback_reprice_when_cost_by_type_absent(tmp_path, monkeypatch):
    costs = tmp_path / "costs"; costs.mkdir()
    bm = {"m": {"input_tokens": 10, "output_tokens": 5,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                "cost_usd": 20.0, "messages": 1}}  # no cost_by_type
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 20.0, "unpriced_models": [], "by_model": bm}))
    monkeypatch.setattr(cr, "_load_prices_safe",
                        lambda: {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}})
    rep = cr.build_cost_report(tmp_path)
    assert rep["token_cost"]["by_type"]["input"] == 10.0
    assert rep["token_cost"]["by_type"]["output"] == 10.0


def test_tokens_absent_when_no_by_model(tmp_path):
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "unpriced_models": []}))
    rep = cr.build_cost_report(tmp_path)
    assert rep["tokens"]["total"] == 0
