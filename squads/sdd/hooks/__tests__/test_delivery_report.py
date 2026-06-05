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
    assert facts["outcome"] == "escalated"


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


def test_outcome_mixed_when_minority_pending(tmp_path):
    sdir = _make_session(tmp_path)
    sy = sdir / "session.yml"
    sy.write_text(sy.read_text().replace(
        "  total_tasks: 1", "  total_tasks: 4").replace(
        "  done_tasks: 1", "  done_tasks: 3").replace(
        "  pending_human_tasks: 0", "  pending_human_tasks: 1"), encoding="utf-8")
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["outcome"] == "mixed"


def test_outcome_not_success_when_gate_absent(tmp_path):
    sdir = _make_session(tmp_path)
    mf = sdir / "dispatch-manifest.json"
    m = json.loads(mf.read_text())
    m["actual_dispatches"] = [d for d in m["actual_dispatches"] if d["role"] != "audit-agent"]
    mf.write_text(json.dumps(m), encoding="utf-8")
    (sdir / "outputs" / "d-FEAT-001-audit.json").unlink()
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["gate"]["status"] == "absent"
    assert facts["outcome"] == "mixed"


def test_final_status_falls_back_to_manifest_when_packet_missing(tmp_path):
    sdir = _make_session(tmp_path)
    (sdir / "outputs" / "d-T-001-dev-l1.json").unlink()
    (sdir / "outputs" / "d-T-001-qa-l1.json").unlink()
    facts = delivery_report.build_delivery_facts(str(sdir))
    unit = facts["work_units"][0]
    assert unit["final_status"] == "done"


def test_runs_as_standalone_script(tmp_path):
    """The chronicler invokes the extractor as a standalone script. shared/lib's
    warnings.py shadows stdlib `warnings` (which pathlib imports), so a naive
    `from pathlib import Path` crashes with a circular import when run that way.
    Regression guard: run via subprocess (fresh interpreter, pathlib not preloaded).
    """
    import subprocess

    sdir = _make_session(tmp_path)
    script = Path(__file__).resolve().parents[1] / "delivery_report.py"
    r = subprocess.run(
        [sys.executable, str(script), str(sdir)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, r.stderr
    assert (sdir / "delivery-facts.json").exists()


def test_escalation_enriched_with_blocker_kind_and_memo(tmp_path):
    sdir = _make_session(tmp_path)
    mf = sdir / "dispatch-manifest.json"
    m = json.loads(mf.read_text())
    m["actual_dispatches"].append(
        {"dispatch_id": "d-T-001-blocker-l1", "task_id": "T-001",
         "role": "blocker-specialist", "status": "escalate", "review_loop": 1})
    mf.write_text(json.dumps(m), encoding="utf-8")
    blk = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-blocker-l1",
        "role": "blocker-specialist", "status": "escalate", "blocker_kind": "insufficient_data",
        "summary": "needs human", "usage": None,
        "evidence": [{"id": "m-1", "kind": "file",
                      "ref": ".agent-session/FEAT-001/decisions/lock-2026.md"}],
        "blockers": [{"kind": "insufficient_data", "summary": "spec silent"}],
    }
    (sdir / "outputs" / "d-T-001-blocker-l1.json").write_text(json.dumps(blk), encoding="utf-8")
    facts = delivery_report.build_delivery_facts(str(sdir))
    esc = [e for e in facts["escalations"] if e["unit_id"] == "T-001"]
    assert esc, "T-001 should be escalated"
    assert esc[0]["blocker_kind"] == "insufficient_data"
    assert esc[0]["memo_ref"].endswith("decisions/lock-2026.md")
    assert esc[0]["summary"] == "needs human"
