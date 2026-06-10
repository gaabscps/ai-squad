"""Aggregate per-agent + session cost files into one report. Pure stdlib."""
import json
from datetime import datetime, timezone
import re
import sys
from pathlib import Path

# Make sibling `transcript_cost` importable when loaded via importlib spec.
sys.path.append(str(Path(__file__).resolve().parent))

_AGENT_FILE_RE = re.compile(r"agent-(.+)\.jsonl$")
_SESSION_FILE_RE = re.compile(r"session-(.+)\.json$")
# Subagent transcripts live at .../projects/<slug>/<sessionId>/subagents/...
# The <sessionId> segment is the orchestrator session that dispatched them.
_PARENT_SESSION_RE = re.compile(r"/projects/[^/]+/([^/]+)/subagents/")

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


def _parent_session(transcript_path):
    """Parent Claude session id from a subagent transcript path, or None.

    None when the path is absent or not in the `.../<sessionId>/subagents/`
    shape — callers treat None as "provenance unknown", never as "foreign".
    """
    if not transcript_path:
        return None
    m = _PARENT_SESSION_RE.search(str(transcript_path))
    return m.group(1) if m else None


def _read_mode(session_dir):
    """`mode:` scalar from session.yml ('observed' for free sessions), or None."""
    sy = Path(session_dir) / "session.yml"
    if not sy.exists():
        return None
    for line in sy.read_text(encoding="utf-8", errors="replace").splitlines():
        if re.match(r"^mode\s*:", line):
            return line.split(":", 1)[1].strip().strip('"').strip("'") or None
    return None


def _read_implementation_sessions(session_dir):
    """Authoritative allow-list of this feature's implementation session id(s).

    The orchestrator Stop hook (register-impl-session) records its own — and
    therefore trustworthy — session id under `implementation_sessions:` in
    session.yml. Returns the set, or None when the field is absent/empty. None
    means "no authoritative anchor; fall back to disk cross-validation". Cheap
    line parse, no PyYAML (consistent with the hooks).
    """
    sy = Path(session_dir) / "session.yml"
    if not sy.exists():
        return None
    ids = set()
    in_block = False
    for line in sy.read_text(encoding="utf-8", errors="replace").splitlines():
        if re.match(r"^\s*implementation_sessions\s*:", line):
            in_block = True
            continue
        if not in_block:
            continue
        m = re.match(r"^\s+-\s*[\"']?([^\"'\s]+)[\"']?\s*$", line)
        if m:
            ids.add(m.group(1))
        elif line.strip() == "":
            continue
        elif not line.startswith((" ", "\t")):
            break  # a new top-level key ends the list block
    return ids or None


def _agent_in_scope(parent, allowed, present):
    """Does an agent cost file belong to THIS feature?

    - allowed (registry present): authoritative — keep iff the parent session
      is listed. An unparseable parent is dropped (the registry world always
      records a transcript path, so this only sheds contamination).
    - else (fallback): keep when provenance is unknown (parent is None) or when
      there are no session files to validate against; otherwise keep iff the
      parent session also wrote a session-*.json here. This self-heals the
      2804->60 contamination on READ without touching disk.
    """
    if allowed is not None:
        return parent is not None and parent in allowed
    if parent is None or not present:
        return True
    return parent in present


