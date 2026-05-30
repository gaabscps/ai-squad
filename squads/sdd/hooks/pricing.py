"""ai-squad cost pricing — pure stdlib. Applies per-model rates + universal cache multipliers."""
import json
import os
from pathlib import Path

# Resolution chain (first match wins):
#   1. explicit path argument
#   2. local — next to this hook (per-repo install: <repo>/.claude/hooks/)
#   3. global — ~/.claude/hooks/ (framework-global fallback)
# The deploy step installs the table in BOTH (2) and (3) so it is effectively
# always present; this chain only matters under a partial install.
_LOCAL_PRICES = Path(__file__).resolve().parent / "model_prices.json"
_GLOBAL_PRICES = Path(os.path.expanduser("~/.claude/hooks/model_prices.json"))


def _price_table_candidates(path=None):
    """Ordered list of paths to try. Explicit path short-circuits the chain."""
    if path:
        return [Path(path)]
    return [_LOCAL_PRICES, _GLOBAL_PRICES]


def load_prices(path=None):
    """Return {model_id: {input_per_mtok, output_per_mtok}} from the first table found.

    Tries the resolution chain (explicit -> local -> global). Raises
    FileNotFoundError listing every path tried if none exist — callers that
    must not fail (token capture) catch it and degrade to tokens-only.
    """
    candidates = _price_table_candidates(path)
    for candidate in candidates:
        if candidate.is_file():
            data = json.loads(candidate.read_text(encoding="utf-8"))
            return data["models"]
    tried = ", ".join(str(c) for c in candidates)
    raise FileNotFoundError(f"model_prices.json not found (tried: {tried})")


# Universal prompt-cache multipliers (relative to base input rate). Anthropic pricing model.
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.00
CACHE_READ_MULT = 0.10


def _write_buckets(usage):
    """Return (tokens_5m, tokens_1h) for cache writes.

    Handles three shapes:
      1. raw transcript message:   usage["cache_creation"] = {ephemeral_5m..., ephemeral_1h...}
      2. accumulated (transcript_cost._accumulate): flat ephemeral_5m_input_tokens / ephemeral_1h_input_tokens keys
      3. legacy single-bucket:     usage["cache_creation_input_tokens"] (assume 5-minute TTL)
    """
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        return cc.get("ephemeral_5m_input_tokens", 0), cc.get("ephemeral_1h_input_tokens", 0)
    w5 = usage.get("ephemeral_5m_input_tokens", 0)
    w1 = usage.get("ephemeral_1h_input_tokens", 0)
    if w5 or w1:
        return w5, w1
    # Legacy flat fallback: assume 5-minute TTL (Claude Code default) when not broken out.
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
