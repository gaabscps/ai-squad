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
_DISPATCH_ID_LOOP_RE = re.compile(r"[-_]l?(\d+)$", re.IGNORECASE)
_ROLE_SLUG_MAP: dict[str, str] = {
    "dev": "dev",
    "qa": "qa",
    "cr": "code-reviewer",
    "lr": "logic-reviewer",
    "audit": "audit-agent",
    "blocker": "blocker-specialist",
    "code-reviewer": "code-reviewer",
    "logic-reviewer": "logic-reviewer",
}


def _infer_role_from_packet(dispatch_id: str, packet: dict) -> str:
    """Infer role from output packet fields or dispatch_id pattern."""
    if "ac_coverage" in packet:
        return "qa"
    if "files_changed" in packet or "ac_closure" in packet:
        return "dev"
    did_lower = dispatch_id.lower()
    for slug, role in _ROLE_SLUG_MAP.items():
        if f"-{slug}-" in did_lower or did_lower.endswith(f"-{slug}"):
            return role
    return "dev"


def _infer_subtask_from_packet(dispatch_id: str, packet: dict) -> str:
    """Infer sub-task ID (T-NNN) from output packet `task` field or dispatch_id."""
    task = packet.get("task")
    if isinstance(task, str) and task:
        return task
    m = re.search(r"(T-\d{3,4})", dispatch_id, re.IGNORECASE)
    if m:
        return m.group(1).upper()
    return "unknown"


def _infer_loop_from_packet(dispatch_id: str, packet: dict) -> int:
    """Infer review_loop from output packet `loop` field or dispatch_id suffix."""
    loop = packet.get("loop")
    if isinstance(loop, int) and loop > 0:
        return loop
    m = _DISPATCH_ID_LOOP_RE.search(dispatch_id)
    if m:
        try:
            return max(1, int(m.group(1)))
        except ValueError:
            pass
    return 1


