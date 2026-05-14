"""
Shared helpers for ai-squad enforcement hooks.

Single module used by all hook scripts so behavior stays aligned across
Claude Code and Cursor (IDE / CLI). Cursor sends workspace_roots / cwd on stdin;
Claude Code sets CLAUDE_PROJECT_DIR.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Mapping


def resolve_project_root(payload: Mapping[str, Any] | None) -> Path:
    """Best-effort consumer project root for path checks and .agent-session lookup."""
    env = os.environ.get("CLAUDE_PROJECT_DIR", "").strip()
    if env:
        return Path(env).resolve()
    if payload:
        cwd = payload.get("cwd")
        if cwd:
            return Path(str(cwd)).resolve()
        roots = payload.get("workspace_roots")
        if isinstance(roots, list) and roots:
            return Path(str(roots[0])).resolve()
    return Path(os.getcwd()).resolve()


def tool_input_dict(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    if not payload:
        return {}
    raw = payload.get("tool_input")
    if isinstance(raw, dict):
        return dict(raw)
    return {}


def edit_target_path(tool_input: Mapping[str, Any]) -> str:
    for key in ("file_path", "path", "target_file"):
        val = tool_input.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def shell_command(tool_input: Mapping[str, Any]) -> str:
    val = tool_input.get("command")
    return val if isinstance(val, str) else ""


_SKILL_MARKER_PATTERN = re.compile(
    r"[Bb]ase directory for this [Ss]kill:\s*\S*?/skills/([A-Za-z0-9_-]+)"
)
_SUBAGENT_TYPE_PATTERN = re.compile(
    r"subagent_type:\s*[\"']?([A-Za-z0-9_-]+)"
)
_TRANSCRIPT_TAIL_BYTES = 256 * 1024
_TRANSCRIPT_HEAD_LINE_LIMIT = 80


def detect_active_skill(payload: Mapping[str, Any] | None) -> str | None:
    """Return the slug of the most recently activated Claude Code Skill, or None.

    Scans the tail of the JSONL transcript (last 256 KiB) for the canonical
    marker `Base directory for this skill: .../skills/<name>` that Claude Code
    emits when a Skill is invoked. The LAST occurrence wins — a session may
    load multiple skills in sequence, and only the most recent one defines
    the current scope.

    Returns None when:
      - payload is not a dict
      - transcript_path missing or not a string
      - transcript file unreadable
      - no Skill marker found in the scanned tail
    """
    if not isinstance(payload, dict):
        return None
    tp = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not isinstance(tp, str) or not tp:
        return None
    transcript_path = Path(tp)
    try:
        with transcript_path.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            start = max(0, size - _TRANSCRIPT_TAIL_BYTES)
            fh.seek(start)
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return None
    matches = _SKILL_MARKER_PATTERN.findall(tail)
    if not matches:
        return None
    return matches[-1]


def detect_active_subagent(payload: Mapping[str, Any] | None) -> str | None:
    """Return the Work Packet `subagent_type` slug, or None.

    Scans the first _TRANSCRIPT_HEAD_LINE_LIMIT lines of the JSONL transcript
    for the Work Packet marker `subagent_type: <name>`. The Work Packet is
    always at the top of the sub-Task transcript, so a tight head bound is
    safe and keeps latency predictable.

    Returns None when:
      - payload is not a dict
      - transcript_path missing or not a string
      - transcript file unreadable
      - no subagent_type marker found within the scan window
    """
    if not isinstance(payload, dict):
        return None
    tp = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not isinstance(tp, str) or not tp:
        return None
    transcript_path = Path(tp)
    try:
        with transcript_path.open("r", encoding="utf-8", errors="replace") as fh:
            for lineno, raw_line in enumerate(fh, start=1):
                if lineno > _TRANSCRIPT_HEAD_LINE_LIMIT:
                    break
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict):
                    continue
                content = entry.get("content")
                if content is None:
                    msg = entry.get("message")
                    if isinstance(msg, dict):
                        content = msg.get("content")
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )
                if not isinstance(content, str):
                    continue
                m = _SUBAGENT_TYPE_PATTERN.search(content)
                if m:
                    return m.group(1)
    except OSError:
        return None
    return None


def should_run_audit_manifest_verify(session_dir: Path) -> bool:
    """
    When hooks run globally (e.g. Cursor stop), skip sessions that clearly never
    entered Phase 4 — avoids blocking unrelated chats while a FEAT folder exists.
    Caller must only invoke this when dispatch-manifest.json is present.
    """
    yml = session_dir / "session.yml"
    if not yml.exists():
        return True
    text = yml.read_text(encoding="utf-8", errors="replace")
    if re.search(
        r"^current_owner:\s*[\"']?orchestrator[\"']?\s*$", text, re.MULTILINE
    ):
        return True
    phase_mark = re.search(
        r"^current_phase:\s*[\"']?(\w+)[\"']?\s*$", text, re.MULTILINE
    )
    if phase_mark:
        phase = phase_mark.group(1)
        if phase in {"implementation", "paused", "escalated", "done"}:
            return True
    return False
