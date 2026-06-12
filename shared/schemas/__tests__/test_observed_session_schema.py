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
