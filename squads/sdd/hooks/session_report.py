"""Render an HTML session report (cost + code review) from .agent-session/<FEAT>/.

Pure stdlib. Lives in the hooks dir so it deploys per-repo and can import its
sibling cost_report module in any consumer repo.
"""
import html
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cost_report  # noqa: E402

_SEV_ORDER = {"error": 0, "blocker": 0, "warning": 1, "major": 1, "info": 2}


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


def _esc(x):
    return html.escape(str(x), quote=True)


def _cost_section(rep):
    rows = [
        ("Planning (spec/design/tasks)", rep["planning_cost_usd"]),
        ("Orchestration (Phase 4 driver)", rep["orchestration_cost_usd"]),
        (f"Implementation ({rep['subagent_count']} subagents)", rep["implementation_cost_usd"]),
    ]
    body = "".join(f"<tr><td>{_esc(label)}</td><td class='num'>${v:.4f}</td></tr>" for label, v in rows)
    body += f"<tr class='total'><td>Total</td><td class='num'>${rep['total_cost_usd']:.4f}</td></tr>"
    warn = ""
    if not rep["complete"]:
        warn = f"<p class='warn'>⚠ Cost incomplete — unpriced/uncaptured: {_esc(', '.join(rep['unpriced_models']))}</p>"
    return f"<section><h2>Cost</h2><table class='cost'>{body}</table>{warn}</section>"


def _findings_html(findings):
    if not findings:
        return ""
    items = []
    for fd in sorted(findings, key=lambda d: _SEV_ORDER.get(d.get("severity", "info"), 3)):
        sev = _esc(fd.get("severity", "?"))
        msg = _esc(fd.get("message", ""))
        ref = _esc(fd.get("ac_ref", "")) or _esc(fd.get("evidence_ref", ""))
        fix = _esc(fd.get("suggested_fix", ""))
        extra = f" <em>({ref})</em>" if ref else ""
        fixln = f"<div class='fix'>fix: {fix}</div>" if fix else ""
        items.append(f"<li><span class='sev sev-{sev}'>{sev}</span> {msg}{extra}{fixln}</li>")
    return f"<ul class='findings'>{''.join(items)}</ul>"


def _review_section(packets, session_dir, diff_provider):
    rows = []
    dev_files = []
    for p in packets:
        role = _esc(p.get("role", "?"))
        status = _esc(p.get("status", "?"))
        did = _esc(p.get("dispatch_id", ""))
        summary = _esc(p.get("summary", ""))
        files = p.get("files_changed") or []
        if p.get("role") == "dev":
            dev_files.extend(files)
        files_html = "<br>".join(_esc(f) for f in files)
        acs = p.get("ac_coverage") or {}
        ac_html = "<br>".join(_esc(k) for k in acs.keys())
        rows.append(
            f"<tr><td>{role}</td><td>{did}</td><td class='st st-{status}'>{status}</td>"
            f"<td>{summary}</td><td>{files_html}</td><td>{ac_html}</td></tr>"
            + (f"<tr class='find-row'><td colspan='6'>{_findings_html(p.get('findings'))}</td></tr>"
               if p.get("findings") else "")
        )
    table = (
        "<table class='review'><thead><tr><th>Role</th><th>Dispatch</th><th>Status</th>"
        "<th>Summary</th><th>Files</th><th>AC coverage</th></tr></thead>"
        f"<tbody>{''.join(rows)}</tbody></table>"
    )
    diff_html = ""
    if diff_provider and dev_files:
        try:
            diff = diff_provider(sorted(set(dev_files)))
        except Exception:
            diff = ""
        if diff:
            diff_html = f"<h3>Diff</h3><pre class='diff'>{_esc(diff)}</pre>"
    return f"<section><h2>Code review</h2>{table}{diff_html}</section>"


def _handoff_section(session_dir):
    hf = session_dir / "handoff.md"
    if not hf.exists():
        return ""
    try:
        text = hf.read_text(encoding="utf-8")
    except OSError:
        return ""
    return f"<section><h2>Handoff</h2><pre class='handoff'>{_esc(text)}</pre></section>"


_CSS = """
body{font:14px/1.5 -apple-system,Segoe UI,sans-serif;margin:2rem auto;max-width:1000px;color:#1a1a1a}
h1{font-size:1.4rem} h2{font-size:1.1rem;border-bottom:1px solid #ddd;padding-bottom:.3rem;margin-top:2rem}
table{border-collapse:collapse;width:100%;margin:.5rem 0} th,td{border:1px solid #e0e0e0;padding:.4rem .6rem;text-align:left;vertical-align:top}
th{background:#f5f5f5} .num{text-align:right;font-variant-numeric:tabular-nums} .total td{font-weight:700;background:#fafafa}
.cost{max-width:480px} .warn{color:#b00} .findings{margin:0;padding-left:1rem}
.sev{font-weight:700;text-transform:uppercase;font-size:.75rem;padding:.1rem .3rem;border-radius:3px}
.sev-error,.sev-blocker{background:#fde0e0;color:#b00} .sev-warning,.sev-major{background:#fff3cd;color:#8a6d00}
.st{font-weight:600} .st-done{color:#127a12} .st-blocked,.st-needs_changes{color:#b00}
.fix{color:#555;font-size:.85rem} pre.diff,pre.handoff{background:#f7f7f7;padding:.8rem;overflow:auto;font-size:12px}
"""


def build_html_report(session_dir, task_id="", diff_provider=None):
    """Return an HTML string, or None if no pipeline cost data exists (guard)."""
    session_dir = Path(session_dir)
    if not (session_dir / "costs").is_dir():
        return None
    task_id = task_id or session_dir.name
    rep = cost_report.build_cost_report(session_dir)
    packets = _load_packets(session_dir)
    parts = [
        f"<!DOCTYPE html><html lang='en'><head><meta charset='utf-8'>"
        f"<title>ai-squad report — {_esc(task_id)}</title><style>{_CSS}</style></head><body>",
        f"<h1>Session report — {_esc(task_id)}</h1>",
        _cost_section(rep),
        _review_section(packets, session_dir, diff_provider),
        _handoff_section(session_dir),
        "</body></html>",
    ]
    return "".join(parts)
