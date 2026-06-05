#!/usr/bin/env python3
"""Deterministic extractor: build squad-agnostic DeliveryFacts from a finished
.agent-session/<spec_id>/ run. The chronicler agent runs this, then writes the
delivery-report from the Facts + prose. Pure stdlib, no PyYAML (session.yml is
hand-authored; we read the few scalars we need with line-based regex, the same
way cost_report.py does). Extend to a new squad by adding an extractor to
EXTRACTORS — the chronicler and the Facts schema do not change.

CLI: python3 delivery_report.py <session_dir>  ->  writes delivery-facts.json
"""
import sys

# Run as a standalone script, Python puts this file's directory at sys.path[0].
# shared/lib/ (and a deploy dir that bundles it) holds a warnings.py that shadows
# the stdlib `warnings` pathlib imports transitively — a circular-import crash on
# `from pathlib import Path`. This module imports nothing from its siblings, so when
# pathlib is not yet loaded (the standalone case; under pytest it already is, so this
# is skipped and the suite's sys.path is untouched) drop the self dir so stdlib wins.
if "pathlib" not in sys.modules:
    import os as _os

    _self_dir = _os.path.dirname(_os.path.abspath(__file__))
    sys.path[:] = [p for p in sys.path if _os.path.abspath(p or ".") != _self_dir]

import json
import re
from pathlib import Path

_TASK_RE = re.compile(r"(T-\d{3,})")
_AC_RE = re.compile(r"(AC-\d{3,})")
_PIPELINE_ROLES = {"audit-agent", "committer", "chronicler"}


def _read_session_scalars(session_dir: Path) -> dict:
    """Line-based parse of the few top-level scalars + the escalation_metrics block.
    Mirrors cost_report._read_implementation_sessions' regex approach (no PyYAML)."""
    out = {"escalation_metrics": {}}
    sy = session_dir / "session.yml"
    try:
        lines = sy.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return out
    in_metrics = False
    for line in lines:
        top = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if top and not line.startswith((" ", "\t")):
            key, val = top.group(1), top.group(2).strip()
            in_metrics = key == "escalation_metrics"
            if key in ("spec_id", "squad", "feature_name", "output_locale",
                       "started_at", "completed_at"):
                out[key] = val.strip().strip('"').strip("'")
            continue
        if in_metrics:
            m = re.match(r"^\s+([a-z_]+):\s*([0-9.]+)\s*$", line)
            if m:
                num = m.group(2)
                out["escalation_metrics"][m.group(1)] = (
                    float(num) if "." in num else int(num))
    return out


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _acceptance_criteria(session_dir: Path) -> list:
    """Extract AC ids (+ first line of text) from spec.md / tasks.md headings."""
    seen = {}
    for name in ("spec.md", "tasks.md"):
        p = session_dir / name
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in _AC_RE.finditer(text):
            seen.setdefault(m.group(1), {"id": m.group(1)})
    return [seen[k] for k in sorted(seen)]


def _outcome(metrics: dict, gate_status: str) -> str:
    if gate_status in ("blocked", "escalate"):
        return "refused"
    total = metrics.get("total_tasks", 0) or 0
    pending = metrics.get("pending_human_tasks", 0) or 0
    if pending == 0:
        # Only a clean (done) gate earns "success"; an absent/other gate that did
        # not pass must not read as a clean delivery — degrade to "mixed".
        return "success" if gate_status == "done" else "mixed"
    if total and pending >= total / 2:
        return "escalated"
    return "mixed"


