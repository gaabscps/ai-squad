"""Render an HTML session report (cost + code review) from .agent-session/<FEAT>/.

Audience: the human reviewer after an autonomous Phase 4 pipeline. The report is
the bridge between "the pipeline finished" and "I approve / I'll read the code".
It leads with a verdict dashboard, tells each task's story (dev -> review -> fix
-> qa) as a logical timeline, and links findings + diff to the task so the
reviewer arrives at the code with context.

Pure stdlib, self-contained, offline: visuals are inline SVG and native
<details> — no CDN, no third-party JS. Lives in the hooks dir so it deploys
per-repo and can import its sibling cost_report module in any consumer repo.
"""
import html
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost_report  # noqa: E402

_REVIEWER_ROLES = ("code-reviewer", "logic-reviewer")
# Pipeline-scoped roles have no single task (identity.md) -> integrity band.
_PIPELINE_ROLES = ("audit-agent", "committer")
_TIMELINE_ORDER = ("dev", "code-reviewer", "logic-reviewer", "qa")
_ROLE_ABBR = {"dev": "D", "code-reviewer": "CR", "logic-reviewer": "LR", "qa": "QA"}
# Worst (lowest rank) wins when deriving a task's final verdict.
_STATUS_RANK = {"escalate": 0, "blocked": 1, "needs_review": 2, "done": 3}
# Display labels (pt-BR) for the canonical English enums. The CSS class keeps the
# canonical value; only the visible text is translated (audience: human reviewer).
_STATUS_PT = {"done": "concluído", "needs_review": "requer revisão",
              "blocked": "bloqueado", "escalate": "escalado"}
_SEV_PT = {"blocker": "bloqueador", "critical": "crítico", "error": "erro",
           "major": "maior", "warning": "aviso", "minor": "menor", "info": "info"}
_LOOP_RE = re.compile(r"-l(\d+)$")
_TASK_RE = re.compile(r"(T-\d+)")


def _esc(x):
    return html.escape(str(x), quote=True)


def _task_from_dispatch(dispatch_id):
    m = _TASK_RE.search(dispatch_id or "")
    return m.group(1) if m else None


def _loop_of(dispatch_id):
    m = _LOOP_RE.search(dispatch_id or "")
    return int(m.group(1)) if m else 1


def _load_packets(session_dir):
    outputs = session_dir / "outputs"
    packets = []
    if outputs.is_dir():
        for f in sorted(outputs.glob("*.json")):
            try:
                packets.append(json.loads(f.read_text(encoding="utf-8")))
            except (json.JSONDecodeError, OSError):
                continue
    return packets


# --- per-task analysis ------------------------------------------------------

def _loops_by_role(packets):
    by_role = {}
    for p in packets:
        by_role.setdefault(p.get("role", "?"), []).append(p)
    for lst in by_role.values():
        lst.sort(key=lambda p: _loop_of(p.get("dispatch_id")))
    return by_role


def _max_loop(packets):
    return max((_loop_of(p.get("dispatch_id")) for p in packets), default=1)


def _task_verdict(packets):
    """Final status: qa's last loop if present, else the worst final-loop status."""
    qa = [p for p in packets if p.get("role") == "qa"]
    if qa:
        qa.sort(key=lambda p: _loop_of(p.get("dispatch_id")))
        return qa[-1].get("status", "done")
    finals = [lst[-1].get("status", "done") for lst in _loops_by_role(packets).values()]
    return min(finals, key=lambda s: _STATUS_RANK.get(s, 2)) if finals else "done"


def _split_findings(packets):
    """(resolved, open). A finding is open only if it sits in the last loop of its
    role AND the task did not converge (verdict != done); everything a later loop
    superseded — or that qa ultimately accepted — counts as resolved."""
    by_role = _loops_by_role(packets)
    task_done = _task_verdict(packets) == "done"
    resolved, open_ = [], []
    for lst in by_role.values():
        last = _loop_of(lst[-1].get("dispatch_id"))
        for p in lst:
            is_last = _loop_of(p.get("dispatch_id")) == last
            for fd in (p.get("findings") or []):
                (open_ if (is_last and not task_done) else resolved).append((p, fd))
    return resolved, open_


