#!/usr/bin/env python3
"""
ai-squad Stop hook — capture-subagent-usage.

Fires when ANY session ends. For subagent sessions, captures the
session's token usage from the JSONL transcript and writes it to the
matching dispatch entry in dispatch-manifest.json.

Correlation is exact (1:1) via _session_id stamped into the Output
Packet by stamp-session-id.py (PostToolUse). No heuristics.

Skip behavior (returns silently):
  - stop_hook_active==true (loop guard)
  - No output packet has _session_id matching this session_id
    → orchestrator session OR subagent that didn't write a packet
  - Manifest entry already has `usage` (idempotent re-run)
  - Any I/O / parse error (logged to stderr, never blocks)

Concurrency: file lock (fcntl.flock LOCK_EX) on the manifest while
read-modify-writing. Pure stdlib. Python 3.8+.

Failure handling (AC-003):
  On OSError / lock-fail / transcript-invalid / _session_id absent,
  appends a structured entry to .agent-session/<task_id>/.capture-usage-failed.json.

Warning channel (AC-007):
  On idempotent skip (usage already captured) or partial capture,
  calls shared/lib/warnings.py::append_warning to structured log.
"""
import fcntl
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

# shared/lib is two directories up from hooks/
_SHARED_LIB = _HOOKS_DIR.parent.parent.parent / "shared" / "lib"
if str(_SHARED_LIB) not in sys.path:
    sys.path.insert(0, str(_SHARED_LIB))

from hook_runtime import resolve_project_root

_TASK_ID_RE = re.compile(r"^FEAT-\d{3,4}$")


def _task_id_from_session_dir(session_dir: Path) -> str | None:
    """Extract task_id from session directory name if it matches ^FEAT-\\d{3,4}$."""
    name = session_dir.name
    if _TASK_ID_RE.match(name):
        return name
    return None


def _append_capture_failure(session_dir: Path, dispatch_id: str, reason: str, attempted_sources: list[str]) -> None:
    """AC-003: append a structured failure entry to .capture-usage-failed.json.

    Uses fcntl.LOCK_EX on the marker file to prevent a read-modify-write race
    when concurrent subagent capture-failures land simultaneously.

    On JSONDecodeError of the existing file (M5): renames the corrupt file to
    .capture-usage-failed.json.corrupt-<timestamp> (preserve evidence) and starts
    a fresh array. Logs via _try_append_warning so the audit can pick it up.
    """
    task_id = _task_id_from_session_dir(session_dir)
    marker_path = session_dir / ".capture-usage-failed.json"
    entry = {
        "dispatch_id": dispatch_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reason": reason,
        "attempted_sources": attempted_sources,
    }
    try:
        # Open with a+ so we can lock, read, rewrite in-place.
        with marker_path.open("a+", encoding="utf-8") as fh:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            _fh_closed = False
            try:
                fh.seek(0)
                raw = fh.read().strip()
                existing: list = []
                if raw:
                    try:
                        existing = json.loads(raw)
                        if not isinstance(existing, list):
                            existing = []
                    except json.JSONDecodeError:
                        # M5: preserve corrupt file evidence, start fresh.
                        ts_suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
                        corrupt_path = marker_path.with_name(
                            f".capture-usage-failed.json.corrupt-{ts_suffix}"
                        )
                        try:
                            marker_path.rename(corrupt_path)
                        except OSError:
                            pass
                        if task_id:
                            _try_append_warning(
                                session_dir,
                                task_id,
                                "capture_failure_marker_corrupt",
                                "capture-subagent-usage",
                                metadata={"corrupt_path": str(corrupt_path)},
                            )
                        # fh still references the renamed (corrupt) inode — unlock,
                        # close it, then open a fresh marker_path and write [entry].
                        fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
                        _fh_closed = True
                        fh.close()
                        with marker_path.open("a+", encoding="utf-8") as fh2:
                            fcntl.flock(fh2.fileno(), fcntl.LOCK_EX)
                            try:
                                json.dump([entry], fh2, indent=2)
                                fh2.write("\n")
                            finally:
                                fcntl.flock(fh2.fileno(), fcntl.LOCK_UN)
                        return
                existing.append(entry)
                fh.seek(0)
                fh.truncate()
                json.dump(existing, fh, indent=2)
                fh.write("\n")
            finally:
                if not _fh_closed:
                    fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    except OSError as exc:
        print(f"capture-subagent-usage: cannot write failure marker ({exc})", file=sys.stderr)