def _attempt_scope_recovery(excluded_records, session_dir):
    """Decide which excluded implementation agents are safe to recover.

    Called only when the sanity floor tripped (kept 0 subagents, excluded N>0) —
    a broken allow-list/timing race, not contamination. Returns the list of
    (parent, cost_obj) records to re-include, or [] to fail loud.

    Safe to recover (Option A — dual confirmation) iff:
      - dispatch-manifest.json witnesses a real run here: a non-empty
        actual_dispatches list of length M; and
      - the excluded agents are dominated by a SINGLE parent session (the
        signature of one orchestrator run, not heterogeneous contamination):
        the largest by-parent cluster covers >= half of the excluded agents; and
      - the excluded count N is the same order of magnitude as M (N <= 2*M) —
        a 2804-vs-64 pile is contamination, not this run.
    Only the dominant cluster is recovered (stragglers stay excluded — the
    conservative choice; legitimate multi-session resumes are already handled at
    the root by PreToolUse(Task) registration). The 0.5 / 2x thresholds are v1
    and tunable; see the Spec B design doc, edge case 3.
    """
    n = len(excluded_records)
    try:
        manifest = json.loads(
            (Path(session_dir) / "dispatch-manifest.json").read_text(encoding="utf-8"))
        m = len(manifest.get("actual_dispatches") or [])
    except (OSError, json.JSONDecodeError, AttributeError, TypeError):
        m = 0
    if m < 1 or n > 2 * m:
        return []
    by_parent = {}
    for parent, d in excluded_records:
        by_parent.setdefault(parent, []).append((parent, d))
    _, dominant = max(by_parent.items(), key=lambda kv: len(kv[1]))
    if len(dominant) < 0.5 * n:
        return []
    return dominant


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
    session_captures = 0
    excluded_records = []  # (parent_session, cost_obj) for each out-of-scope agent
    unpriced = set()
    # Read-scoping anchors (Gap A): an authoritative allow-list from session.yml
    # if present, else the set of session ids that actually wrote a session-*.json
    # here (disk cross-validation fallback). See _agent_in_scope.
    allowed_sessions = _read_implementation_sessions(session_dir)
    present_sessions = set()
    if costs.is_dir():
        for f in costs.glob("session-*.json"):
            m = _SESSION_FILE_RE.search(f.name)
            if m:
                present_sessions.add(m.group(1))
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
                session_captures += 1
                pc, pu = _phase_cost(d.get("planning"))
                oc, ou = _phase_cost(d.get("orchestration"))
                planning += pc
                orchestration += oc
                unpriced |= pu | ou
                _absorb((d.get("planning") or {}).get("by_model"), "planning")
                _absorb((d.get("orchestration") or {}).get("by_model"), "orchestration")
                # New trail (/implementer): the main session carries an
                # `implementation` slice (spend after implement_trail.started_at).
                # It joins the implementation bucket but is NOT a subagent.
                if d.get("implementation") is not None:
                    sic, siu = _phase_cost(d.get("implementation"))
                    implementation += sic
                    unpriced |= siu
                    _absorb((d.get("implementation") or {}).get("by_model"), "implementation")
            elif scope == "implementation":
                parent = _parent_session(d.get("transcript_path"))
                if not _agent_in_scope(parent, allowed_sessions, present_sessions):
                    excluded_records.append((parent, d))
                    continue
                ic, iu = _phase_cost(d)
                implementation += ic
                unpriced |= iu
                subagents += 1
                _absorb(d.get("by_model"), "implementation")
    # Sanity floor (Spec B): if scoping kept 0 subagents but excluded some, the
    # allow-list/fallback is broken (e.g. the report ran before the orchestrator
    # session's provenance was written), NOT contamination — contamination always
    # leaves some legit agents standing. Never present $0 as valid here.
    recovered = 0
    scoping_suspect = False
    if subagents == 0 and excluded_records:
        to_recover = _attempt_scope_recovery(excluded_records, session_dir)
        if to_recover:
            recover_keys = {id(d) for _, d in to_recover}
            for _parent, d in to_recover:
                ic, iu = _phase_cost(d)
                implementation += ic
                unpriced |= iu
                subagents += 1
                _absorb(d.get("by_model"), "implementation")
            recovered = len(to_recover)
            excluded_records = [r for r in excluded_records if id(r[1]) not in recover_keys]
        else:
            scoping_suspect = True
    excluded = len(excluded_records)
    mode = _read_mode(session_dir)
    total = round(planning + orchestration + implementation, 6)
    tokens_by_type = _empty_typemap()
    cost_by_type = {t: 0.0 for t in _TOKEN_TYPES}
    for p in tok_phase:
        for t in _TOKEN_TYPES:
            tokens_by_type[t] += tok_phase[p][t]
            cost_by_type[t] += cost_phase[p][t]
        tok_phase[p]["total"] = sum(tok_phase[p][t] for t in _TOKEN_TYPES)
    tokens_total = sum(tokens_by_type[t] for t in _TOKEN_TYPES)
    rep_mode = {"mode": "observed"} if mode == "observed" else {}
    return {
        **rep_mode,
        "planning_cost_usd": round(planning, 6),
        "orchestration_cost_usd": round(orchestration, 6),
        "implementation_cost_usd": round(implementation, 6),
        "total_cost_usd": total,
        "subagent_count": subagents,
        # Agent cost files in costs/ whose provenance did not match this feature
        # (foreign session/project contamination), ignored on read. Surfaced —
        # never silently dropped.
        "excluded_subagents": excluded,
        # Implementation subagents recovered after the sanity floor tripped
        # (Spec B); 0 in the normal path.
        "recovered_subagents": recovered,
        # True when scoping kept 0 subagents but excluded some AND recovery was
        # not safe — the implementation cost is NOT trustworthy. Consumers must
        # not treat the total as final when this is set.
        "scoping_suspect": scoping_suspect,
        "unpriced_models": sorted(unpriced),
        # `complete` means "we actually measured something AND everything we
        # measured was priced". Zero captures (empty costs/) is NOT complete —
        # the old `len(unpriced) == 0` reported complete:true for a $0/0-subagent
        # report, masking a capture failure as a clean run (the FEAT-010 bug).
        # Observed (free) sessions have no subagents BY DESIGN, so their
        # "measured something" is the main-session capture itself.
        "complete": ((session_captures > 0) if mode == "observed"
                     else (subagents > 0)) and not unpriced,
        "tokens": {"by_phase": tok_phase, "by_type": tokens_by_type, "total": tokens_total},
        "token_cost": {
            "by_phase": {p: {**{t: round(cost_phase[p][t], 6) for t in _TOKEN_TYPES},
                             "total": round(sum(cost_phase[p].values()), 6)} for p in cost_phase},
            "by_type": {t: round(cost_by_type[t], 6) for t in _TOKEN_TYPES},
        },
    }


