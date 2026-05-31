import importlib.util
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("transcript_cost", str(_LIB / "transcript_cost.py"))
tc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tc)

PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}
FIXTURE = _DIR / "fixtures" / "sample_transcript.jsonl"


def test_cache_writes_flow_through_extraction(tmp_path):
    # regression: _accumulate stores writes as flat ephemeral keys; cost_for_usage
    # must price them (previously dropped -> silent undercount of cache writes).
    p = tmp_path / "t.jsonl"
    p.write_text('{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":'
                 '{"id":"w","model":"m","usage":{"input_tokens":0,"output_tokens":0,'
                 '"cache_read_input_tokens":0,'
                 '"cache_creation":{"ephemeral_5m_input_tokens":100,"ephemeral_1h_input_tokens":100}}}}\n')
    r = tc.extract_transcript_cost(p, PRICES)
    # 100*1.25 + 100*2.0 = 325, * $1
    assert r["total_cost_usd"] == 325.0


def test_dedupes_by_message_id():
    r = tc.extract_transcript_cost(FIXTURE, PRICES)
    # msg_a counted ONCE: 10*$1 + 5*$2 = 20 ; msg_b: 100 read *0.1*$1 = 10 ; total 30
    assert r["total_cost_usd"] == 30.0
    assert r["by_model"]["m"]["messages"] == 2


def test_missing_file_returns_zero_not_crash():
    r = tc.extract_transcript_cost(Path("/no/such/file.jsonl"), PRICES)
    assert r["total_cost_usd"] == 0.0
    assert r["error"] is not None


def test_unpriced_model_surfaces_in_report():
    r = tc.extract_transcript_cost(FIXTURE, {})  # no models priced
    assert "m" in r["unpriced_models"]
    assert r["total_cost_usd"] == 0.0


def test_timestamp_bracketing():
    # until excludes msg_b (10:05) -> only msg_a (10:00) = 20
    r = tc.extract_transcript_cost(FIXTURE, PRICES, until="2026-05-27T10:01:00Z")
    assert r["total_cost_usd"] == 20.0
    # since excludes msg_a -> only msg_b = 10
    r2 = tc.extract_transcript_cost(FIXTURE, PRICES, since="2026-05-27T10:01:00Z")
    assert r2["total_cost_usd"] == 10.0


def test_by_model_carries_cost_by_type(tmp_path):
    tr = tmp_path / "t.jsonl"
    tr.write_text('{"type":"assistant","message":{"id":"x","model":"m",'
                  '"usage":{"input_tokens":10,"output_tokens":5}}}\n')
    r = tc.extract_transcript_cost(str(tr), PRICES)
    cbt = r["by_model"]["m"]["cost_by_type"]
    assert cbt["input"] == 10.0 and cbt["output"] == 10.0


def test_synthetic_model_is_ignored_not_unpriced(tmp_path):
    # Claude Code tags non-billable messages (context summaries, synthetic
    # errors, harness interruptions) with model "<synthetic>". These are not
    # real API calls — they must be skipped entirely, never counted as an
    # unpriced model (which would falsely flag the report incomplete).
    tr = tmp_path / "t.jsonl"
    tr.write_text(
        '{"type":"assistant","message":{"id":"real","model":"m",'
        '"usage":{"input_tokens":10,"output_tokens":5}}}\n'
        '{"type":"assistant","message":{"id":"syn","model":"<synthetic>",'
        '"usage":{"input_tokens":999,"output_tokens":999}}}\n')
    r = tc.extract_transcript_cost(str(tr), PRICES)
    assert r["unpriced_models"] == []          # <synthetic> not surfaced
    assert "<synthetic>" not in r["by_model"]   # not accumulated at all
    assert r["total_cost_usd"] == 20.0          # only the real message priced