def _build_auto_entry(dispatch_id: str, packet: dict, usage: dict) -> dict:
    """Build an actual_dispatches[] entry from an Output Packet.

    Called when the orchestrator never wrote the entry during the session
    (bookkeeping gap). Preserves ac_coverage so the agentops AC matrix is
    populated even when the orchestrator skipped step 1b.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    role = _infer_role_from_packet(dispatch_id, packet)
    task_id = _infer_subtask_from_packet(dispatch_id, packet)
    review_loop = _infer_loop_from_packet(dispatch_id, packet)
    status = packet.get("status", "done")
    totals = usage.get("totals", {})

    entry: dict = {
        "dispatch_id": dispatch_id,
        "task_id": task_id,
        "role": role,
        "started_at": None,
        "completed_at": now_iso,
        "output_packet_ref": f"outputs/{dispatch_id}.json",
        "status": status,
        "review_loop": review_loop,
        "pm_note": "auto_captured: orchestrator bookkeeping gap",
        "auto_captured": True,
        "usage": {
            "total_tokens": (
                totals.get("input_tokens", 0)
                + totals.get("output_tokens", 0)
                + totals.get("cache_creation_input_tokens", 0)
                + totals.get("cache_read_input_tokens", 0)
            ),
            "input_tokens": totals.get("input_tokens", 0),
            "output_tokens": totals.get("output_tokens", 0),
            "cache_creation_input_tokens": totals.get("cache_creation_input_tokens", 0),
            "cache_read_input_tokens": totals.get("cache_read_input_tokens", 0),
            "tool_uses": totals.get("tool_uses", 0),
            "duration_ms": 0,
            "model": usage.get("model", "unknown"),
        },
    }
    if "ac_coverage" in packet:
        entry["ac_coverage"] = packet["ac_coverage"]
    return entry


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


# Matches a `dispatch_id: <value>` line embedded in transcript content,
# where <value> is the canonical ai-squad dispatch id shape
# (`d-` followed by non-whitespace). Captures the bare value.
_DISPATCH_ID_RE = re.compile(r"dispatch_id\s*:\s*[\"']?(d-[^\s\"']+)")


def extract_dispatch_id_from_transcript(transcript_path: Path) -> str | None:
    """Scan a subagent's JSONL transcript for the Work Packet `dispatch_id`.

    Fallback correlation path used when the file-based `_session_id` stamp is
    absent (the PostToolUse stamper can miss a write — e.g. when the subagent
    uses MultiEdit, NotebookEdit, or writes via a Bash command, or fires
    before `session_id` propagates into the hook payload).

    The Work Packet YAML is embedded in the FIRST user message Claude Code
    delivers to the subagent. This function scans every entry in the JSONL
    and returns the first `dispatch_id: d-XXX` it finds — covers cases where
    the Work Packet is rephrased or quoted later in the transcript too.

    Returns the dispatch_id string (e.g. ``d-T-001-dev-l1``) or None when
    the transcript is unreadable, malformed, or contains no Work Packet.
    """
    if not transcript_path.exists():
        return None
    try:
        text = transcript_path.read_text(encoding="utf-8")
    except OSError:
        return None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict):
            continue

        # Try entry.message.content first (Claude Code transcript shape).
        msg = entry.get("message") if isinstance(entry.get("message"), dict) else entry
        if not isinstance(msg, dict):
            continue
        content = msg.get("content")

        # Normalise to a single string regardless of content shape.
        text_blob = ""
        if isinstance(content, str):
            text_blob = content
        elif isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict):
                    t = block.get("text")
                    if isinstance(t, str):
                        parts.append(t)
                    # Some shapes wrap user tool_result content
                    cnt = block.get("content")
                    if isinstance(cnt, str):
                        parts.append(cnt)
            text_blob = " ".join(parts)

        if not text_blob:
            continue
        m = _DISPATCH_ID_RE.search(text_blob)
        if m:
            return m.group(1)

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


def update_manifest(
    manifest_path: Path,
    dispatch_id: str,
    usage: dict,
    session_dir: Path | None = None,
    packet_data: dict | None = None,
) -> bool:
    """Update manifest with usage data. Returns True on success, False on idempotent skip.

    When the orchestrator skipped writing the dispatch entry (bookkeeping gap)
    and packet_data is provided, auto-creates the entry so agentops has the
    full dispatch record including ac_coverage.
    """
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

            # Entry not found — orchestrator bookkeeping gap.
            # Auto-create when output packet data is available so agentops
            # can reconstruct the full dispatch record.
            if packet_data is not None:
                new_entry = _build_auto_entry(dispatch_id, packet_data, usage)
                dispatches.append(new_entry)
                manifest["actual_dispatches"] = dispatches
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

    dispatch_id: str | None = None
    packet_data: dict | None = None
    if packet_path is not None:
        # Primary path — file-based _session_id stamp succeeded.
        try:
            packet = json.loads(packet_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            if task_id:
                _append_capture_failure(
                    session_dir,
                    dispatch_id=str(packet_path.stem),
                    reason="transcript_invalid",
                    attempted_sources=[str(packet_path)],
                )
            return 0
        if isinstance(packet, dict):
            packet_data = packet  # preserve for bookkeeping-gap auto-creation
        raw_dispatch = packet.get("dispatch_id") if isinstance(packet, dict) else None
        if isinstance(raw_dispatch, str):
            dispatch_id = raw_dispatch

    if dispatch_id is None:
        # Fallback — extract dispatch_id directly from the transcript's
        # Work Packet. Covers all cases where the _session_id stamp didn't
        # land (MultiEdit, missing-payload session_id, etc.) and explains
        # the 30+ usage=null dispatches observed in FEAT-004 / FEAT-005.
        dispatch_id = extract_dispatch_id_from_transcript(Path(transcript_path_str))

    if not isinstance(dispatch_id, str) or not dispatch_id:
        # Both paths failed — this really is an orchestrator session
        # (no Work Packet) or a non-correlatable run.
        if task_id and packet_path is not None:
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
        already_captured = not update_manifest(manifest_path, dispatch_id, usage, session_dir, packet_data=packet_data)
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
