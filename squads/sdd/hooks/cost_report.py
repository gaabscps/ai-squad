"""Aggregate per-agent + session cost files into one report. Pure stdlib."""
import json
import re
import sys
from pathlib import Path

# Make sibling `transcript_cost` importable when loaded via importlib spec.
sys.path.append(str(Path(__file__).resolve().parent))

_AGENT_FILE_RE = re.compile(r"agent-(.+)\.jsonl$")

_TOKEN_TYPES = ("input", "output", "cache_read", "cache_creation")
_BUCKET_FOR_TYPE = {
    "input": "input_tokens", "output": "output_tokens",
    "cache_read": "cache_read_input_tokens", "cache_creation": "cache_creation_input_tokens",
}


def fmt_tokens(n):
    """Compact human token count: 1.4M / 775K / 500."""
    n = int(n or 0)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.0f}K"
    return str(n)


def _load_prices_safe():
    """Prices for the legacy reprice fallback; None if unavailable (degrade to tokens-only)."""
    try:
        from pricing import load_prices
        return load_prices()
    except Exception:
        return None


def _empty_typemap():
    return {t: 0 for t in _TOKEN_TYPES}


def _session_subagents_dir(session_dir):
    """Derive THIS session's `.../<sessionId>/subagents/` dir, or None.

    Every subagent of one orchestrator session lives under the same
    `~/.claude/projects/<project-slug>/<sessionId>/subagents/` directory, and
    the SubagentStop hook records that full path in each `costs/agent-*.json`.
    We read any already-captured cost file to recover the dir — this anchors
    backfill/globbing to the current session instead of trusting a caller's
    (historically wide) glob. Returns None when nothing is captured yet.
    """
    costs = Path(session_dir) / "costs"
    if not costs.is_dir():
        return None
    for f in sorted(costs.glob("agent-*.json")):
        try:
            tp = json.loads(f.read_text(encoding="utf-8")).get("transcript_path")
        except (json.JSONDecodeError, OSError):
            continue
        if tp and "/subagents/" in str(tp):
            return Path(tp).parent
    return None


def session_transcripts(session_dir):
    """List THIS session's subagent transcript paths for backfill.

    Replaces the wide `~/.claude/projects/*/*/subagents/agent-*.jsonl` glob that
    scooped up every project/session on the machine (the $821/2804-agent bug).
    Returns [] when the session can't be anchored — deliberately NOT falling
    back to a wide glob, since an empty backfill beats a contaminated total.
    """
    d = _session_subagents_dir(session_dir)
    if d is None or not d.is_dir():
        return []
    return [str(p) for p in sorted(d.glob("agent-*.jsonl"))]


def backfill_missing(session_dir, transcript_paths, prices):
    """Write costs/agent-<id>.json for any subagent transcript lacking one.

    Write-capable recovery path — invoked by the orchestrator (NOT the read-only
    audit-agent). Returns the list of agent ids that were backfilled.

    Defense in depth: if the session can be anchored (see _session_subagents_dir),
    transcripts outside its subagents dir are rejected, so a caller passing a
    contaminated list (other projects/sessions) cannot inflate this report.
    """
    from transcript_cost import extract_transcript_cost

    session_dir = Path(session_dir)
    out_dir = session_dir / "costs"
    out_dir.mkdir(parents=True, exist_ok=True)
    expected_dir = _session_subagents_dir(session_dir)
    done = []
    for tp in transcript_paths:
        if expected_dir is not None and Path(tp).parent != expected_dir:
            continue
        m = _AGENT_FILE_RE.search(str(tp))
        if not m:
            continue
        agent_id = m.group(1)
        out_file = out_dir / f"agent-{agent_id}.json"
        if out_file.exists():
            continue
        result = extract_transcript_cost(tp, prices)
        payload = {"agent_id": agent_id, "transcript_path": str(tp),
                   "scope": "implementation", "backfilled": True, **result}
        out_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        done.append(agent_id)
    return done


