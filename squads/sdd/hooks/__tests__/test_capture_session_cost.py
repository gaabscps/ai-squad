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


# ---- new trail (/implementer): slice planning vs implementation ----

def test_splits_by_implement_start(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES,
                implement_started_at="2026-05-27T11:00:00Z")
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 10.0        # plan1 only
    assert data["implementation"]["total_cost_usd"] == 20.0  # impl1 only
    assert data["orchestration"]["total_cost_usd"] == 0.0


def test_implement_start_takes_precedence_over_pipeline_start(tmp_path):
    # Strangler: when both marks exist, the new trail's cut wins — the feature
    # was implemented by /implementer, so main-session spend after the mark is
    # implementation, not orchestration.
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at="2026-05-27T09:00:00Z", prices=PRICES,
                implement_started_at="2026-05-27T11:00:00Z")
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 10.0
    assert data["implementation"]["total_cost_usd"] == 20.0
    assert data["orchestration"]["total_cost_usd"] == 0.0


def test_old_trail_payload_has_no_implementation_key(tmp_path):
    # Old-trail captures stay byte-compatible: no implementation key appears
    # unless the new mark exists.
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at="2026-05-27T11:00:00Z", prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert "implementation" not in data


def test_reads_implement_start_from_session_yml(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        'task_id: "FEAT-001"\n'
        'implement_trail:\n'
        '  started_at: "2026-05-27T11:00:00Z"\n'
        '  reuse_map_ready_at: "2026-05-27T11:05:00Z"\n'
        'status: done\n'
    )
    assert mod._read_implement_start(session_dir) == "2026-05-27T11:00:00Z"


def test_read_implement_start_ignores_top_level_started_at(tmp_path):
    # A started_at outside the implement_trail block must not be picked up.
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        'started_at: "2026-05-27T08:00:00Z"\n'
        'task_id: "FEAT-001"\n'
    )
    assert mod._read_implement_start(session_dir) is None


def test_read_implement_start_absent_returns_none(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text('task_id: "FEAT-001"\n')
    assert mod._read_implement_start(session_dir) is None


# ---- observed mode: window-sliced capture (ownership fix) ----
#
# An observed snapshot used to be CUMULATIVE over the whole chat session, so a
# chat that crossed OBS-003 → OBS-004 was double-counted in both. The fix: the
# capture is bracketed by the contract window — since created_at, until
# closed_at — so each OBS only ever holds the spend that happened on its watch.

def test_observed_window_slices_since(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)  # plan1@10:00 (10 tok), impl1@12:00 (20 tok)
    session_dir = tmp_path / ".agent-session" / "OBS-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES,
                window_since="2026-05-27T11:00:00Z")
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 20.0  # pre-window plan1 cut


def test_observed_window_slices_until(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "OBS-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES,
                window_until="2026-05-27T11:00:00Z")
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 10.0  # post-close impl1 cut


def test_observed_window_records_bounds(tmp_path):
    # The bounds are provenance: the report/auditor must be able to see which
    # window a snapshot covers instead of guessing from mtimes.
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "OBS-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES,
                window_since="2026-05-27T11:00:00Z", window_until="2026-05-27T13:00:00Z")
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["window"] == {"since": "2026-05-27T11:00:00Z",
                              "until": "2026-05-27T13:00:00Z"}


def test_no_window_payload_has_no_window_key(tmp_path):
    # Pipeline captures stay byte-compatible.
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert "window" not in data


def test_read_observed_window_from_session_yml(tmp_path):
    session_dir = tmp_path / ".agent-session" / "OBS-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        "mode: observed            # inline comment\n"
        'created_at: "2026-06-11T10:00:00Z"\n'
        'closed_at: "2026-06-11T22:05:04Z"\n',
        encoding="utf-8",
    )
    assert mod._read_observed_window(session_dir) == (
        "2026-06-11T10:00:00Z", "2026-06-11T22:05:04Z")


def test_read_observed_window_open_session_has_no_until(tmp_path):
    session_dir = tmp_path / ".agent-session" / "OBS-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        "mode: observed\ncreated_at: \"2026-06-11T10:00:00Z\"\n", encoding="utf-8")
    assert mod._read_observed_window(session_dir) == ("2026-06-11T10:00:00Z", None)


def test_read_observed_window_non_observed_is_none(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    (session_dir / "session.yml").write_text(
        'task_id: "FEAT-001"\ncreated_at: "2026-06-11T10:00:00Z"\n', encoding="utf-8")
    assert mod._read_observed_window(session_dir) is None


def test_payload_records_transcript_path(tmp_path):
    # The post-hoc analyst (chronicler in free/observed mode) mines the
    # transcript; the cost capture is the only hook that reliably sees its
    # path at Stop, so it must persist the pointer.
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["transcript_path"] == str(tr)
