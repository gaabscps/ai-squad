import json
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "session.schema.json"

# Conjunto canônico de fases (espelha shared/concepts/session.md "The paused state").
CANONICAL_PHASES = {
    "specify", "plan", "tasks", "implementation", "paused", "done", "escalated",
}
# Os 5 campos que a "Complete schema" da session.md omitia (motivo desta spec).
PREVIOUSLY_MISSING = {
    "implementation_sessions", "auto_approved_by", "pm_cost_cap_usd",
    "pipeline_mode", "audit_override",
}
NOTES_KINDS = {"pm_decision", "pm_escalation", "audit_override"}


def _schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_schema_is_valid_json_and_well_formed():
    s = _schema()
    assert s["$schema"].startswith("https://json-schema.org/draft/2020-12")
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    # required ⊆ properties
    assert set(s["required"]).issubset(set(s["properties"]))


def test_current_phase_enum_matches_canonical_set():
    s = _schema()
    assert set(s["properties"]["current_phase"]["enum"]) == CANONICAL_PHASES


def test_previously_missing_fields_are_present():
    s = _schema()
    props = set(s["properties"])
    # audit_override é um kind de notes, não top-level: checado separado abaixo.
    assert PREVIOUSLY_MISSING - {"audit_override"} <= props


def test_task_states_use_real_loop_counters():
    # Conserta o bug do consumidor que lia 'loops'; o contrato expõe os reais.
    s = _schema()
    ts_item = s["properties"]["task_states"]["additionalProperties"]["properties"]
    for f in ("review_loops", "qa_loops", "blocker_calls", "packet_retries"):
        assert f in ts_item, f"task_states deve documentar {f}"


def test_no_top_level_audit_exception_field():
    # O consumidor lia audit_exception (inexistente); auditoria vive em notes.
    s = _schema()
    assert "audit_exception" not in s["properties"]


def _notes_kinds_from_schema(s):
    branches = s["properties"]["notes"]["items"]["oneOf"]
    return {b["properties"]["kind"]["const"] for b in branches}


def test_notes_is_discriminated_union_by_kind():
    s = _schema()
    notes = s["properties"]["notes"]
    assert notes["type"] == "array"
    assert _notes_kinds_from_schema(s) == NOTES_KINDS
    # cada branch é objeto fechado, com kind+timestamp obrigatórios
    for b in notes["items"]["oneOf"]:
        assert b["additionalProperties"] is False
        assert {"kind", "timestamp"} <= set(b["required"])


def test_audit_override_branch_carries_kind_and_fields():
    s = _schema()
    branch = next(
        b for b in s["properties"]["notes"]["items"]["oneOf"]
        if b["properties"]["kind"]["const"] == "audit_override"
    )
    for f in ("kind", "timestamp", "path", "authorized_by", "audit_dispatch_id"):
        assert f in branch["properties"], f"audit_override deve ter {f}"


def _notes_contract_valid(notes, schema):
    """Validador mínimo schema-driven: notes é lista de objetos com kind permitido."""
    if not isinstance(notes, list):
        return False
    allowed = _notes_kinds_from_schema(schema)
    return all(isinstance(n, dict) and n.get("kind") in allowed for n in notes)


def test_notes_as_string_is_rejected_by_contract():
    s = _schema()
    assert _notes_contract_valid("aprovado na mão pelo PM", s) is False


def test_well_formed_notes_list_is_accepted():
    s = _schema()
    sample = [
        {"kind": "pm_decision", "timestamp": "2026-06-03T10:00:00Z",
         "phase": "specify", "artifact_path": ".agent-session/FEAT-001/spec.md",
         "gate_applied": "auto_approved_by=pm"},
        {"kind": "pm_escalation", "timestamp": "2026-06-03T10:02:00Z",
         "phase": "plan", "artifact_path": ".agent-session/FEAT-001/plan.md",
         "open_questions": ["AC-003 unresolved"]},
        {"kind": "audit_override", "timestamp": "2026-06-03T10:05:00Z",
         "path": "src/x.py", "authorized_by": "human",
         "audit_dispatch_id": "audit-7c2e1a"},
    ]
    assert _notes_contract_valid(sample, s) is True


def test_required_core_fields_present():
    s = _schema()
    assert {"spec_id", "schema_version", "current_phase", "planned_phases"} <= set(s["required"])


def test_pipeline_mode_and_squad_enums_are_valid():
    s = _schema()
    assert set(s["properties"]["pipeline_mode"]["enum"]) == {"standard", "lite"}
    assert set(s["properties"]["squad"]["enum"]) == {"sdd", "discovery"}
