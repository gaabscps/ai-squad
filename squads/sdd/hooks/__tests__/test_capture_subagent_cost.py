import importlib.util
import json
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("capture_subagent_cost", str(_HOOKS / "capture-subagent-cost.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def _make_transcript(p):
    p.write_text(
        '{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":'
        '{"id":"x","model":"m","usage":{"input_tokens":10,"output_tokens":5}}}\n'
    )


def test_writes_cost_file(tmp_path):
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    prices = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}

    out = mod.capture(agent_id="abc", transcript_path=str(tr),
                      session_dir=session_dir, prices=prices)

    f = session_dir / "costs" / "agent-abc.json"
    assert f.exists()
    data = json.loads(f.read_text())
    assert data["agent_id"] == "abc"
    assert data["total_cost_usd"] == 20.0
    assert data["scope"] == "implementation"
    assert out == 0


def test_idempotent_skip(tmp_path):
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    (session_dir / "costs").mkdir(parents=True)
    existing = session_dir / "costs" / "agent-abc.json"
    existing.write_text('{"agent_id":"abc","total_cost_usd":999.0}')
    prices = {"m": {"input_per_mtok": 1.0, "output_per_mtok": 1.0}}

    mod.capture(agent_id="abc", transcript_path=str(tr), session_dir=session_dir, prices=prices)
    assert json.loads(existing.read_text())["total_cost_usd"] == 999.0  # untouched


def test_missing_transcript_fails_open(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    rc = mod.capture(agent_id="abc", transcript_path=str(tmp_path / "nope.jsonl"),
                     session_dir=session_dir, prices={})
    assert rc == 0  # never blocks
