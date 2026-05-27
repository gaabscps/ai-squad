import importlib.util
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("pricing", str(_LIB / "pricing.py"))
pricing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pricing)

# rate of 1,000,000 $/Mtok == $1 per token: makes the arithmetic exact and readable.
PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}


def test_plain_input_output():
    usage = {"input_tokens": 10, "output_tokens": 5}
    r = pricing.cost_for_usage(usage, "m", PRICES)
    # 10*$1 + 5*$2 = $20
    assert r["cost_usd"] == 20.0
    assert r["priced"] is True


def test_cache_buckets_use_multipliers():
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 100,                       # *0.10 -> 10
        "cache_creation": {"ephemeral_5m_input_tokens": 100,  # *1.25 -> 125
                           "ephemeral_1h_input_tokens": 100}, # *2.00 -> 200
    }
    r = pricing.cost_for_usage(usage, "m", PRICES)
    assert r["cost_usd"] == 335.0  # (10 + 125 + 200) * $1


def test_flat_cache_creation_fallback_assumes_5m():
    usage = {"cache_creation_input_tokens": 100}  # no dict form
    r = pricing.cost_for_usage(usage, "m", PRICES)
    assert r["cost_usd"] == 125.0  # 100 * 1.25 * $1


def test_accumulated_flat_ephemeral_keys_are_priced():
    # the shape transcript_cost._accumulate produces (flat ephemeral keys, no dict)
    usage = {"ephemeral_5m_input_tokens": 100,    # *1.25 -> 125
             "ephemeral_1h_input_tokens": 100,    # *2.00 -> 200
             "cache_creation_input_tokens": 200}  # mirror; must NOT be double-counted
    r = pricing.cost_for_usage(usage, "m", PRICES)
    assert r["cost_usd"] == 325.0  # (125 + 200) * $1 — flat ephemeral wins over the mirror


def test_unknown_model_is_flagged_not_zeroed():
    r = pricing.cost_for_usage({"input_tokens": 10}, "unknown", PRICES)
    assert r["priced"] is False
    assert r["cost_usd"] is None
