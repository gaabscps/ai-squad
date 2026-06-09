import json
from pathlib import Path

SCHEMAS = Path(__file__).resolve().parents[1]


def _load(name):
    return json.loads((SCHEMAS / name).read_text(encoding="utf-8"))


VALID = {
    "spec_id": "FEAT-042",
    "generated_for": {"feature_summary": "exportar relatório em CSV",
                      "touched_areas": ["src/reports"]},
    "existing_code": [
        {"kind": "util", "ref": "src/utils/csv.ts:8",
         "what": "serializa linhas para CSV", "relevance": "reúso direto p/ AC-002"}
    ],
    "boundaries": [
        {"area": "src/utils", "scope": "global", "note": "compartilhado; não duplicar local"}
    ],
    "applicable_rules": [
        {"rule": "anti-abstracao", "source": "CLAUDE.md",
         "directive": "código legível direto; sem camada para <2 call sites"}
    ],
    "notes": "",
}


# --- Structural tests (não precisam de jsonschema, idioma do repo) ---

def test_reuse_map_schema_well_formed():
    s = _load("reuse-map.schema.json")
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    assert {"spec_id", "generated_for", "existing_code",
            "boundaries", "applicable_rules"} <= set(s["required"])


def test_reuse_map_existing_code_kind_enum():
    s = _load("reuse-map.schema.json")
    enum = set(s["properties"]["existing_code"]["items"]["properties"]["kind"]["enum"])
    assert {"util", "handler", "component", "service", "hook", "type", "other"} <= enum


def test_reuse_map_boundary_scope_enum():
    s = _load("reuse-map.schema.json")
    enum = set(s["properties"]["boundaries"]["items"]["properties"]["scope"]["enum"])
    assert enum == {"global", "local"}


# --- Validation tests (guard jsonschema-opcional, idioma do repo) ---

def test_valid_reuse_map_validates():
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    jsonschema.validate(VALID, _load("reuse-map.schema.json"))


def test_missing_required_field_fails():
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    s = _load("reuse-map.schema.json")
    bad = json.loads(json.dumps(VALID))
    del bad["existing_code"]
    try:
        jsonschema.validate(bad, s)
        assert False, "esperava ValidationError"
    except jsonschema.ValidationError:
        pass


def test_bad_kind_enum_fails():
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    s = _load("reuse-map.schema.json")
    bad = json.loads(json.dumps(VALID))
    bad["existing_code"][0]["kind"] = "banana"
    try:
        jsonschema.validate(bad, s)
        assert False, "esperava ValidationError"
    except jsonschema.ValidationError:
        pass


def test_bad_scope_enum_fails():
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    s = _load("reuse-map.schema.json")
    bad = json.loads(json.dumps(VALID))
    bad["boundaries"][0]["scope"] = "regional"
    try:
        jsonschema.validate(bad, s)
        assert False, "esperava ValidationError"
    except jsonschema.ValidationError:
        pass
