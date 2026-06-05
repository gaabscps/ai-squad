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
    assert s["additionalProperties"] is False
    props = set(s["properties"])
    assert {"spec_id", "questions", "acceptance_criteria", "verdict", "artifacts"} <= props


def test_delivery_report_confidence_enum():
    s = _load("delivery-report.schema.json")
    q_item = s["properties"]["questions"]["items"]["properties"]
    assert set(q_item["confidence"]["enum"]) == {"recorded", "inferred", "not_recorded"}
    assert set(q_item["key"]["enum"]) == EXPECTED_QUESTION_KEYS


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