def _narrative(packets):
    """The story after dev's first cut, woven from the agents' own summaries."""
    by_role = _loops_by_role(packets)
    parts = []
    n_find = sum(len(p.get("findings") or [])
                 for r in _REVIEWER_ROLES for p in by_role.get(r, []))
    max_loop = _max_loop(packets)
    if max_loop >= 2 and n_find:
        parts.append(f"Os reviewers apontaram {n_find} achado(s); "
                     f"o dev corrigiu e reentregou no loop {max_loop}.")
    elif n_find:
        parts.append(f"Os reviewers apontaram {n_find} achado(s).")
    else:
        parts.append("Entregue em loop único, sem achados dos reviewers.")
    qa = by_role.get("qa", [])
    if qa and qa[-1].get("status") == "done":
        parts.append("O QA validou os ACs no fim.")
    return " ".join(parts)


# --- visuals (inline SVG / CSS, no dependency) ------------------------------

def _donut_svg(segments, total):
    if total <= 0:
        return ""
    circles = ["<circle cx='18' cy='18' r='15.9' fill='none' stroke='#eee' stroke-width='4'/>"]
    offset = 0.0
    for color, n in segments:
        if n <= 0:
            continue
        pct = n / total * 100
        circles.append(
            f"<circle cx='18' cy='18' r='15.9' fill='none' stroke='{color}' stroke-width='4' "
            f"stroke-dasharray='{pct:.2f} {100 - pct:.2f}' stroke-dashoffset='{-offset:.2f}' "
            f"transform='rotate(-90 18 18)'/>")
        offset += pct
    return f"<svg width='58' height='58' viewBox='0 0 36 36'>{''.join(circles)}</svg>"


def _cost_bar(rep):
    total = rep["total_cost_usd"] or 1
    segs = [("#9ec5fe", rep["planning_cost_usd"]),
            ("#3b6fcc", rep["orchestration_cost_usd"]),
            ("#2e9e2e", rep["implementation_cost_usd"])]
    bars = "".join(f"<i style='width:{v / total * 100:.1f}%;background:{c}'></i>" for c, v in segs)
    return f"<div class='bar'>{bars}</div>"


def _timeline(packets):
    by_role = _loops_by_role(packets)
    nodes = []
    for loop in range(1, _max_loop(packets) + 1):
        for role in _TIMELINE_ORDER:
            for p in by_role.get(role, []):
                if _loop_of(p.get("dispatch_id")) == loop:
                    status = p.get("status", "done")
                    if role == "dev":
                        dot, glyph = "d-dev", "D"
                    elif status == "done":
                        dot, glyph = "d-ok", "✓"
                    else:
                        dot, glyph = "d-bad", "!"
                    nodes.append(
                        f"<div class='node'><div class='dot {dot}'>{glyph}</div>"
                        f"{_ROLE_ABBR.get(role, role)} L{loop}</div>")
    inner = "<div class='conn'></div>".join(nodes)
    return f"<div class='timeline'>{inner}</div>"


# --- findings ---------------------------------------------------------------

def _finding_ref(fd):
    if fd.get("file"):
        line = fd.get("line")
        return _esc(f"{fd['file']}:{line}" if line else fd["file"])
    return _esc(fd.get("ac_ref") or fd.get("evidence_ref") or "")


def _finding_li(packet, fd, resolved):
    sev = _esc(fd.get("severity", "?"))
    # Bug fix: the real text lives in `rationale` (was read as `message`, absent).
    text = _esc(fd.get("rationale") or fd.get("message") or fd.get("concern")
                or packet.get("summary", ""))
    ref = _finding_ref(fd)
    cls = "find resolved" if resolved else "find open"
    tag = "✓ resolvido" if resolved else "aberto"
    ref_html = f" <em>({ref})</em>" if ref else ""
    sev_lbl = _SEV_PT.get(fd.get("severity", ""), sev)
    return (f"<li class='{cls}'><span class='sev sev-{sev}'>{sev_lbl} · {tag}</span> "
            f"{text}{ref_html}</li>")


def _render_diff(diff_text):
    """Render a unified diff GitHub-style: colored add/del lines, hunk + meta headers."""
    rows = []
    for ln in diff_text.split("\n"):
        if ln.startswith(("diff --git", "index ", "--- ", "+++ ",
                          "new file", "deleted file", "rename ", "similarity ")):
            cls = "d-meta"
        elif ln.startswith("@@"):
            cls = "d-hunk"
        elif ln.startswith("+"):
            cls = "d-add"
        elif ln.startswith("-"):
            cls = "d-del"
        else:
            cls = "d-ctx"
        rows.append(f"<div class='dl {cls}'>{_esc(ln) or '&nbsp;'}</div>")
    return f"<div class='ghdiff'>{''.join(rows)}</div>"