def build_cost_report(session_dir):
    session_dir = Path(session_dir)
    costs = session_dir / "costs"
    planning = orchestration = implementation = 0.0
    subagents = 0
    unpriced = set()
    tok_phase = {p: _empty_typemap() for p in ("planning", "orchestration", "implementation")}
    cost_phase = {p: {t: 0.0 for t in _TOKEN_TYPES} for p in ("planning", "orchestration", "implementation")}
    _prices = {"v": None, "loaded": False}  # lazy holder for the reprice fallback

    def _get_prices():
        if not _prices["loaded"]:
            _prices["v"] = _load_prices_safe()
            _prices["loaded"] = True
        return _prices["v"]

    def _absorb(by_model, phase):
        if not isinstance(by_model, dict):
            return
        for model, entry in by_model.items():
            if not isinstance(entry, dict):
                continue
            for t, bkey in _BUCKET_FOR_TYPE.items():
                tok_phase[phase][t] += entry.get(bkey, 0) or 0
            cbt = entry.get("cost_by_type")
            if cbt is None and _get_prices() is not None:
                from pricing import cost_for_usage
                cbt = cost_for_usage(entry, model, _get_prices()).get("cost_by_type")
            if cbt:
                for t in _TOKEN_TYPES:
                    cost_phase[phase][t] += cbt.get(t, 0) or 0

    def _phase_cost(obj):
        """(cost_usd, unpriced_set) for one captured phase/agent object.

        A cost file is the immutable record of TOKENS; the price is applied
        here, at report time, with the current table. So when an entry's
        `cost_usd` is null (the model was unpriced WHEN captured — e.g. a
        spec/plan session that ran before the model hit the table), we re-price
        it from its tokens instead of trusting the frozen `total_cost_usd: 0.0`.
        A present `cost_usd` is trusted verbatim (no drift if the table moved).
        Falls back to the stored total when `by_model` is absent (legacy files).
        """
        obj = obj or {}
        bm = obj.get("by_model")
        if not isinstance(bm, dict) or not bm:
            return (obj.get("total_cost_usd") or 0.0), set(obj.get("unpriced_models") or [])
        total = 0.0
        unp = set()
        for model, entry in bm.items():
            if not isinstance(entry, dict):
                continue
            cu = entry.get("cost_usd")
            if cu is not None:
                total += cu
                continue
            prices = _get_prices()
            priced = None
            if prices is not None:
                from pricing import cost_for_usage
                priced = cost_for_usage(entry, model, prices)
            if priced and priced.get("priced"):
                total += priced["cost_usd"]
            else:
                unp.add(model)
        return total, unp

    if costs.is_dir():
        for f in sorted(costs.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            scope = d.get("scope")
            if scope == "session":
                pc, pu = _phase_cost(d.get("planning"))
                oc, ou = _phase_cost(d.get("orchestration"))
                planning += pc
                orchestration += oc
                unpriced |= pu | ou
                _absorb((d.get("planning") or {}).get("by_model"), "planning")
                _absorb((d.get("orchestration") or {}).get("by_model"), "orchestration")
            elif scope == "implementation":
                ic, iu = _phase_cost(d)
                implementation += ic
                unpriced |= iu
                subagents += 1
                _absorb(d.get("by_model"), "implementation")
    total = round(planning + orchestration + implementation, 6)
    tokens_by_type = _empty_typemap()
    cost_by_type = {t: 0.0 for t in _TOKEN_TYPES}
    for p in tok_phase:
        for t in _TOKEN_TYPES:
            tokens_by_type[t] += tok_phase[p][t]
            cost_by_type[t] += cost_phase[p][t]
        tok_phase[p]["total"] = sum(tok_phase[p][t] for t in _TOKEN_TYPES)
    tokens_total = sum(tokens_by_type[t] for t in _TOKEN_TYPES)
    return {
        "planning_cost_usd": round(planning, 6),
        "orchestration_cost_usd": round(orchestration, 6),
        "implementation_cost_usd": round(implementation, 6),
        "total_cost_usd": total,
        "subagent_count": subagents,
        "unpriced_models": sorted(unpriced),
        # `complete` means "we actually measured something AND everything we
        # measured was priced". Zero captures (empty costs/) is NOT complete —
        # the old `len(unpriced) == 0` reported complete:true for a $0/0-subagent
        # report, masking a capture failure as a clean run (the FEAT-010 bug).
        "complete": subagents > 0 and not unpriced,
        "tokens": {"by_phase": tok_phase, "by_type": tokens_by_type, "total": tokens_total},
        "token_cost": {
            "by_phase": {p: {**{t: round(cost_phase[p][t], 6) for t in _TOKEN_TYPES},
                             "total": round(sum(cost_phase[p].values()), 6)} for p in cost_phase},
            "by_type": {t: round(cost_by_type[t], 6) for t in _TOKEN_TYPES},
        },
    }


def render_markdown(rep, task_id):
    lines = [
        f"## Cost report — {task_id}",
        "",
        "| Phase | Cost (USD) | Tokens |",
        "|---|---|---|",
        f"| Planning (spec/design/tasks) | ${rep['planning_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['planning']['total'])} |",
        f"| Orchestration (Phase 4 driver) | ${rep['orchestration_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['orchestration']['total'])} |",
        f"| Implementation ({rep['subagent_count']} subagents) | ${rep['implementation_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['implementation']['total'])} |",
        f"| **Total** | **${rep['total_cost_usd']:.4f}** | **{fmt_tokens(rep['tokens']['total'])}** |",
    ]
    if not rep["complete"]:
        lines += ["", f"> WARNING: Unpriced models (cost incomplete): {', '.join(rep['unpriced_models'])}"]
    return "\n".join(lines)
