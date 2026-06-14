#!/usr/bin/env python3
"""ai-squad — observe_report: renderizador markdown DETERMINÍSTICO do parecer.

Recebe os facts de build_delivery_facts(...) (ramo 'observed') e monta um
report.md a partir dos fatos — sem LLM, então não há o que inventar. Pure stdlib.
"""

_L = {
    "pt": {"done": "O que foi feito", "checks": "Verificações", "decisions": "Decisões",
           "why": "porquê", "rejected": "rejeitado", "outcome": "Desfecho", "none": "—"},
    "en": {"done": "What was done", "checks": "Verifications", "decisions": "Decisions",
           "why": "why", "rejected": "rejected", "outcome": "Outcome", "none": "—"},
}


def _labels(locale):
    loc = (locale or "en").lower()
    return _L["pt"] if loc.startswith("pt") else _L["en"]


def build_observe_report_md(facts: dict) -> str:
    L = _labels(facts.get("output_locale"))
    units = facts.get("work_units") or [{}]
    u = units[0]
    title = facts.get("feature_name") or u.get("title") or facts.get("spec_id") or "(sessão)"
    out = [f"# {title}", ""]

    outcome = facts.get("outcome")
    if outcome:
        out += [f"**{L['outcome']}:** {outcome}", ""]

    files = u.get("files_changed") or []
    out += [f"## {L['done']}", ""]
    if files:
        out += [f"- `{f}`" for f in files]
    else:
        out += [L["none"]]
    out += [""]

    checks = u.get("evidence_refs") or []
    out += [f"## {L['checks']}", ""]
    out += ([f"- {c}" for c in checks] if checks else [L["none"]])
    out += [""]

    decisions = u.get("decisions") or []
    out += [f"## {L['decisions']}", ""]
    if decisions:
        for d in decisions:
            what = d.get("what") or ""
            out += [f"- **{what}**"]
            if d.get("why"):
                out += [f"  - {L['why']}: {d['why']}"]
            if d.get("rejected"):
                out += [f"  - {L['rejected']}: {d['rejected']}"]
    else:
        out += [L["none"]]
    out += [""]

    return "\n".join(out)