# --- sections ---------------------------------------------------------------

def _dashboard(rep, task_verdicts, open_count, ac_count):
    total = len(task_verdicts)
    done = sum(1 for v in task_verdicts if v == "done")
    needs = sum(1 for v in task_verdicts if v == "needs_review")
    bad = total - done - needs
    ok = total and done == total and open_count == 0
    verdict = "✓ Pronto" if ok else f"⚠ {total - done} pendente(s)"
    vclass = "verdict-ok" if ok else "verdict-warn"
    donut = _donut_svg([("#2e9e2e", done), ("#e0b000", needs), ("#cc3b3b", bad)], total)
    open_lbl = f"{open_count} achado aberto" if open_count == 1 else f"{open_count} achados abertos"
    cost_warn = ("" if rep["complete"]
                 else "<div class='legend warn'>⚠ custo incompleto</div>")
    return (
        "<section class='dash'>"
        f"<div class='kpi'><div class='lbl'>Veredito</div>"
        f"<div class='big {vclass}'>{verdict}</div>"
        f"<div class='legend'>{done}/{total} concluídas · {bad} bloqueada/escalada · {open_lbl}</div></div>"
        f"<div class='kpi'><div class='lbl'>Status das tarefas</div>"
        f"<div class='donutwrap'>{donut}<div class='legend'>🟢 {done} concluídas<br>"
        f"🟡 {needs} requer revisão<br>🔴 {bad} bloqueada/escalada</div></div></div>"
        f"<div class='kpi'><div class='lbl'>Custo · ${rep['total_cost_usd']:.2f}</div>"
        f"{_cost_bar(rep)}"
        f"<div class='legend'>🔵 planejamento ${rep['planning_cost_usd']:.2f} · "
        f"🔷 orquestração ${rep['orchestration_cost_usd']:.2f} · "
        f"🟢 implementação ${rep['implementation_cost_usd']:.2f} ({rep['subagent_count']} subagentes)</div>"
        f"{cost_warn}</div>"
        f"<div class='kpi'><div class='lbl'>Achados · cobertura de AC</div>"
        f"<div class='big'>{open_count} <span class='unit'>abertos</span></div>"
        f"<div class='legend'>{ac_count} ACs cobertos pelo qa</div></div>"
        "</section>")


def _integrity_section(pipeline_packets):
    if not pipeline_packets:
        return ""
    rows = []
    for p in sorted(pipeline_packets, key=lambda p: p.get("dispatch_id", "")):
        role = _esc(p.get("role", "?"))
        status = p.get("status", "?")
        status_lbl = _STATUS_PT.get(status, status)
        summary = _esc(p.get("summary", ""))
        rows.append(f"<div class='intg-row'><span class='st st-{_esc(status)}'>{role}: "
                    f"{_esc(status_lbl)}</span> {summary}</div>")
    return ("<section><h2>Integridade do pipeline</h2>"
            f"<div class='intg'>{''.join(rows)}</div></section>")


