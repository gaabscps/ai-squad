import importlib.util
import json
import subprocess
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "audit_baseline", str(_LIB / "audit_baseline.py"))
ab = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ab)


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args],
                   check=True, capture_output=True, text=True)


def test_dirty_paths_lists_modified_and_untracked(tmp_path):
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "tracked.txt").write_text("a\n")
    _git(tmp_path, "add", "tracked.txt")
    _git(tmp_path, "commit", "-m", "init")
    (tmp_path / "tracked.txt").write_text("b\n")   # modified
    (tmp_path / "new.txt").write_text("x\n")        # untracked
    got = ab.dirty_paths(tmp_path)
    assert got == ["new.txt", "tracked.txt"]        # sorted


def test_dirty_paths_empty_outside_git(tmp_path):
    # Not a work tree -> best-effort empty, never a crash.
    assert ab.dirty_paths(tmp_path) == []


def test_load_baseline_absent_returns_none(tmp_path):
    assert ab.load_baseline(tmp_path) is None


def test_load_baseline_reads_dirty_paths(tmp_path):
    (tmp_path / ab.BASELINE_FILENAME).write_text(
        json.dumps({"schema_version": 1, "dirty_paths": ["b", "a"]}))
    assert ab.load_baseline(tmp_path) == ["a", "b"]   # sorted


def test_load_baseline_malformed_returns_none(tmp_path):
    (tmp_path / ab.BASELINE_FILENAME).write_text("{ not json")
    assert ab.load_baseline(tmp_path) is None


def test_compute_subtracts_baseline(tmp_path, monkeypatch):
    monkeypatch.setattr(ab, "dirty_paths", lambda p: [".gitignore", "src/a.ts"])
    (tmp_path / ab.BASELINE_FILENAME).write_text(
        json.dumps({"schema_version": 1, "dirty_paths": [".gitignore"]}))
    rep = ab.compute(tmp_path, tmp_path)
    assert rep["baseline_present"] is True
    assert rep["delta"] == ["src/a.ts"]          # introduced by the pipeline
    assert rep["exempted"] == [".gitignore"]     # pre-existing, never a finding


def test_compute_absent_baseline_delta_is_whole_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(ab, "dirty_paths", lambda p: ["src/a.ts"])
    rep = ab.compute(tmp_path, tmp_path)
    assert rep["baseline_present"] is False
    assert rep["delta"] == ["src/a.ts"]          # nothing exempted
    assert rep["exempted"] == []
