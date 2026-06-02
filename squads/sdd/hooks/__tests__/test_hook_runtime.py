#!/usr/bin/env python3
"""
Tests for hook_runtime.find_active_session — the single source of truth for
"which Session is active", extracted from ~8 per-hook copies (Spec C, Task 4).

Covers the exact contract every call site relied on:
  - None when .agent-session is absent
  - None when no subdir carries a session.yml (stray dirs ignored)
  - newest *session.yml-bearing* dir wins by mtime
  - dir name (spec_id / task_id) is irrelevant to selection
  - accepts str or Path for project_dir

Run with:
  python3 -m pytest squads/sdd/hooks/__tests__/test_hook_runtime.py
"""
import importlib.util
import os
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_MOD_FILE = _HOOKS_DIR / "hook_runtime.py"

_spec = importlib.util.spec_from_file_location("hook_runtime", _MOD_FILE)
_mod = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
_spec.loader.exec_module(_mod)  # type: ignore[union-attr]

find_active_session = _mod.find_active_session


def _mk_session(base: Path, name: str, *, with_yml: bool = True) -> Path:
    d = base / ".agent-session" / name
    d.mkdir(parents=True)
    if with_yml:
        (d / "session.yml").write_text("id: " + name + "\n", encoding="utf-8")
    return d


def test_none_when_agent_session_absent(tmp_path):
    assert find_active_session(tmp_path) is None


def test_none_when_no_session_yml_bearing_dir(tmp_path):
    # A stray dir without session.yml is not a Session — must be ignored.
    (tmp_path / ".agent-session" / "stray").mkdir(parents=True)
    assert find_active_session(tmp_path) is None


def test_ignores_stray_dir_and_picks_real_session(tmp_path):
    real = _mk_session(tmp_path, "FEAT-001")
    # Create stray AFTER the real one so it is newer by mtime; it must still lose.
    stray = tmp_path / ".agent-session" / "stray"
    stray.mkdir()
    got = find_active_session(tmp_path)
    assert got is not None and got.name == "FEAT-001"
    assert got == real


def test_newest_session_yml_bearing_dir_wins(tmp_path):
    old = _mk_session(tmp_path, "FEAT-001")
    new = _mk_session(tmp_path, "FEAT-002")
    # Force a deterministic mtime ordering (old < new) independent of FS clock.
    os.utime(old, (1_000, 1_000))
    os.utime(new, (2_000, 2_000))
    got = find_active_session(tmp_path)
    assert got is not None and got.name == "FEAT-002"


def test_dir_name_is_irrelevant_discovery_task_id(tmp_path):
    # Discovery names the dir by task_id (DISC-NNN); selection is name-agnostic.
    _mk_session(tmp_path, "DISC-007")
    got = find_active_session(tmp_path)
    assert got is not None and got.name == "DISC-007"


def test_accepts_str_path(tmp_path):
    _mk_session(tmp_path, "FEAT-001")
    got = find_active_session(str(tmp_path))
    assert got is not None and got.name == "FEAT-001"