def _task_card(task_id, packets, diff_provider):
    verdict = _task_verdict(packets)
    badge = {"done": "b-done", "needs_review": "b-rev",
             "blocked": "b-block", "escalate": "b-block"}.get(verdict, "b-rev")
    by_role = _loops_by_role(packets)
    devs = by_role.get("dev", [])
    title = _esc(devs[0].get("summary", "")) if devs else "(sem descrição)"
    files = sorted({f for p in devs for f in (p.get("files_changed") or [])})
    # Header shows basenames (compact); full paths stay in the title/hover + diff.
    files_lbl = _esc(", ".join(f.rsplit("/", 1)[-1] for f in files)) if files else ""
    files_full = _esc(", ".join(files))

    resolved, open_ = _split_findings(packets)
    finds = "".join(_finding_li(p, fd, True) for p, fd in resolved)
    finds += "".join(_finding_li(p, fd, False) for p, fd in open_)
    finds_html = f"<ul class='findings'>{finds}</ul>" if finds else ""

    diff_html = ""
    if diff_provider and files:
        try:
            diff = diff_provider(files)
        except Exception:
            diff = ""
        if diff:
            diff_html = (f"<details class='diff'><summary>▸ Ver alterações ({len(files)} arquivo(s))"
                         f"</summary>{_render_diff(diff)}</details>")

    acs = {}
    for p in by_role.get("qa", []):
        acs.update(p.get("ac_coverage") or {})
    ac_html = (f"<div class='ac'>✓ {_esc(' · '.join(sorted(acs.keys())))} validados por qa</div>"
               if acs else "")

    open_flag = " open" if verdict != "done" else ""
    return (
        f"<details class='task'{open_flag}>"
        f"<summary><span class='tid'>{_esc(task_id)}</span>"
        f"<span class='badge {badge}'>{_esc(_STATUS_PT.get(verdict, verdict))}</span>"
        f"<span class='ttl' title='{title}'>{title}</span>"
        f"<span class='files' title='{files_full}'>{files_lbl}</span></summary>"
        f"<div class='body'>"
        f"<div class='narrative'>📖 {_narrative(packets)}</div>"
        f"{_timeline(packets)}{finds_html}{diff_html}{ac_html}"
        "</div></details>")


def _handoff_section(session_dir):
    hf = session_dir / "handoff.md"
    if not hf.exists():
        return ""
    try:
        text = hf.read_text(encoding="utf-8")
    except OSError:
        return ""
    return ("<section><details class='handoff'><summary>Repasse (handoff)</summary>"
            f"<pre>{_esc(text)}</pre></details></section>")


_CSS = """
html{color-scheme:light;background:#fff}
body{font:14px/1.6 -apple-system,Segoe UI,sans-serif;margin:2rem auto;max-width:980px;color:#1a1a1a;background:#fff;padding:0 1rem}
h1{font-size:1.4rem;margin:0 0 2px} .sub{color:#777;font-size:.85rem;margin-bottom:18px}
h2{font-size:1.05rem;border-bottom:1px solid #ddd;padding-bottom:.3rem;margin-top:2rem}
.dash{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}
.kpi{border:1px solid #e8e8e8;border-radius:10px;padding:14px;background:#fafafa}
.kpi .lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;color:#888;font-weight:700}
.kpi .big{font-size:1.5rem;font-weight:800;line-height:1.15;margin-top:6px}
.kpi .unit{font-size:.8rem;font-weight:600;color:#888} .legend{font-size:.72rem;color:#666;margin-top:6px}
.legend.warn{color:#b00;font-weight:700} .verdict-ok{color:#127a12} .verdict-warn{color:#b00}
.donutwrap{display:flex;align-items:center;gap:12px;margin-top:6px}
.bar{height:9px;border-radius:5px;background:#eee;overflow:hidden;display:flex;margin-top:8px}
.bar i{display:block;height:100%}
.intg{font-size:.82rem} .intg-row{padding:5px 0;border-bottom:1px solid #f0f0f0}
.intg .st{font-weight:700;margin-right:6px}
.task{border:1px solid #e0e0e0;border-radius:9px;margin:11px 0;overflow:hidden}
.task>summary{list-style:none;cursor:pointer;padding:12px 14px;display:flex;align-items:center;gap:11px;background:#fcfcfc}
.task>summary::-webkit-details-marker{display:none}
.task[open]>summary{border-bottom:1px solid #eee}
.tid{font-weight:800;font-size:.92rem;flex-shrink:0}
.ttl{flex:1;min-width:0;color:#333;font-size:.86rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.files{font-size:.72rem;color:#999;flex-shrink:0;max-width:28%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.badge{font-size:.64rem;font-weight:800;text-transform:uppercase;padding:3px 8px;border-radius:11px;white-space:nowrap}
.b-done{background:#dcf2dc;color:#127a12} .b-rev{background:#fff3cd;color:#8a6d00} .b-block{background:#fde0e0;color:#b00}
.body{padding:13px 15px}
.narrative{background:#f0f6ff;border-left:3px solid #3b6fcc;padding:8px 11px;border-radius:6px;font-size:.84rem;margin-bottom:12px}
.timeline{display:flex;align-items:center;flex-wrap:wrap;margin:4px 0 14px}
.node{display:flex;flex-direction:column;align-items:center;font-size:.66rem;color:#555;min-width:58px;gap:3px}
.dot{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:.72rem;font-weight:700}
.d-ok{background:#2e9e2e} .d-bad{background:#cc3b3b} .d-dev{background:#3b6fcc}
.conn{height:2px;width:16px;background:#ccc;margin-bottom:16px}
.findings{list-style:none;margin:0;padding:0}
.find{font-size:.8rem;margin:6px 0;padding:7px 10px;border-radius:6px;background:#f7f7f7;border-left:3px solid #ccc}
.find.resolved{opacity:.65;border-left-color:#2e9e2e} .find.open{border-left-color:#cc3b3b;background:#fdf3f3}
.sev{font-weight:800;font-size:.62rem;text-transform:uppercase;padding:1px 6px;border-radius:3px;margin-right:6px}
.sev-error,.sev-blocker,.sev-critical{background:#fde0e0;color:#b00}
.sev-warning,.sev-major{background:#fff3cd;color:#8a6d00} .sev-minor,.sev-info{background:#eee;color:#666}
.ac{font-size:.74rem;color:#127a12;margin-top:10px}
details.diff{margin-top:10px} details.diff summary{cursor:pointer;font-size:.76rem;color:#3b6fcc;font-weight:600}
.ghdiff{font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:1px solid #d0d7de;border-radius:6px;overflow:auto;margin-top:8px;background:#fff}
.dl{padding:0 10px;white-space:pre;border-left:3px solid transparent}
.d-add{background:#e6ffec;border-left-color:#2da44e} .d-del{background:#ffebe9;border-left-color:#cf222e}
.d-hunk{background:#ddf4ff;color:#0550ae} .d-meta{background:#f6f8fa;color:#57606a;font-weight:600}
.d-ctx{background:#fff;color:#1a1a1a}
details.handoff summary{cursor:pointer;font-weight:600}
.st-done{color:#127a12} .st-blocked,.st-needs_review,.st-escalate{color:#b00}
pre{background:#f7f7f7;padding:9px;border-radius:6px;font-size:11px;overflow:auto}
"""


