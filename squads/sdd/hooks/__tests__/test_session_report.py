import importlib.util
import json
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("session_report", str(_HOOKS / "session_report.py"))
sr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sr)


def _seed(session_dir):
    costs = session_dir / "costs"
    costs.mkdir(parents=True)
    (costs / "session-s.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 1.5, "unpriced_models": []},
        "orchestration": {"total_cost_usd": 0.5, "unpriced_models": []}}))
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "agent_id": "a", "unpriced_models": []}))
    outputs = session_dir / "outputs"
    outputs.mkdir()
    (outputs / "dev-1.json").write_text(json.dumps({
        "dispatch_id": "dev-1", "role": "dev", "status": "done",
        "summary": "implemented reset flow", "files_changed": ["src/reset.py"]}))
    (outputs / "qa-1.json").write_text(json.dumps({
        "dispatch_id": "qa-1", "role": "qa", "status": "done",
        "summary": "validated",
        "findings": [{"severity": "error", "message": "off-by-one in <script>alert(1)</script>",
                      "ac_ref": "FEAT-001/AC-003"}],
        "ac_coverage": {"FEAT-001/AC-001": ["EV-1"], "FEAT-001/AC-003": ["EV-4"]}}))
    (session_dir / "handoff.md").write_text("verdict: done\nAll tasks complete.")


def test_html_includes_cost_and_review(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    html = sr.build_html_report(sd, task_id="FEAT-001")
    assert "FEAT-001" in html
    assert "4.0" in html or "4.00" in html or "$4" in html  # total cost = 1.5+0.5+2.0
    assert "src/reset.py" in html        # dev files changed
    assert "FEAT-001/AC-003" in html     # AC coverage / finding ref
    assert "<html" in html.lower()


def test_finding_content_is_html_escaped(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    html = sr.build_html_report(sd, task_id="FEAT-001")
    # the malicious finding text must be escaped, not rendered as a live tag
    assert "<script>alert(1)</script>" not in html
    assert "&lt;script&gt;" in html


def test_diff_provider_embedded(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    html = sr.build_html_report(sd, task_id="FEAT-001",
                                diff_provider=lambda files: "diff --git a/src/reset.py ...")
    assert "diff --git a/src/reset.py" in html


def test_missing_costs_returns_none(tmp_path):
    sd = tmp_path / ".agent-session" / "FEAT-002"  # no costs/ dir
    sd.mkdir(parents=True)
    assert sr.build_html_report(sd, task_id="FEAT-002") is None


def test_findings_as_dict_does_not_crash(tmp_path):
    # Some packets emit `findings` as a name-keyed DICT instead of the canonical
    # list (a T-001 fact-finding dev did this). `for fd in findings` then
    # iterates the string KEYS and `fd.get` blew up — crashing the report and,
    # because generate-session-report is fail-open, leaving a stale report.html.
    sd = tmp_path / ".agent-session" / "FEAT-001"
    _seed(sd)
    (sd / "outputs" / "dev-fact.json").write_text(json.dumps({
        "dispatch_id": "dev-2", "role": "dev", "status": "needs_review",
        "task_id": "T-009", "summary": "fact-finding",
        "findings": {
            "discrepancy": {"severity": "high", "rationale": "id mismatch"},
            "raw_data": {"id": "anya", "profession": "farmer"},  # no severity
        }}))
    html = sr.build_html_report(sd, task_id="FEAT-001")  # must not raise
    assert "<html" in html.lower()
    assert "id mismatch" in html       # dict-keyed finding still surfaced


def test_split_findings_normalizes_dict(tmp_path):
    # Unit-level: a dict `findings` is normalized to its dict values; string
    # keys / non-dict entries are dropped, never iterated as findings.
    pkt = {"dispatch_id": "d-l1", "role": "logic-reviewer",
           "findings": {"a": {"severity": "low", "rationale": "x"}, "b": "junk-string"}}
    resolved, open_ = sr._split_findings([pkt])
    flat = [fd for _, fd in resolved + open_]
    assert all(isinstance(fd, dict) for fd in flat)   # no bare strings
    assert {"severity": "low", "rationale": "x"} in flat
    assert "junk-string" not in flat
