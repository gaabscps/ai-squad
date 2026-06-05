import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import delivery_report  # noqa: E402


def _make_session(tmp_path):
    sdir = tmp_path / ".agent-session" / "FEAT-001"
    (sdir / "outputs").mkdir(parents=True)
    (sdir / "session.yml").write_text(
        "spec_id: FEAT-001\n"
        "squad: sdd\n"
        "feature_name: Bulk import\n"
        "output_locale: pt-BR\n"
        "started_at: 2026-06-05T10:00:00Z\n"
        "escalation_metrics:\n"
        "  total_tasks: 1\n"
        "  done_tasks: 1\n"
        "  pending_human_tasks: 0\n"
        "  escalation_rate: 0.0\n",
        encoding="utf-8",
    )
    (sdir / "tasks.md").write_text(
        "## T-001 — Bulk import\nAC covered: AC-001\n", encoding="utf-8")
    (sdir / "spec.md").write_text(
        "## AC-001\nThe importer accepts a CSV.\n", encoding="utf-8")
    manifest = {
        "spec_id": "FEAT-001",
        "actual_dispatches": [
            {"dispatch_id": "d-T-001-dev-l1", "task_id": "T-001", "role": "dev",
             "status": "done", "review_loop": 1},
            {"dispatch_id": "d-T-001-qa-l1", "task_id": "T-001", "role": "qa",
             "status": "done", "review_loop": 1},
            {"dispatch_id": "d-FEAT-001-audit", "task_id": None, "role": "audit-agent",
             "status": "done", "review_loop": 1},
        ],
    }
    (sdir / "dispatch-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    dev_packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-dev-l1",
        "role": "dev", "status": "done", "summary": "implemented", "evidence": [],
        "usage": None, "files_changed": ["src/import.ts"],
        "decisions": [{"id": "DEC-001", "kind": "decision", "summary": "stream parse",
                       "rationale": "memory", "ref": "src/import.ts:10"}],
    }
    (sdir / "outputs" / "d-T-001-dev-l1.json").write_text(json.dumps(dev_packet), encoding="utf-8")
    qa_packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-qa-l1",
        "role": "qa", "status": "done", "summary": "validated", "evidence": [
            {"id": "e-1", "kind": "test", "ref": "pytest", "ac_ref": "FEAT-001/AC-001"}],
        "usage": None, "ac_coverage": {"FEAT-001/AC-001": ["e-1"]},
    }
    (sdir / "outputs" / "d-T-001-qa-l1.json").write_text(json.dumps(qa_packet), encoding="utf-8")
    audit_packet = {
        "spec_id": "FEAT-001", "dispatch_id": "d-FEAT-001-audit", "role": "audit-agent",
        "status": "done", "summary": "clean", "evidence": [], "usage": None, "findings": [],
    }
    (sdir / "outputs" / "d-FEAT-001-audit.json").write_text(json.dumps(audit_packet), encoding="utf-8")
    return sdir


def test_extract_sdd_builds_facts(tmp_path):
    sdir = _make_session(tmp_path)
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["spec_id"] == "FEAT-001"
    assert facts["squad"] == "sdd"
    assert facts["feature_name"] == "Bulk import"
    assert facts["output_locale"] == "pt-BR"
    assert facts["outcome"] == "success"
    assert [u["id"] for u in facts["work_units"]] == ["T-001"]
    unit = facts["work_units"][0]
    assert unit["files_changed"] == ["src/import.ts"]
    assert unit["decisions"][0]["kind"] == "decision"
    assert unit["ac_coverage"] == {"FEAT-001/AC-001": ["e-1"]}
    assert facts["gate"]["role"] == "audit-agent"
    assert facts["gate"]["status"] == "done"
    assert {ac["id"] for ac in facts["intent"]["acceptance_criteria"]} == {"AC-001"}


def test_outcome_escalated_when_pending_human(tmp_path):
    sdir = _make_session(tmp_path)
    sy = sdir / "session.yml"
    sy.write_text(sy.read_text().replace(
        "  pending_human_tasks: 0", "  pending_human_tasks: 1").replace(
        "  done_tasks: 1", "  done_tasks: 0"), encoding="utf-8")
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["outcome"] in {"escalated", "mixed"}


def test_outcome_refused_when_gate_blocked(tmp_path):
    sdir = _make_session(tmp_path)
    ap = sdir / "outputs" / "d-FEAT-001-audit.json"
    pkt = json.loads(ap.read_text())
    pkt["status"] = "blocked"
    pkt["blocker_kind"] = "bypass_detected"
    ap.write_text(json.dumps(pkt), encoding="utf-8")
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["outcome"] == "refused"
    assert facts["gate"]["status"] == "blocked"


def test_cli_writes_facts_file(tmp_path, capsys):
    sdir = _make_session(tmp_path)
    rc = delivery_report.main([str(sdir)])
    assert rc == 0
    out = (sdir / "delivery-facts.json")
    assert out.exists()
    facts = json.loads(out.read_text())
    assert facts["spec_id"] == "FEAT-001"


def test_unknown_squad_raises(tmp_path):
    sdir = _make_session(tmp_path)
    sy = sdir / "session.yml"
    sy.write_text(sy.read_text().replace("squad: sdd", "squad: discovery"), encoding="utf-8")
    try:
        delivery_report.build_delivery_facts(str(sdir))
        assert False, "expected NotImplementedError for unregistered squad"
    except NotImplementedError as exc:
        assert "discovery" in str(exc)