def build_html_report(session_dir, task_id="", diff_provider=None):
    """Return an HTML string, or None if no pipeline cost data exists (guard)."""
    session_dir = Path(session_dir)
    if not (session_dir / "costs").is_dir():
        return None
    task_id = task_id or session_dir.name
    rep = cost_report.build_cost_report(session_dir)
    packets = _load_packets(session_dir)

    # Route by role semantics, not by an optional field: pipeline-scoped roles
    # go to the integrity band; everything else is task content (grouped by
    # task_id, falling back to the dispatch_id's T-XXX so no review is lost).
    by_task, pipeline = {}, []
    for p in packets:
        if p.get("role") in _PIPELINE_ROLES:
            pipeline.append(p)
            continue
        tid = p.get("task_id") or _task_from_dispatch(p.get("dispatch_id")) or "(sem task_id)"
        by_task.setdefault(tid, []).append(p)

    verdicts = {tid: _task_verdict(ps) for tid, ps in by_task.items()}
    open_count = sum(len(_split_findings(ps)[1]) for ps in by_task.values())
    ac_keys = set()
    for ps in by_task.values():
        for p in ps:
            if p.get("role") == "qa":
                ac_keys.update((p.get("ac_coverage") or {}).keys())

    # Cards ordered by attention: escalate/blocked/needs_review first, then done.
    order = sorted(by_task, key=lambda t: (_STATUS_RANK.get(verdicts[t], 2), t))
    cards = "".join(_task_card(t, by_task[t], diff_provider) for t in order)

    parts = [
        f"<!DOCTYPE html><html lang='pt-BR'><head><meta charset='utf-8'>"
        f"<title>Relatório da sessão — {_esc(task_id)}</title><style>{_CSS}</style></head><body>",
        f"<h1>Relatório da sessão — {_esc(task_id)}</h1>",
        f"<div class='sub'>{len(by_task)} tarefas · {rep['subagent_count']} subagentes · "
        f"Fase 4 (Implementação)</div>",
        _dashboard(rep, list(verdicts.values()), open_count, len(ac_keys)),
        _integrity_section(pipeline),
        "<h2>Tarefas</h2>",
        cards,
        _handoff_section(session_dir),
        "</body></html>",
    ]
    return "".join(parts)
