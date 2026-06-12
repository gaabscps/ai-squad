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
parse_work_packet = _mod.parse_work_packet
dispatch_spec_id = _mod.dispatch_spec_id
resolve_dispatch_session = _mod.resolve_dispatch_session


def _wp_payload(spec_id: str) -> dict:
    return {
        "tool_input": {
            "prompt": f"WorkPacket:\n```yaml\ntask_id: T-001\nspec_id: {spec_id}\n```\n"
        }
    }


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


# --- Work Packet spec_id resolution (the audit false-positive fix) ----------

def test_parse_work_packet_extracts_scalars():
    wp = parse_work_packet(
        'WorkPacket:\n```yaml\ntask_id: T-003\nspec_id: "FEAT-006"\n```\n')
    assert wp["task_id"] == "T-003"
    assert wp["spec_id"] == "FEAT-006"   # surrounding quotes stripped


def test_parse_work_packet_absent_returns_empty():
    assert parse_work_packet("no packet here") == {}
    assert parse_work_packet(None) == {}


def test_dispatch_spec_id_reads_work_packet():
    assert dispatch_spec_id(_wp_payload("FEAT-006")) == "FEAT-006"
    assert dispatch_spec_id(_wp_payload("DISC-002")) == "DISC-002"


def test_dispatch_spec_id_rejects_junk_and_traversal():
    # No WP, and a path-traversal value must never resolve to a dir name.
    assert dispatch_spec_id({"tool_input": {"prompt": "hi"}}) is None
    assert dispatch_spec_id(_wp_payload("../../etc")) is None
    assert dispatch_spec_id({}) is None


def test_resolve_dispatch_prefers_spec_id_over_mtime(tmp_path):
    old = _mk_session(tmp_path, "FEAT-100")
    new = _mk_session(tmp_path, "FEAT-200")
    os.utime(old, (2_000, 2_000))   # FEAT-100 newest by mtime
    os.utime(new, (1_000, 1_000))
    got = resolve_dispatch_session(_wp_payload("FEAT-200"), tmp_path)
    assert got == new   # spec_id wins over the mtime-newest sibling


def test_resolve_dispatch_falls_back_to_mtime_without_spec_id(tmp_path):
    old = _mk_session(tmp_path, "FEAT-001")
    new = _mk_session(tmp_path, "FEAT-002")
    os.utime(old, (1_000, 1_000))
    os.utime(new, (2_000, 2_000))
    got = resolve_dispatch_session({"tool_input": {"prompt": "no wp"}}, tmp_path)
    assert got == new   # no spec_id → newest-mtime behavior preserved


def test_resolve_dispatch_spec_id_without_session_yml_falls_back(tmp_path):
    # spec_id names a dir that isn't a real Session (no session.yml) → fall back.
    (tmp_path / ".agent-session" / "FEAT-GHOST").mkdir(parents=True)
    real = _mk_session(tmp_path, "FEAT-001")
    got = resolve_dispatch_session(_wp_payload("FEAT-GHOST"), tmp_path)
    assert got == real


# ---- capture routing for observed sessions (ownership registry + adoption) ----
#
# Stop/SubagentStop hooks have no Work Packet, so resolve_dispatch_session can't
# anchor them. The observed-mode fix: each chat session belongs to exactly ONE
# observed Session dir, recorded under `observed_sessions:` in its session.yml.
# The owner wins over any mtime-newest sibling; an unowned chat session is
# adopted by the open observed dir that find_active_session resolves to.

find_owner_session = _mod.find_owner_session
resolve_capture_session = _mod.resolve_capture_session


def _mk_observed(base: Path, name: str, *, status: str = "in_progress",
                 owns: list[str] | None = None) -> Path:
    d = base / ".agent-session" / name
    d.mkdir(parents=True)
    lines = [
        f"session_id: {name}",
        "mode: observed            # wakes track-attention; SDD machines ignore it",
        f"status: {status}   # inline comment",
        'created_at: "2026-06-11T10:00:00Z"',
    ]
    if owns:
        lines.append("observed_sessions:")
        lines += [f'  - "{sid}"' for sid in owns]
    (d / "session.yml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return d


def test_find_owner_session_matches_registered_id(tmp_path):
    owner = _mk_observed(tmp_path, "OBS-001", owns=["chat-A"])
    newer = _mk_observed(tmp_path, "OBS-002")
    os.utime(owner, (1_000, 1_000))
    os.utime(newer, (2_000, 2_000))   # sibling newer by mtime must not matter
    assert find_owner_session(tmp_path, "chat-A") == owner


def test_find_owner_session_none_when_unregistered(tmp_path):
    _mk_observed(tmp_path, "OBS-001", owns=["chat-A"])
    assert find_owner_session(tmp_path, "chat-B") is None


def test_resolve_capture_owner_wins_even_closed(tmp_path):
    # A chat session keeps writing to its owner after the owner closes (the
    # final Stop lands post-close); a newer open sibling must not steal it.
    owner = _mk_observed(tmp_path, "OBS-001", status="done", owns=["chat-A"])
    newer = _mk_observed(tmp_path, "OBS-002")
    os.utime(owner, (1_000, 1_000))
    os.utime(newer, (2_000, 2_000))
    assert resolve_capture_session(tmp_path, "chat-A") == owner


def test_resolve_capture_adopts_into_open_observed(tmp_path):
    target = _mk_observed(tmp_path, "OBS-001")
    got = resolve_capture_session(tmp_path, "chat-A")
    assert got == target
    text = (target / "session.yml").read_text(encoding="utf-8")
    assert 'observed_sessions:' in text and '- "chat-A"' in text
    # Idempotent: a second Stop must not duplicate the entry.
    resolve_capture_session(tmp_path, "chat-A")
    text = (target / "session.yml").read_text(encoding="utf-8")
    assert text.count('- "chat-A"') == 1


def test_resolve_capture_closed_observed_without_owner_returns_none(tmp_path):
    # Work after the contract closed is NOT observed: capturing an unowned chat
    # into a closed dir is exactly the OBS-002 25h-window contamination.
    _mk_observed(tmp_path, "OBS-001", status="done")
    assert resolve_capture_session(tmp_path, "chat-B") is None


def test_resolve_capture_non_observed_target_unchanged(tmp_path):
    # Pipeline (FEAT) dirs keep today's newest-mtime behavior, no adoption key.
    feat = _mk_session(tmp_path, "FEAT-001")
    got = resolve_capture_session(tmp_path, "chat-A")
    assert got == feat
    assert "observed_sessions" not in (feat / "session.yml").read_text(encoding="utf-8")


def test_resolve_capture_unusable_id_no_adoption(tmp_path):
    # No trustworthy id → route as today but never register garbage.
    target = _mk_observed(tmp_path, "OBS-001")
    assert resolve_capture_session(tmp_path, None) == target
    assert resolve_capture_session(tmp_path, "unknown") == target
    assert "observed_sessions" not in (target / "session.yml").read_text(encoding="utf-8")


def test_read_yaml_scalar_strips_inline_comment_and_quotes(tmp_path):
    yml = tmp_path / "session.yml"
    yml.write_text(
        'mode: observed            # comment\n'
        'closed_at: "2026-06-11T22:05:04Z"\n'
        "intent: 'has # inside quotes'\n",
        encoding="utf-8",
    )
    assert _mod.read_yaml_scalar(yml, "mode") == "observed"
    assert _mod.read_yaml_scalar(yml, "closed_at") == "2026-06-11T22:05:04Z"
    assert _mod.read_yaml_scalar(yml, "intent") == "has # inside quotes"
    assert _mod.read_yaml_scalar(yml, "missing") is None
