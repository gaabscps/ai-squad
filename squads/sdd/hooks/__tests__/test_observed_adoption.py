import importlib.util, time
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("hook_runtime", str(_LIB / "hook_runtime.py"))
hr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hr)


def _mk(base, name, mode, status):
    d = base / ".agent-session" / name
    d.mkdir(parents=True)
    (d / "session.yml").write_text(
        f"mode: {mode}\nstatus: {status}\ncreated_at: 2026-06-21T06:00:00Z\n", encoding="utf-8")
    return d


def test_open_observed_rescues_capture_from_newer_closed_sibling(tmp_path):
    d9 = _mk(tmp_path, "OBS-009", "observed", "in_progress")
    time.sleep(0.02)
    d8 = _mk(tmp_path, "OBS-008", "observed", "done")  # fechada, porém mtime-newest
    got = hr.resolve_capture_session(tmp_path, "chat-3")
    assert got == d9
    assert "chat-3" in (d9 / "session.yml").read_text()
    assert "chat-3" not in (d8 / "session.yml").read_text()


def test_single_open_observed_still_adopts(tmp_path):
    d = _mk(tmp_path, "OBS-009", "observed", "in_progress")
    got = hr.resolve_capture_session(tmp_path, "chat-2")
    assert got == d and "chat-2" in (d / "session.yml").read_text()


def test_sdd_active_not_hijacked_by_open_observed(tmp_path):
    _mk(tmp_path, "OBS-009", "observed", "in_progress")
    time.sleep(0.02)
    feat = _mk(tmp_path, "FEAT-001", "sdd", "in_progress")  # newest + SDD
    got = hr.resolve_capture_session(tmp_path, "chat-x")
    assert got == feat  # SDD wins via the mode!=observed path; observed NOT hijacked


def test_all_observed_closed_returns_none(tmp_path):
    _mk(tmp_path, "OBS-009", "observed", "done")
    got = hr.resolve_capture_session(tmp_path, "chat-z")
    assert got is None  # nothing open to adopt — unchanged behavior
