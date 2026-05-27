"""Aggregate per-agent + session cost files into one report. Pure stdlib."""
import json
import re
import sys
from pathlib import Path

# Make sibling `transcript_cost` importable when loaded via importlib spec.
sys.path.append(str(Path(__file__).resolve().parent))

_AGENT_FILE_RE = re.compile(r"agent-(.+)\.jsonl$")


def backfill_missing(session_dir, transcript_paths, prices):
    """Write costs/agent-<id>.json for any subagent transcript lacking one.

    Write-capable recovery path — invoked by the orchestrator (NOT the read-only
    audit-agent). Returns the list of agent ids that were backfilled.
    """
    from transcript_cost import extract_transcript_cost

    session_dir = Path(session_dir)
    out_dir = session_dir / "costs"
    out_dir.mkdir(parents=True, exist_ok=True)
    done = []
    for tp in transcript_paths:
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
    if costs.is_dir():
        for f in sorted(costs.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            scope = d.get("scope")
            if scope == "session":
                planning += (d.get("planning") or {}).get("total_cost_usd") or 0.0
                orchestration += (d.get("orchestration") or {}).get("total_cost_usd") or 0.0
                for sub in ("planning", "orchestration"):
                    unpriced.update((d.get(sub) or {}).get("unpriced_models") or [])
            elif scope == "implementation":
                implementation += d.get("total_cost_usd") or 0.0
                subagents += 1
                unpriced.update(d.get("unpriced_models") or [])
    total = round(planning + orchestration + implementation, 6)
    return {
        "planning_cost_usd": round(planning, 6),
        "orchestration_cost_usd": round(orchestration, 6),
        "implementation_cost_usd": round(implementation, 6),
        "total_cost_usd": total,
        "subagent_count": subagents,
        "unpriced_models": sorted(unpriced),
        "complete": len(unpriced) == 0,
    }


def render_markdown(rep, task_id):
    lines = [
        f"## Cost report — {task_id}",
        "",
        "| Phase | Cost (USD) |",
        "|---|---|",
        f"| Planning (spec/design/tasks) | ${rep['planning_cost_usd']:.4f} |",
        f"| Orchestration (Phase 4 driver) | ${rep['orchestration_cost_usd']:.4f} |",
        f"| Implementation ({rep['subagent_count']} subagents) | ${rep['implementation_cost_usd']:.4f} |",
        f"| **Total** | **${rep['total_cost_usd']:.4f}** |",
    ]
    if not rep["complete"]:
        lines += ["", f"> WARNING: Unpriced models (cost incomplete): {', '.join(rep['unpriced_models'])}"]
    return "\n".join(lines)