def extract_sdd(session_dir: Path) -> dict:
    """SDD extractor: dispatch-manifest.json + outputs/*.json + session.yml scalars."""
    session_dir = Path(session_dir).resolve()
    scalars = _read_session_scalars(session_dir)
    manifest = _load_json(session_dir / "dispatch-manifest.json") or {}
    dispatches = manifest.get("actual_dispatches", []) or []

    # Index Output Packets by dispatch_id.
    packets = {}
    outdir = session_dir / "outputs"
    if outdir.is_dir():
        for f in outdir.glob("*.json"):
            pkt = _load_json(f)
            if isinstance(pkt, dict) and pkt.get("dispatch_id"):
                packets[pkt["dispatch_id"]] = pkt

    # Gate = the audit-agent packet (last one wins if multiple).
    gate = {"role": "audit-agent", "status": "absent", "blocker_kind": None, "findings": []}
    for d in dispatches:
        if d.get("role") == "audit-agent":
            pkt = packets.get(d.get("dispatch_id"), {})
            gate = {
                "role": "audit-agent",
                "status": pkt.get("status", d.get("status", "absent")),
                "blocker_kind": pkt.get("blocker_kind"),
                "findings": pkt.get("findings", []),
            }

    # Group task-scoped dispatches into work_units by task_id.
    units = {}
    for d in dispatches:
        task_id = d.get("task_id")
        if not task_id or d.get("role") in _PIPELINE_ROLES:
            continue
        u = units.setdefault(task_id, {
            "id": task_id, "title": "", "planned_scope": [], "final_status": "",
            "loops": {"review": 0, "qa": 0, "blocker": 0}, "dispatches": [],
            "decisions": [], "findings": [], "ac_coverage": {}, "files_changed": [],
            "evidence_refs": [],
        })
        pkt = packets.get(d.get("dispatch_id"), {})
        role = d.get("role")
        u["dispatches"].append({
            "dispatch_id": d.get("dispatch_id"), "role": role,
            "status": pkt.get("status", d.get("status")),
            "review_loop": d.get("review_loop", pkt.get("review_loop", 1)),
        })
        if role in ("code-reviewer", "logic-reviewer"):
            u["loops"]["review"] += 1
        elif role == "qa":
            u["loops"]["qa"] += 1
        elif role == "blocker-specialist":
            u["loops"]["blocker"] += 1
        if role == "dev":
            for fc in pkt.get("files_changed", []) or []:
                if fc not in u["files_changed"]:
                    u["files_changed"].append(fc)
            u["decisions"].extend(pkt.get("decisions", []) or [])
        if role in ("code-reviewer", "logic-reviewer"):
            u["findings"].extend(pkt.get("findings", []) or [])
        if role == "qa":
            for k, v in (pkt.get("ac_coverage") or {}).items():
                u["ac_coverage"][k] = v
        # final_status = worst across dispatches (escalate<blocked<needs_review<done)
        rank = {"escalate": 0, "blocked": 1, "needs_review": 2, "done": 3}
        cur = pkt.get("status") or d.get("status")
        if cur in rank:
            if not u["final_status"] or rank[cur] < rank.get(u["final_status"], 9):
                u["final_status"] = cur

    metrics = scalars.get("escalation_metrics", {})
    facts = {
        "spec_id": scalars.get("spec_id", manifest.get("spec_id", "")),
        "squad": scalars.get("squad", "sdd"),
        "feature_name": scalars.get("feature_name", ""),
        "output_locale": scalars.get("output_locale", "en"),
        "outcome": _outcome(metrics, gate["status"]),
        "intent": {
            "spec_ref": str(session_dir / "spec.md"),
            "plan_ref": str(session_dir / "plan.md"),
            "tasks_ref": str(session_dir / "tasks.md"),
            "acceptance_criteria": _acceptance_criteria(session_dir),
        },
        "work_units": [units[k] for k in sorted(units)],
        "escalations": [
            {"unit_id": u["id"], "blocker_kind": None, "summary": ""}
            for u in units.values() if u["final_status"] in ("blocked", "escalate")
        ],
        "gate": gate,
        "cost": {"total_usd": None, "complete": False},
        "timeline": {
            "started_at": scalars.get("started_at", ""),
            "completed_at": scalars.get("completed_at", ""),
            "phases": [],
        },
        "generated_from": {"session_dir": str(session_dir), "extractor": "sdd"},
    }
    return facts


# Extension point: register a new squad extractor here. The chronicler and the
# Facts schema do not change — adding Discovery is acoplar um extrator.
EXTRACTORS = {
    "sdd": extract_sdd,
}


def build_delivery_facts(session_dir: str) -> dict:
    sdir = Path(session_dir)
    scalars = _read_session_scalars(sdir)
    squad = scalars.get("squad", "sdd")
    extractor = EXTRACTORS.get(squad)
    if extractor is None:
        raise NotImplementedError(
            f"no delivery extractor registered for squad '{squad}' "
            f"(registered: {sorted(EXTRACTORS)})")
    return extractor(sdir)


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print("usage: delivery_report.py <session_dir>", file=sys.stderr)
        return 2
    session_dir = Path(argv[0]).resolve()
    facts = build_delivery_facts(str(session_dir))
    out = session_dir / "delivery-facts.json"
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(facts, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out)
    print(str(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
