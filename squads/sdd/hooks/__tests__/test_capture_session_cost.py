import importlib.util
import json
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("capture_session_cost", str(_HOOKS / "capture-session-cost.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}


def _transcript(p):
    lines = [
        '{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":{"id":"plan1","model":"m","usage":{"input_tokens":10,"output_tokens":0}}}',
        '{"type":"assistant","timestamp":"2026-05-27T12:00:00Z","message":{"id":"impl1","model":"m","usage":{"input_tokens":20,"output_tokens":0}}}',
    ]
    p.write_text("\n".join(lines) + "\n")


def test_splits_by_pipeline_start(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    out = mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                      pipeline_started_at="2026-05-27T11:00:00Z", prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 10.0       # plan1 only
    assert data["orchestration"]["total_cost_usd"] == 20.0  # impl1 only
    assert out == 0


def test_no_pipeline_start_is_all_planning(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 30.0
    assert data["orchestration"]["total_cost_usd"] == 0.0


def test_reads_pipeline_start_from_session_yml(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        'task_id: "FEAT-001"\npipeline_started_at: "2026-05-27T11:00:00Z"\n'
    )
    assert mod._read_pipeline_start(session_dir) == "2026-05-27T11:00:00Z"


def test_read_pipeline_start_empty_returns_none(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text('pipeline_started_at: ""\n')
    assert mod._read_pipeline_start(session_dir) is None
