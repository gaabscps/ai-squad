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


def test_backfill_rejects_foreign_session_transcripts(tmp_path):
    # Regression for the $821/2804-agent bug: a wide glob fed backfill_missing
    # transcripts from OTHER projects/sessions. An already-captured cost file
    # pins which subagents dir is ours; anything outside it must be rejected.
    proj = tmp_path / "projects"
    ours = proj / "-repo" / "sess-AAA" / "subagents"
    theirs = proj / "-other" / "sess-BBB" / "subagents"
    ours.mkdir(parents=True)
    theirs.mkdir(parents=True)
    costs = tmp_path / "costs"
    costs.mkdir()
    # a captured agent anchors the session (carries the subagents path)
    (costs / "agent-anchor.json").write_text(json.dumps({
        "agent_id": "anchor", "scope": "implementation", "total_cost_usd": 1.0,
        "transcript_path": str(ours / "agent-anchor.jsonl"), "unpriced_models": []}))
    line = ('{"type":"assistant","message":{"id":"q","model":"m",'
            '"usage":{"input_tokens":10,"output_tokens":0}}}\n')
    (ours / "agent-mine.jsonl").write_text(line)       # same session, uncaptured
    (theirs / "agent-foreign.jsonl").write_text(line)  # different session
    prices = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}

    backfilled = cr.backfill_missing(
        tmp_path,
        [str(ours / "agent-mine.jsonl"), str(theirs / "agent-foreign.jsonl")],
        prices)

    assert backfilled == ["mine"]                       # foreign one rejected
    assert (costs / "agent-mine.json").exists()
    assert not (costs / "agent-foreign.json").exists()


def test_session_transcripts_scopes_to_this_session(tmp_path):
    proj = tmp_path / "projects"
    ours = proj / "-repo" / "sess-AAA" / "subagents"
    theirs = proj / "-other" / "sess-BBB" / "subagents"
    ours.mkdir(parents=True)
    theirs.mkdir(parents=True)
    (ours / "agent-1.jsonl").write_text("{}\n")
    (ours / "agent-2.jsonl").write_text("{}\n")
    (theirs / "agent-x.jsonl").write_text("{}\n")
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-1.json").write_text(json.dumps({
        "agent_id": "1", "scope": "implementation", "total_cost_usd": 0.0,
        "transcript_path": str(ours / "agent-1.jsonl"), "unpriced_models": []}))

    got = sorted(Path(p).name for p in cr.session_transcripts(tmp_path))
    assert got == ["agent-1.jsonl", "agent-2.jsonl"]   # foreign session excluded


def test_session_transcripts_empty_when_unanchored(tmp_path):
    # No captured cost file to derive the session from → return nothing rather
    # than fall back to a wide glob (which was the contamination bug).
    (tmp_path / "costs").mkdir()
    assert cr.session_transcripts(tmp_path) == []


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


def test_reprices_historical_unpriced_from_tokens(tmp_path, monkeypatch):
    # A cost file captured when the model had no price freezes
    # total_cost_usd:0.0 with cost_usd:null per model (the "planning $0" bug:
    # the spec/plan session ran before claude-opus-4-8 was in the table). The
    # report must RE-PRICE from the captured tokens using today's table, not
    # trust the frozen zero, and drop the now-priced model from `unpriced`.
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "session-s1.json").write_text(json.dumps({
        "scope": "session",
        "planning": {
            "total_cost_usd": 0.0,
            "by_model": {"opus-x": {
                "input_tokens": 10, "output_tokens": 5,
                "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0,
                "messages": 1, "cost_usd": None}},
            "unpriced_models": ["opus-x"]},
        "orchestration": {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": []},
    }))
    monkeypatch.setattr(cr, "_load_prices_safe",
                        lambda: {"opus-x": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}})
    rep = cr.build_cost_report(tmp_path)
    assert rep["planning_cost_usd"] == 20.0        # 10*$1 + 5*$2, re-priced
    assert "opus-x" not in rep["unpriced_models"]   # no longer unpriced today
    assert rep["total_cost_usd"] == 20.0


def test_keeps_unpriced_when_model_still_absent(tmp_path, monkeypatch):
    # Re-price attempt with a model STILL missing from the table → stays
    # unpriced and contributes 0 (honest incompleteness, never a guessed cost).
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 0.0, "agent_id": "a",
        "by_model": {"ghost": {"input_tokens": 10, "output_tokens": 5,
                               "messages": 1, "cost_usd": None}},
        "unpriced_models": ["ghost"]}))
    monkeypatch.setattr(cr, "_load_prices_safe", lambda: {"other": {"input_per_mtok": 1.0, "output_per_mtok": 1.0}})
    rep = cr.build_cost_report(tmp_path)
    assert rep["implementation_cost_usd"] == 0.0
    assert "ghost" in rep["unpriced_models"]
    assert rep["complete"] is False


def test_trusts_present_cost_usd_without_repricing(tmp_path, monkeypatch):
    # When cost_usd is already populated, use it verbatim — don't re-price
    # (would drift if the table changed since capture).
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 7.0, "agent_id": "a",
        "by_model": {"m": {"input_tokens": 10, "output_tokens": 5,
                           "messages": 1, "cost_usd": 7.0}},
        "unpriced_models": []}))
    # table would price it differently if consulted — prove it is NOT consulted
    monkeypatch.setattr(cr, "_load_prices_safe", lambda: {"m": {"input_per_mtok": 9e9, "output_per_mtok": 9e9}})
    rep = cr.build_cost_report(tmp_path)
    assert rep["implementation_cost_usd"] == 7.0


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
