import importlib.util
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("transcript_cost", str(_LIB / "transcript_cost.py"))
tc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tc)

PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}
FIXTURE = _DIR / "fixtures" / "sample_transcript.jsonl"


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
