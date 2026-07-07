"""Forma do observed-session.schema.json — paridade com os árbitros existentes."""
import json
from pathlib import Path

SCHEMA = json.loads((Path(__file__).parent.parent / "observed-session.schema.json").read_text())


def test_required_subset_of_properties():
    assert set(SCHEMA["required"]) <= set(SCHEMA["properties"].keys())


def test_status_enum_canonical():
    assert SCHEMA["properties"]["status"]["enum"] == ["in_progress", "needs_attention", "done", "abandoned"]


def test_discriminator_pinned():
    assert SCHEMA["properties"]["mode"]["const"] == "observed"
    assert SCHEMA["additionalProperties"] is False


def test_session_id_pattern():
    assert SCHEMA["properties"]["session_id"]["pattern"] == r"^OBS-\d{3,}$"


def _minimal_observed():
    return {
        "schema_version": 1, "session_id": "OBS-099", "mode": "observed",
        "intent": "x", "status": "in_progress", "created_at": "2026-07-06T00:00:00Z",
    }


def _validate(doc):
    """Valida doc contra o schema carregado; skip se jsonschema não estiver instalado."""
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    return jsonschema.Draft202012Validator(SCHEMA).iter_errors(doc)


def test_feature_block_registered_in_properties():
    assert "feature" in SCHEMA["properties"]
    feature = SCHEMA["properties"]["feature"]
    assert feature["type"] == "object"
    assert feature["additionalProperties"] is False
    assert set(feature["required"]) == {"id", "name"}
    assert {"id", "key", "name", "jira_snapshot"} <= set(feature["properties"])


def test_feature_block_valid_with_key_and_snapshot():
    doc = _minimal_observed()
    doc["feature"] = {
        "id": "PAY-1234", "key": "PAY-1234", "name": "Export de fatura",
        "jira_snapshot": {"status": "In Progress", "fetched_at": "2026-07-06T00:00:00Z",
                          "url": "https://x.atlassian.net/browse/PAY-1234"},
    }
    assert list(_validate(doc)) == []


def test_feature_block_valid_name_only():
    doc = _minimal_observed()
    doc["feature"] = {"id": "ft-export-de-fatura", "name": "Export de fatura"}
    assert list(_validate(doc)) == []


def test_feature_block_missing_name_fails():
    doc = _minimal_observed()
    doc["feature"] = {"id": "ft-x"}
    assert len(list(_validate(doc))) > 0


def test_feature_block_unknown_prop_fails():
    doc = _minimal_observed()
    doc["feature"] = {"id": "ft-x", "name": "X", "branch": "feat/x"}
    assert len(list(_validate(doc))) > 0
