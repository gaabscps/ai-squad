import importlib.util
import json
from pathlib import Path

_HOOK = Path(__file__).resolve().parents[1] / "verify-delivery-report.py"
_spec = importlib.util.spec_from_file_location("verify_delivery_report", _HOOK)
vdr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(vdr)

_KEYS = [
    "what_was_done", "how_it_was_done", "why_this_way", "deviations_from_plan",
    "acceptance_criteria", "evidence", "impacts", "out_of_scope",
    "risks_and_pending", "how_to_validate", "final_verdict",
]


def _valid_report():
    return {
        "schema_version": 1, "spec_id": "FEAT-011", "squad": "sdd",
        "output_locale": "pt-BR", "generated_at": "2026-06-07T14:07:00Z",
        "dispatch_id": "d-chronicler-1", "gate_dispatch_id": "d-audit-2",
        "answers": {k: {"answer": "prosa", "confidence": "recorded",
                        "evidence_refs": ["outputs/d-x.json"]} for k in _KEYS},
        "acceptance_criteria": [
            {"id": "AC-001", "description": "x", "classification": "met",
             "evidence_refs": ["e1"]}],
        "verdict": {"value": "approved_with_caveats", "rationale": "x",
                    "evidence_refs": ["e1"]},
    }


def _write(tmp_path, report):
    p = tmp_path / "delivery-report.json"
    p.write_text(json.dumps(report), encoding="utf-8")
    return p


def test_valid_report_passes(tmp_path):
    ok, reason = vdr.validate_report(_write(tmp_path, _valid_report()))
    assert ok, reason


def test_missing_question_key_fails(tmp_path):
    r = _valid_report()
    del r["answers"]["impacts"]
    ok, reason = vdr.validate_report(_write(tmp_path, r))
    assert not ok and "impacts" in reason


def test_unknown_answer_key_fails(tmp_path):
    r = _valid_report()
    r["answers"]["extra_question"] = {"answer": "x", "confidence": "recorded"}
    ok, reason = vdr.validate_report(_write(tmp_path, r))
    assert not ok and "unknown" in reason


def test_bad_confidence_fails(tmp_path):
    r = _valid_report()
    r["answers"]["evidence"]["confidence"] = "maybe"
    ok, reason = vdr.validate_report(_write(tmp_path, r))
    assert not ok and "confidence" in reason


def test_bad_ac_classification_fails(tmp_path):
    r = _valid_report()
    r["acceptance_criteria"][0]["classification"] = "kinda"
    ok, reason = vdr.validate_report(_write(tmp_path, r))
    assert not ok and "classification" in reason


def test_bad_verdict_value_fails(tmp_path):
    r = _valid_report()
    r["verdict"]["value"] = "shipit"
    ok, reason = vdr.validate_report(_write(tmp_path, r))
    assert not ok and "verdict" in reason


def test_missing_top_level_field_fails(tmp_path):
    r = _valid_report()
    del r["verdict"]
    ok, reason = vdr.validate_report(_write(tmp_path, r))
    assert not ok and "verdict" in reason
