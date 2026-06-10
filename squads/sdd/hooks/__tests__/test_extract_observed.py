#!/usr/bin/env python3
"""Tests for the `observed` delivery extractor (pivot: observability OS).

A free /observe session has no manifest, no Output Packets, no dispatches —
the recording IS the transcript plus whatever trail the model kept in
session.yml. The extractor must produce valid DeliveryFacts from the WORST
case (model ignored the trail completely): files_changed and commands mined
from the transcript, intent/status from session.yml, decisions/evidence as
enrichment when present.

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_extract_observed.py -v
"""
import importlib.util
import json
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("delivery_report", str(_HOOKS / "delivery_report.py"))
dr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dr)


OBSERVED_YML = """\
schema_version: 1
session_id: OBS-001
mode: observed
intent: "fixar emails importantes na dashboard"
status: done
output_locale: pt-BR
created_at: "2026-06-10T12:00:00Z"
decisions:
  - id: D-001
    what: "reusei wrap() nas rotas"
    why: "padrao do repo"
  - id: D-002
    what: "sem pinInFlight"
    why: "anti-abstracao"
evidence:
  - kind: tests
    cmd: "npx jest"
    result: "92 pass"
"""


def _tool_use(name, **input_):
    return json.dumps({"type": "assistant", "message": {"content": [
        {"type": "tool_use", "name": name, "input": input_}]}})


def _make_session(tmp_path, yml=OBSERVED_YML, with_transcript=True):
    sdir = tmp_path / ".agent-session" / "OBS-001"
    sdir.mkdir(parents=True)
    (sdir / "session.yml").write_text(yml, encoding="utf-8")
    if with_transcript:
        tr = tmp_path / "sess.jsonl"
        tr.write_text("\n".join([
            _tool_use("Write", file_path="src/gmail.ts", content="x"),
            _tool_use("Edit", file_path="src/server.ts", new_string="y"),
            _tool_use("Write", file_path=str(sdir / "session.yml"), content="z"),
            _tool_use("Edit", file_path="src/gmail.ts", new_string="w"),
            _tool_use("Bash", command="npx jest src/gmail.test.ts"),
            _tool_use("Bash", command="ls -la"),
        ]) + "\n", encoding="utf-8")
        costs = sdir / "costs"
        costs.mkdir()
        (costs / "session-abc.json").write_text(json.dumps(
            {"session_id": "abc", "scope": "session", "transcript_path": str(tr)}))
    return sdir


def test_build_delivery_facts_routes_observed_mode(tmp_path):
    sdir = _make_session(tmp_path)
    facts = dr.build_delivery_facts(str(sdir))
    assert facts["squad"] == "observed"
    assert facts["spec_id"] == "OBS-001"


def test_observed_facts_core_fields(tmp_path):
    sdir = _make_session(tmp_path)
    facts = dr.extract_observed(sdir)
    assert facts["feature_name"] == "fixar emails importantes na dashboard"
    assert facts["output_locale"] == "pt-BR"
    assert facts["outcome"] == "success"  # status: done
    assert facts["intent"]["acceptance_criteria"] == []
    assert facts["gate"] == {"role": "human", "status": "done"}
    assert facts["timeline"]["started_at"] == "2026-06-10T12:00:00Z"


def test_observed_mines_transcript_worst_case(tmp_path):
    # Worst case: model kept NO trail — files/commands still come from the recording.
    yml = OBSERVED_YML.split("decisions:")[0]  # drop decisions+evidence blocks
    sdir = _make_session(tmp_path, yml=yml)
    facts = dr.extract_observed(sdir)
    unit = facts["work_units"][0]
    assert unit["files_changed"] == ["src/gmail.ts", "src/server.ts"]  # dedup, no .agent-session
    assert any("npx jest" in e for e in unit["evidence_refs"])  # test command mined
    assert not any("ls -la" in e for e in unit["evidence_refs"])  # non-verification ignored


def test_observed_trail_enriches_unit(tmp_path):
    sdir = _make_session(tmp_path)
    facts = dr.extract_observed(sdir)
    unit = facts["work_units"][0]
    assert len(unit["decisions"]) == 2
    assert unit["decisions"][0]["what"] == "reusei wrap() nas rotas"
    assert any("92 pass" in e for e in unit["evidence_refs"])


def test_observed_outcome_mapping(tmp_path):
    for status, outcome in (("in_progress", "mixed"), ("needs_attention", "mixed"),
                            ("abandoned", "refused")):
        sdir = _make_session(tmp_path / status,
                             yml=OBSERVED_YML.replace("status: done", f"status: {status}"))
        assert dr.extract_observed(sdir)["outcome"] == outcome


def test_observed_without_transcript_still_emits_facts(tmp_path):
    sdir = _make_session(tmp_path, with_transcript=False)
    facts = dr.extract_observed(sdir)
    assert facts["work_units"][0]["files_changed"] == []
    assert facts["outcome"] == "success"


def test_observed_facts_validate_against_schema(tmp_path):
    try:
        import jsonschema
    except ImportError:
        import pytest
        pytest.skip("jsonschema not installed")
    schema = json.loads(
        (Path(__file__).resolve().parents[4] / "shared" / "schemas"
         / "delivery-facts.schema.json").read_text(encoding="utf-8"))
    sdir = _make_session(tmp_path)
    jsonschema.validate(dr.extract_observed(sdir), schema)
