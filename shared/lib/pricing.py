"""ai-squad cost pricing — pure stdlib. Applies per-model rates + universal cache multipliers."""
import json
from pathlib import Path

_DEFAULT_PRICES = Path(__file__).resolve().parent / "model_prices.json"


def load_prices(path=None):
    """Return {model_id: {input_per_mtok, output_per_mtok}} from the config file."""
    path = Path(path) if path else _DEFAULT_PRICES
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["models"]


# Universal prompt-cache multipliers (relative to base input rate). Anthropic pricing model.
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.00
CACHE_READ_MULT = 0.10


def _write_buckets(usage):
    """Return (tokens_5m, tokens_1h) from either the dict or flat cache_creation form."""
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        return cc.get("ephemeral_5m_input_tokens", 0), cc.get("ephemeral_1h_input_tokens", 0)
    # Flat fallback: assume 5-minute TTL (Claude Code default) when not broken out.
    return usage.get("cache_creation_input_tokens", 0), 0


def cost_for_usage(usage, model, prices):
    """Compute API-equivalent USD cost for one model's summed token buckets.

    Returns {cost_usd, priced, model, billable_input_tokens, output_tokens}.
    On an unknown model, priced=False and cost_usd=None (never silently 0).
    """
    rates = prices.get(model)
    output = usage.get("output_tokens", 0)
    inp = usage.get("input_tokens", 0)
    read = usage.get("cache_read_input_tokens", 0)
    w5, w1 = _write_buckets(usage)
    if rates is None:
        return {"cost_usd": None, "priced": False, "model": model,
                "billable_input_tokens": inp, "output_tokens": output}
    in_rate = rates["input_per_mtok"] / 1_000_000
    out_rate = rates["output_per_mtok"] / 1_000_000
    cost = (inp
            + w5 * CACHE_WRITE_5M_MULT
            + w1 * CACHE_WRITE_1H_MULT
            + read * CACHE_READ_MULT) * in_rate + output * out_rate
    return {"cost_usd": round(cost, 6), "priced": True, "model": model,
            "billable_input_tokens": inp, "output_tokens": output}