def _try_append_warning(session_dir: Path, task_id: str, reason: str, source: str, metadata: dict | None = None) -> None:
    """AC-007: call shared/lib/squad_warnings::append_warning for non-critical conditions."""
    try:
        import importlib.util as _ilu
        _spec = _ilu.spec_from_file_location("squad_warnings", str(_SHARED_LIB / "warnings.py"))
        if _spec and _spec.loader:
            _mod = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_mod)  # type: ignore[union-attr]
            _mod.append_warning(task_id, reason, source, metadata=metadata, severity="warning")
    except Exception as exc:
        print(f"capture-subagent-usage: warning append skipped ({exc})", file=sys.stderr)


def find_active_session(project_dir: Path) -> Path | None:
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def find_packet_by_session(outputs_dir: Path, session_id: str) -> Path | None:
    if not outputs_dir.is_dir():
        return None
    for f in outputs_dir.glob("d-*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and data.get("_session_id") == session_id:
            return f
    return None


def parse_transcript(transcript_path: Path) -> dict:
    """Sum token usage across all assistant turns. Count tool_use blocks."""
    totals = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "tool_uses": 0,
    }
    model = "unknown"
    if not transcript_path.exists():
        return {"totals": totals, "model": model}

    try:
        for line in transcript_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue
            # Claude Code transcript: assistant turns under various shapes.
            # Try entry.message.usage and entry.message.model first.
            msg = entry.get("message") if isinstance(entry.get("message"), dict) else entry
            usage = msg.get("usage") if isinstance(msg, dict) else None
            if isinstance(usage, dict):
                for k in (
                    "input_tokens",
                    "output_tokens",
                    "cache_creation_input_tokens",
                    "cache_read_input_tokens",
                ):
                    v = usage.get(k)
                    if isinstance(v, int):
                        totals[k] += v
            if model == "unknown" and isinstance(msg, dict):
                m = msg.get("model")
                if isinstance(m, str) and m:
                    model = m
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        totals["tool_uses"] += 1
    except OSError as exc:
        print(f"capture-subagent-usage: cannot read transcript ({exc})", file=sys.stderr)

    return {"totals": totals, "model": model}


def iso_diff_ms(start_iso: str, end_iso: str) -> int:
    from datetime import datetime

    def parse(s: str):
        return datetime.fromisoformat(s.replace("Z", "+00:00"))

    try:
        return int((parse(end_iso) - parse(start_iso)).total_seconds() * 1000)
    except (ValueError, TypeError):
        return 0


