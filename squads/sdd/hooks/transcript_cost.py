"""Extract API-equivalent cost from one Claude Code JSONL transcript. Pure stdlib."""
import json
import sys
from pathlib import Path

# Make sibling `pricing` importable when this module is loaded via importlib
# spec (unit tests) rather than as part of the hooks-dir package.
sys.path.append(str(Path(__file__).resolve().parent))
from pricing import cost_for_usage  # noqa: E402

_BUCKET_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def _accumulate(agg, usage):
    for k in _BUCKET_KEYS:
        agg[k] = agg.get(k, 0) + usage.get(k, 0)
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        agg["ephemeral_5m_input_tokens"] = agg.get("ephemeral_5m_input_tokens", 0) + cc.get("ephemeral_5m_input_tokens", 0)
        agg["ephemeral_1h_input_tokens"] = agg.get("ephemeral_1h_input_tokens", 0) + cc.get("ephemeral_1h_input_tokens", 0)


def extract_transcript_cost(path, prices, since=None, until=None):
    """Sum usage per model across UNIQUE assistant messages, then price.

    since/until: optional ISO8601 strings to bracket by top-level `timestamp`
    (used for phase attribution in the main-session capture).
    Returns {total_cost_usd, by_model:{model:{...buckets, cost_usd, messages}},
             unpriced_models:[...], error}.
    """
    path = Path(path)
    seen = set()
    per_model = {}
    counts = {}
    err = None
    try:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if o.get("type") != "assistant":
                    continue
                ts = o.get("timestamp")
                if since and ts and ts < since:
                    continue
                if until and ts and ts > until:
                    continue
                m = o.get("message") or {}
                mid = m.get("id")
                usage = m.get("usage")
                if not mid or not isinstance(usage, dict) or mid in seen:
                    continue
                seen.add(mid)
                model = m.get("model", "unknown")
                _accumulate(per_model.setdefault(model, {}), usage)
                counts[model] = counts.get(model, 0) + 1
    except OSError as e:
        return {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": [], "error": str(e)}

    total = 0.0
    unpriced = []
    by_model = {}
    for model, buckets in per_model.items():
        priced = cost_for_usage(buckets, model, prices)
        entry = dict(buckets)
        entry["messages"] = counts[model]
        entry["cost_usd"] = priced["cost_usd"]
        if priced["priced"]:
            total += priced["cost_usd"]
        else:
            unpriced.append(model)
        by_model[model] = entry
    return {"total_cost_usd": round(total, 6), "by_model": by_model,
            "unpriced_models": unpriced, "error": err}
