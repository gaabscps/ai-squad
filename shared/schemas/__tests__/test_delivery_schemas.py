import json
from pathlib import Path

SCHEMAS = Path(__file__).resolve().parents[1]


def _load(name):
    return json.loads((SCHEMAS / name).read_text(encoding="utf-8"))


def test_output_packet_role_enum_includes_chronicler():
    s = _load("output-packet.schema.json")
    assert "chronicler" in s["properties"]["role"]["enum"]


def test_output_packet_has_dev_decisions_field():
    s = _load("output-packet.schema.json")
    dec = s["properties"]["decisions"]
    assert dec["type"] == "array"
    item = dec["items"]
    assert set(item["required"]) == {"id", "kind", "summary", "rationale"}
    assert set(item["properties"]["kind"]["enum"]) == {"decision", "deviation"}


def test_delivery_facts_schema_well_formed():
    s = _load("delivery-facts.schema.json")
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    props = set(s["properties"])
    assert {"spec_id", "squad", "feature_name", "outcome", "intent",
            "work_units", "escalations", "gate", "cost", "timeline"} <= props


def test_delivery_facts_outcome_enum():
    s = _load("delivery-facts.schema.json")
    assert set(s["properties"]["outcome"]["enum"]) == {
        "success", "mixed", "escalated", "refused"}


def test_delivery_facts_work_unit_shape():
    s = _load("delivery-facts.schema.json")
    wu = s["properties"]["work_units"]["items"]["properties"]
    assert {"id", "final_status", "dispatches", "decisions",
            "findings", "ac_coverage", "files_changed"} <= set(wu)


EXPECTED_QUESTION_KEYS = {
    "what_was_done", "how_it_was_done", "why_this_way", "deviations_from_plan",
    "acceptance_criteria", "evidence", "impacts", "out_of_scope",
    "risks_and_pending", "how_to_validate", "final_verdict",
}


def test_delivery_report_schema_well_formed():
    s = _load("delivery-report.schema.json")
    # Top-level tolerates traceability extras (LLM-authored) but requires the core 4.
    assert s["additionalProperties"] is True
    assert set(s["required"]) == {"spec_id", "answers", "acceptance_criteria", "verdict"}


def test_delivery_report_answers_keyed_by_11_questions():
    s = _load("delivery-report.schema.json")
    answers = s["properties"]["answers"]
    # answers is a map keyed by the 11 question keys; all must be present.
    assert answers["additionalProperties"] is False
    assert set(answers["required"]) == EXPECTED_QUESTION_KEYS
    assert set(answers["properties"]) == EXPECTED_QUESTION_KEYS


def test_delivery_report_confidence_enum():
    s = _load("delivery-report.schema.json")
    ans = s["$defs"]["answer"]["properties"]
    assert set(ans["confidence"]["enum"]) == {"recorded", "inferred", "not_recorded"}
    assert set(s["$defs"]["answer"]["required"]) == {"answer", "confidence"}


def test_delivery_report_ac_classification_enum():
    s = _load("delivery-report.schema.json")
    ac = s["properties"]["acceptance_criteria"]["items"]["properties"]
    assert set(ac["classification"]["enum"]) == {
        "met", "partially_met", "not_met", "not_validated"}


def test_delivery_report_verdict_enum():
    s = _load("delivery-report.schema.json")
    v = s["properties"]["verdict"]["properties"]["value"]["enum"]
    assert set(v) == {"approved", "approved_with_caveats", "needs_changes",
                      "blocked", "needs_human_review"}


def test_canonical_report_example_validates_against_schema():
    """A delivery-report in the chronicler's natural shape (answers map +
    traceability fields) must validate — guards contract drift vs the real agent."""
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    s = _load("delivery-report.schema.json")

    def ans():
        return {"answer": "prosa", "confidence": "recorded", "evidence_refs": ["outputs/d-x.json"]}

    report = {
        "schema_version": 1, "spec_id": "FEAT-011", "squad": "sdd",
        "feature_name": "x", "output_locale": "pt-BR",
        "generated_at": "2026-06-07T14:07:00Z",
        "dispatch_id": "d-chronicler-1", "gate_dispatch_id": "d-audit-2",
        "answers": {k: ans() for k in EXPECTED_QUESTION_KEYS},
        "acceptance_criteria": [
            {"id": "AC-001", "description": "x", "classification": "met",
             "evidence_refs": ["e1"]}],
        "verdict": {"value": "approved_with_caveats", "rationale": "x",
                    "evidence_refs": ["e1"]},
    }
    jsonschema.validate(report, s)

    # Missing one of the 11 answer keys must FAIL (completeness is enforced).
    bad = json.loads(json.dumps(report))
    del bad["answers"]["impacts"]
    try:
        jsonschema.validate(bad, s)
        assert False, "should reject answers missing a question key"
    except jsonschema.ValidationError:
        pass
