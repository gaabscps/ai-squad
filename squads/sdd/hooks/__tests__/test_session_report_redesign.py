"""Behaviour tests for the redesigned HTML session report.

Tests drive the public API `session_report.build_html_report` and assert on the
rendered HTML's semantic anchors (headings, CSS classes, SVG, text) — never on
internals. Fixtures seed realistic Output Packets + cost files.
"""
import importlib.util
import json
import sys
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
if str(_HOOKS) not in sys.path:
    sys.path.insert(0, str(_HOOKS))
import session_report  # noqa: E402


def _bm(i, o, r, c):
    return {"claude-x": {
        "input_tokens": i, "output_tokens": o, "cache_read_input_tokens": r,
        "cache_creation_input_tokens": c,
        "cost_by_type": {"input": i * 1e-6, "output": o * 1e-6,
                         "cache_read": r * 1e-7, "cache_creation": c * 1.25e-6},
        "cost_usd": 0.0, "messages": 1}}


def _seed_costs(sd):
    (sd / "costs").mkdir(parents=True, exist_ok=True)
    (sd / "costs" / "session.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 1.20, "unpriced_models": [],
                     "by_model": _bm(100000, 40000, 1000000, 60000)},
        "orchestration": {"total_cost_usd": 27.25, "unpriced_models": [],
                          "by_model": _bm(300000, 120000, 4000000, 130000)},
    }))
    (sd / "costs" / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 10.12,
        "agent_id": "a", "unpriced_models": [],
        "by_model": _bm(800000, 500000, 4500000, 200000)}))


def _packet(sd, dispatch_id, **fields):
    out = sd / "outputs"
    out.mkdir(parents=True, exist_ok=True)
    payload = {"spec_id": sd.name, "dispatch_id": dispatch_id,
               "evidence": [], "usage": None, **fields}
    (out / f"{dispatch_id}.json").write_text(json.dumps(payload))


def _seed(sd):
    """Two tasks (one resolved across loops, one left open) + an audit packet."""
    _seed_costs(sd)
    # T-001: reviewer flagged in L1, dev fixed in L2, all green, qa done.
    _packet(sd, "d-T-001-dev-l1", task_id="T-001", role="dev", status="done",
            summary="Criou AbilityCatalog com valores corrigidos e activation hints.",
            files_changed=["AbilityCatalog.java"])
    _packet(sd, "d-T-001-cr-l1", task_id="T-001", role="code-reviewer", status="needs_review",
            summary="Delegação correta; uma violação de cor.",
            findings=[{"id": "f-001", "file": "AbilityCatalog.java", "line": 237,
                       "severity": "minor", "dimension": "style",
                       "rationale": "Hint usa GOLD; deveria ser AQUA por player-facing."}])
    _packet(sd, "d-T-001-dev-l2", task_id="T-001", role="dev", status="done",
            summary="Corrigiu cor do hint para AQUA.", files_changed=["AbilityCatalog.java"])
    _packet(sd, "d-T-001-cr-l2", task_id="T-001", role="code-reviewer", status="done",
            summary="Achado anterior resolvido; sem novos problemas.")
    _packet(sd, "d-T-001-qa-l1", task_id="T-001", role="qa", status="done",
            summary="Todos os ACs passam.",
            ac_coverage={"FEAT-001/AC-001": "passed", "FEAT-001/AC-002": "passed"})
    # T-002: reviewer flagged in L1 and it was NOT resolved (no later loop, ends needs_review).
    _packet(sd, "d-T-002-dev-l1", task_id="T-002", role="dev", status="done",
            summary="Adicionou accessor read-only.", files_changed=["WildCallAbility.java"])
    _packet(sd, "d-T-002-lr-l1", task_id="T-002", role="logic-reviewer", status="needs_review",
            summary="Edge case de partial-failure.",
            findings=[{"id": "f-002", "severity": "major", "dimension": "logic",
                       "ac_ref": "FEAT-001/AC-004",
                       "rationale": "Exceção no loop deixa contador stale; T-007 reporta errado."}])
    # Pipeline-scoped audit (no task_id) -> integrity band, not a task card.
    _packet(sd, "d-audit-l1", role="audit-agent", status="done",
            summary="6/6 checks de reconciliacao passam; sem orchestrator-bypass.")


