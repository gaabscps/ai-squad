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