def write_cost_report_json(session_dir):
    """Build the scoped cost report and persist it atomically as
    <session_dir>/cost-report.json — the single source of truth for observers.

    Returns the report dict, or None when no cost data exists (no costs/ dir),
    mirroring build_html_report's guard so the JSON and report.html appear or
    are absent together. Adds spec_id + generated_at as emission metadata
    without touching the cost numbers or scoping logic.
    """
    session_dir = Path(session_dir)
    if not (session_dir / "costs").is_dir():
        return None
    rep = build_cost_report(session_dir)
    rep["spec_id"] = session_dir.name
    rep["generated_at"] = datetime.now(timezone.utc).isoformat()
    out = session_dir / "cost-report.json"
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rep, indent=2), encoding="utf-8")
    tmp.replace(out)  # atomic
    return rep


def render_markdown(rep, task_id):
    if rep.get("mode") == "observed":
        # Free session: no phase machine — one Session row is the honest shape.
        lines = [
            f"## Cost report — {task_id}",
            "",
            "| Scope | Cost (USD) | Tokens |",
            "|---|---|---|",
            f"| Session | ${rep['planning_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['planning']['total'])} |",
            f"| **Total** | **${rep['total_cost_usd']:.4f}** | **{fmt_tokens(rep['tokens']['total'])}** |",
        ]
        if not rep["complete"]:
            lines += ["", "> WARNING: cost incomplete "
                          f"(unpriced models or missing capture): {', '.join(rep['unpriced_models'])}"]
        return "\n".join(lines)
    impl_cell = "unknown" if rep.get("scoping_suspect") else f"${rep['implementation_cost_usd']:.4f}"
    lines = [
        f"## Cost report — {task_id}",
        "",
        "| Phase | Cost (USD) | Tokens |",
        "|---|---|---|",
        f"| Planning (spec/design/tasks) | ${rep['planning_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['planning']['total'])} |",
        f"| Orchestration (Phase 4 driver) | ${rep['orchestration_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['orchestration']['total'])} |",
        f"| Implementation ({rep['subagent_count']} subagents) | {impl_cell} | {fmt_tokens(rep['tokens']['by_phase']['implementation']['total'])} |",
        f"| **Total** | **${rep['total_cost_usd']:.4f}** | **{fmt_tokens(rep['tokens']['total'])}** |",
    ]
    if not rep["complete"]:
        lines += ["", f"> WARNING: Unpriced models (cost incomplete): {', '.join(rep['unpriced_models'])}"]
    if rep.get("scoping_suspect"):
        lines += ["", "> **WARNING — SCOPING BROKEN:** kept 0 implementation subagents "
                      f"but excluded {rep['excluded_subagents']} cost file(s) present on disk. "
                      "The implementation cost is NOT trustworthy — do not treat this total "
                      "as final. See the Spec B design doc."]
    if rep.get("recovered_subagents"):
        lines += ["", f"> NOTE: Recovered {rep['recovered_subagents']} implementation "
                      "subagent(s) after the scoping sanity floor tripped "
                      "(dominant cluster + manifest witness)."]
    if rep.get("excluded_subagents"):
        lines += ["", f"> NOTE: Ignored {rep['excluded_subagents']} out-of-scope agent "
                      "cost file(s) (foreign session/project contamination)."]
    return "\n".join(lines)
