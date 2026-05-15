#!/usr/bin/env python3
"""ai-squad PreToolUse hook — verify-pipeline-completeness (FEAT-008 Gap B).

Fires on Task dispatches under the orchestrator Skill. When the targeted
subagent is `qa`, verifies the pipeline pre-conditions:
  - Both `code-reviewer` AND `logic-reviewer` have an Output Packet for the
    same `task_id` with status in {done, needs_review}, OR
  - The task in `tasks.md` carries a `**Skip reviewers:** <reason>` marker.

Drift → block with `pipeline_incomplete`. Non-qa dispatches: silent allow.

Pure stdlib. Python 3.8+.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import detect_active_skill


_WP_FENCED = re.compile(
    r"WorkPacket:\s*\n```(?:ya?ml)?\s*\n(.*?)```", re.DOTALL,
)
_WP_INLINE = re.compile(
    r"```(?:ya?ml)?\s*\nWorkPacket:\s*\n(.*?)```", re.DOTALL,
)
_KV_RE = re.compile(
    r"^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*?)[ \t]*$", re.MULTILINE,
)
_SKIP_REVIEWERS_RE = re.compile(
    r"\*\*Skip reviewers:\*\*\s*(.+)", re.IGNORECASE,
)
_REVIEWER_DONE_STATUSES = frozenset({"done", "needs_review"})


def _parse_wp(prompt: str) -> dict[str, str]:
    m = _WP_FENCED.search(prompt) or _WP_INLINE.search(prompt)
    if not m:
        return {}
    body = m.group(1)
    out: dict[str, str] = {}
    for km in _KV_RE.finditer(body):
        key = km.group(1)
        val = km.group(2).strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out[key] = val
    return out


def _resolve_session_dir() -> Path | None:
    pd = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not pd:
        return None
    sd = Path(pd) / ".agent-session"
    if sd.is_dir():
        return sd
    pdp = Path(pd)
    return pdp if pdp.is_dir() else None


def _has_skip_marker(tasks_md: Path, task_id: str) -> bool:
    try:
        content = tasks_md.read_text(encoding="utf-8", errors="replace")
    except (OSError, IOError):
        return False
    section_re = re.compile(
        r"^##\s+" + re.escape(task_id) + r"\b.*$", re.MULTILINE,
    )
    m = section_re.search(content)
    if m is None:
        return False
    section_start = m.end()
    next_re = re.compile(r"\n##\s+", re.MULTILINE)
    nm = next_re.search(content, section_start)
    section = content[section_start:(nm.start() if nm else len(content))]
    return _SKIP_REVIEWERS_RE.search(section) is not None


def _reviewers_done_for_task(manifest: dict, task_id: str) -> tuple[bool, bool]:
    """Return (has_code_reviewer_done, has_logic_reviewer_done)."""
    cr = lr = False
    for entry in manifest.get("actual_dispatches") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("task_id") != task_id:
            continue
        role = entry.get("role")
        status = entry.get("status")
        if status not in _REVIEWER_DONE_STATUSES:
            continue
        if role == "code-reviewer":
            cr = True
        elif role == "logic-reviewer":
            lr = True
    return cr, lr


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0  # fail open

    if detect_active_skill(payload) != "orchestrator":
        return 0

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0
    prompt = tool_input.get("prompt", "")
    subagent_type = tool_input.get("subagent_type", "")
    if isinstance(subagent_type, str):
        subagent_type = subagent_type.strip().lower()
    else:
        subagent_type = ""

    if subagent_type != "qa":
        return 0

    wp = _parse_wp(prompt if isinstance(prompt, str) else "")
    task_id = wp.get("task_id", "")
    session_id = wp.get("session_id", "")
    if not task_id or not session_id:
        return 0  # cannot verify without identifiers — fail open

    session_dir = _resolve_session_dir()
    if session_dir is None:
        return 0

    feat_dir = session_dir / session_id
    manifest_path = feat_dir / "dispatch-manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0  # first dispatch — no manifest yet
    if not isinstance(manifest, dict):
        return 0

    cr_done, lr_done = _reviewers_done_for_task(manifest, task_id)
    if cr_done and lr_done:
        return 0

    tasks_md = feat_dir / "tasks.md"
    if tasks_md.exists() and _has_skip_marker(tasks_md, task_id):
        return 0

    missing = []
    if not cr_done:
        missing.append("code-reviewer")
    if not lr_done:
        missing.append("logic-reviewer")
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"pipeline_incomplete: qa dispatch for {task_id} requires "
            f"{', '.join(missing)} with status in {{done, needs_review}} first; "
            f"or declare `**Skip reviewers:** <reason>` in the task section "
            f"of {tasks_md} (FEAT-008 Gap B)"
        ),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