def update_manifest(manifest_path: Path, dispatch_id: str, usage: dict, session_dir: Path | None = None) -> bool:
    """Update manifest with usage data. Returns True on success, False on idempotent skip."""
    with manifest_path.open("r+", encoding="utf-8") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            try:
                manifest = json.load(fh)
            except json.JSONDecodeError as exc:
                print(
                    f"capture-subagent-usage: malformed manifest ({exc})",
                    file=sys.stderr,
                )
                return False
            dispatches = manifest.get("actual_dispatches") or []
            if not isinstance(dispatches, list):
                return False
            for entry in dispatches:
                if not isinstance(entry, dict):
                    continue
                if entry.get("dispatch_id") != dispatch_id:
                    continue
                if isinstance(entry.get("usage"), dict):
                    return False  # idempotent — usage already written
                started = entry.get("started_at")
                completed = entry.get("completed_at")
                duration_ms = (
                    iso_diff_ms(started, completed)
                    if isinstance(started, str) and isinstance(completed, str)
                    else 0
                )
                totals = usage["totals"]
                entry["usage"] = {
                    "total_tokens": (
                        totals["input_tokens"]
                        + totals["output_tokens"]
                        + totals["cache_creation_input_tokens"]
                        + totals["cache_read_input_tokens"]
                    ),
                    "input_tokens": totals["input_tokens"],
                    "output_tokens": totals["output_tokens"],
                    "cache_creation_input_tokens": totals["cache_creation_input_tokens"],
                    "cache_read_input_tokens": totals["cache_read_input_tokens"],
                    "tool_uses": totals["tool_uses"],
                    "duration_ms": duration_ms,
                    "model": usage["model"],
                }
                fh.seek(0)
                fh.truncate()
                json.dump(manifest, fh, indent=2)
                return True
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"capture-subagent-usage: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if payload.get("stop_hook_active"):
        return 0

    session_id = payload.get("session_id")
    transcript_path_str = payload.get("transcript_path")

    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        return 0

    task_id = _task_id_from_session_dir(session_dir)

    # AC-003: session_id absent — structured failure, not silent skip
    if not isinstance(session_id, str):
        if task_id:
            _append_capture_failure(
                session_dir,
                dispatch_id="<unknown>",
                reason="session_id_missing",
                attempted_sources=[],
            )
        return 0

    if not isinstance(transcript_path_str, str):
        return 0

    manifest_path = session_dir / "dispatch-manifest.json"
    if not manifest_path.exists():
        return 0

    outputs_dir = session_dir / "outputs"
    packet_path = find_packet_by_session(outputs_dir, session_id)
    if packet_path is None:
        return 0  # orchestrator session or no packet written

    try:
        packet = json.loads(packet_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        # AC-003: transcript/packet parse failure
        if task_id:
            _append_capture_failure(
                session_dir,
                dispatch_id=str(packet_path.stem),
                reason="transcript_invalid",
                attempted_sources=[str(packet_path)],
            )
        return 0

    dispatch_id = packet.get("dispatch_id") if isinstance(packet, dict) else None
    if not isinstance(dispatch_id, str):
        # AC-003: _session_id present but dispatch_id absent in packet
        if task_id:
            _append_capture_failure(
                session_dir,
                dispatch_id="<unknown>",
                reason="session_id_missing",
                attempted_sources=[str(packet_path)],
            )
        return 0

    usage = parse_transcript(Path(transcript_path_str))

    # AC-007: warn on suspicious zero-token parse (partial capture)
    totals = usage.get("totals", {})
    total_tokens = (
        totals.get("input_tokens", 0)
        + totals.get("output_tokens", 0)
        + totals.get("cache_creation_input_tokens", 0)
        + totals.get("cache_read_input_tokens", 0)
    )
    if total_tokens == 0 and task_id:
        _try_append_warning(
            session_dir,
            task_id,
            reason="zero_token_parse",
            source="capture-subagent-usage",
            metadata={"dispatch_id": dispatch_id, "transcript_path": transcript_path_str},
        )

    try:
        already_captured = not update_manifest(manifest_path, dispatch_id, usage, session_dir)
        # AC-007: warn on suspicious idempotent skip (usage was already populated)
        if already_captured and task_id:
            _try_append_warning(
                session_dir,
                task_id,
                reason="idempotent_skip_suspicious",
                source="capture-subagent-usage",
                metadata={"dispatch_id": dispatch_id},
            )
    except OSError as exc:
        # AC-003: OSError during manifest write
        print(f"capture-subagent-usage: manifest update failed ({exc})", file=sys.stderr)
        if task_id:
            _append_capture_failure(
                session_dir,
                dispatch_id=dispatch_id,
                reason="oserror",
                attempted_sources=[str(manifest_path), transcript_path_str],
            )

    return 0


if __name__ == "__main__":
    sys.exit(main())