def _build(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    return session_report.build_html_report(sd, diff_provider=lambda files: "")


def test_guard_returns_none_without_costs(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-009"
    (sd / "outputs").mkdir(parents=True)
    assert session_report.build_html_report(sd, diff_provider=lambda f: "") is None


def test_finding_rationale_is_rendered(tmp_path):
    # Regression: old template read `message` (absent) -> findings showed only severity.
    html = _build(tmp_path)
    assert "Hint usa GOLD; deveria ser AQUA por player-facing." in html


def test_each_task_becomes_a_card(tmp_path):
    html = _build(tmp_path)
    assert "T-001" in html and "T-002" in html
    assert "class='task'" in html or 'class="task"' in html


def test_audit_packet_goes_to_integrity_not_a_card(tmp_path):
    html = _build(tmp_path)
    assert "Pipeline integrity" in html
    assert "6/6 checks de reconciliacao passam" in html


def test_resolved_and_open_findings_are_distinguished(tmp_path):
    html = _build(tmp_path)
    # T-001 finding resolved across loops; T-002 finding still open.
    assert "find resolved" in html
    assert "find open" in html


def test_open_findings_counted_in_dashboard(tmp_path):
    html = _build(tmp_path)
    # exactly one open finding (T-002 f-002) in this fixture
    assert "1 open finding" in html


def test_dashboard_has_verdict_and_svg(tmp_path):
    html = _build(tmp_path)
    assert "Verdict" in html
    assert "<svg" in html


def test_narrative_present_per_task(tmp_path):
    html = _build(tmp_path)
    assert "narrative" in html
    # narrative weaves the dev summary
    assert "Criou AbilityCatalog" in html


def test_timeline_present(tmp_path):
    html = _build(tmp_path)
    assert "timeline" in html


def test_report_is_self_contained_offline(tmp_path):
    html = _build(tmp_path)
    assert "<script src=" not in html
    assert "https://" not in html


def test_fixed_labels_are_english(tmp_path):
    html = _build(tmp_path)
    assert "Session report" in html
    assert "Relatório da sessão" not in html
    assert "Phase 4" in html
    assert "Tasks" in html            # section heading
    assert "done" in html             # verdict badge (canonical English)


_DIFF = (
    "diff --git a/WildCallAbility.java b/WildCallAbility.java\n"
    "index abc1234..def5678 100644\n"
    "--- a/WildCallAbility.java\n"
    "+++ b/WildCallAbility.java\n"
    "@@ -10,3 +10,4 @@ class X {\n"
    "   unchanged line\n"
    "-  int old = 0;\n"
    "+  int neu = 1;\n"
    "+  int extra = 2;\n"
)


def _build_with_diff(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    return session_report.build_html_report(sd, diff_provider=lambda files: _DIFF)


def test_diff_rendered_github_style(tmp_path):
    html = _build_with_diff(tmp_path)
    assert "ghdiff" in html          # styled container, not a raw <pre>
    assert "d-add" in html           # added lines class
    assert "d-del" in html           # removed lines class
    assert "d-hunk" in html          # @@ hunk header class
    assert "d-meta" in html          # diff --git / index / +++ / --- header class
    # added content present and escaped, removed content present
    assert "int neu = 1;" in html
    assert "int old = 0;" in html


def test_token_usage_section_rendered(tmp_path):
    html = _build(tmp_path)
    assert "Token usage" in html
    for col in ("Input", "Output", "Cache read", "Cache creation"):
        assert col in html
    assert "M tokens" in html or "K tokens" in html   # compact total in the cost KPI


def test_fmt_tokens_compact():
    assert session_report.cost_report.fmt_tokens(1_350_000) == "1.4M"
    assert session_report.cost_report.fmt_tokens(775_000) == "775K"
    assert session_report.cost_report.fmt_tokens(500) == "500"
