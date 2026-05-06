"""
Shared helpers for ai-squad enforcement hooks.

Single module used by all hook scripts so behavior stays aligned across
Claude Code and Cursor (IDE / CLI). Cursor sends workspace_roots / cwd on stdin;
Claude Code sets CLAUDE_PROJECT_DIR.
"""
from __future__ import annotations

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
