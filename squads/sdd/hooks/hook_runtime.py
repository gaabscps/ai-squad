"""
Shared helpers for ai-squad enforcement hooks.

Single module used by all hook scripts so behavior stays aligned. Claude Code
sets CLAUDE_PROJECT_DIR and sends cwd on stdin.
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
    return Path(os.getcwd()).resolve()


def find_active_session(project_dir: Path) -> Path | None:
    """Most-recently-modified Session dir under <project_dir>/.agent-session/.

    Single source of truth for "which Session is active" across every hook
    (cost capture, baseline, register-impl, the verify-* gates). A legitimate
    Session dir always carries a session.yml (written when the Session is
    created), so candidates are filtered to those that have one: this ignores
    stray/partial sibling dirs and keeps the newest real Session by mtime. The
    dir name (spec_id FEAT-NNN for SDD, task_id DISC-NNN for Discovery) is
    irrelevant to selection — only session.yml presence + mtime decide.

    Returns None when .agent-session is absent or holds no session.yml-bearing dir.
    """
    base = Path(project_dir) / ".agent-session"
    if not base.is_dir():
        return None
    candidates = [d for d in base.iterdir() if (d / "session.yml").exists()]
    if not candidates:
        return None
    return max(candidates, key=lambda d: d.stat().st_mtime)


_WP_FENCED = re.compile(r"WorkPacket:\s*\n```(?:ya?ml)?\s*\n(.*?)```", re.DOTALL)
_WP_INLINE = re.compile(r"```(?:ya?ml)?\s*\nWorkPacket:\s*\n(.*?)```", re.DOTALL)
_WP_KV = re.compile(
    r"^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*?)[ \t]*$", re.MULTILINE
)
_SPEC_ID_RE = re.compile(r"^(?:FEAT|DISC)-\d+$")


def parse_work_packet(prompt: str | None) -> dict[str, str]:
    """Parse the fenced WorkPacket block of a Task dispatch prompt into a flat
    dict of top-level scalar keys. Mirrors verify-pipeline-completeness so every
    hook reads the dispatch contract the same way. Returns {} when absent."""
    if not isinstance(prompt, str) or not prompt:
        return {}
    m = _WP_FENCED.search(prompt) or _WP_INLINE.search(prompt)
    if not m:
        return {}
    out: dict[str, str] = {}
    for km in _WP_KV.finditer(m.group(1)):
        key, val = km.group(1), km.group(2).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key] = val
    return out


def dispatch_spec_id(payload: Mapping[str, Any] | None) -> str | None:
    """The spec_id (FEAT-NNN / DISC-NNN) a Task dispatch targets, read from its
    Work Packet — the authoritative identity the orchestrator was launched with.
    Returns None when the prompt carries no well-formed spec_id (the regex also
    rejects path-traversal junk, so callers can safely use it as a dir name)."""
    prompt = tool_input_dict(payload).get("prompt")
    wp = parse_work_packet(prompt if isinstance(prompt, str) else "")
    sid = wp.get("spec_id") or wp.get("session_id") or ""
    return sid if _SPEC_ID_RE.match(sid) else None


def resolve_dispatch_session(
    payload: Mapping[str, Any] | None, project_dir: Path | None = None
) -> Path | None:
    """The Session dir a Task dispatch belongs to.

    Prefers the spec_id embedded in the dispatch's Work Packet (deterministic:
    it echoes the `/orchestrator <spec_id>` the run was launched with), so
    concurrent Sessions — or an external observer (the aiOS cockpit) touching
    sibling dirs and bumping their mtime — cannot misroute the lookup. Falls
    back to newest-mtime (find_active_session) ONLY when the prompt carries no
    parseable spec_id (non-dispatch payloads).

    This is the fix for the recurring audit false-positive: when find_active_session
    resolved to the wrong (mtime-newest) sibling that already had a baseline, the
    idempotent guard skipped capture for the real Session, leaving it baseline-less
    and tripping the audit's whole-tree fail-safe.
    """
    root = Path(project_dir) if project_dir is not None else resolve_project_root(payload)
    sid = dispatch_spec_id(payload)
    if sid:
        cand = root / ".agent-session" / sid
        if (cand / "session.yml").exists():
            return cand
    return find_active_session(root)


def read_yaml_scalar(yml_path: Path, key: str) -> str | None:
    """Top-level scalar from a session.yml, comment/quote-safe, no PyYAML.

    Honors quoted values (a '#' inside quotes is content) and strips inline
    ` # comments` from bare scalars — /observe sessions copy the skill's
    example comment onto `mode: observed`, which broke naive splits before.
    Returns None when the file or key is absent, or the value is empty.
    """
    try:
        text = Path(yml_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    for line in text.splitlines():
        if not re.match(rf"^{re.escape(key)}\s*:", line):
            continue
        raw = line.split(":", 1)[1].strip()
        for q in ('"', "'"):
            if raw.startswith(q) and q in raw[1:]:
                return raw[1 : raw.index(q, 1)] or None
        return raw.split(" #", 1)[0].strip() or None
    return None


def _read_session_id_list(yml_path: Path, key: str) -> set[str]:
    """Ids listed under a top-level `<key>:` block, e.g. observed_sessions.
    Same cheap block parse as cost_report._read_implementation_sessions."""
    try:
        text = Path(yml_path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return set()
    ids: set[str] = set()
    in_block = False
    for line in text.splitlines():
        if re.match(rf"^\s*{re.escape(key)}\s*:", line):
            in_block = True
            continue
        if not in_block:
            continue
        m = re.match(r"^\s+-\s*[\"']?([^\"'\s]+)[\"']?\s*$", line)
        if m:
            ids.add(m.group(1))
        elif line.strip() == "":
            continue
        elif not line.startswith((" ", "\t")):
            break  # a new top-level key ends the list block
    return ids


_TERMINAL_STATUS = {"done", "abandoned"}


def find_open_observed_session(project_dir: Path) -> Path | None:
    """Most-recently-modified OBSERVED Session dir whose status is non-terminal,
    or None. Rescues capture when find_active_session's mtime-newest dir is a
    CLOSED observed sibling that would otherwise discard the cost."""
    base = Path(project_dir) / ".agent-session"
    if not base.is_dir():
        return None
    open_dirs = []
    for d in base.iterdir():
        yml = d / "session.yml"
        if not yml.exists():
            continue
        if read_yaml_scalar(yml, "mode") != "observed":
            continue
        if (read_yaml_scalar(yml, "status") or "") in _TERMINAL_STATUS:
            continue
        open_dirs.append(d)
    if not open_dirs:
        return None
    return max(open_dirs, key=lambda d: d.stat().st_mtime)


def find_owner_session(project_dir: Path, session_id: str | None) -> Path | None:
    """The Session dir that registered this chat session under
    `observed_sessions:` — its exclusive owner — or None.

    Ownership survives close: the final Stop of a chat session lands AFTER the
    contract is closed, and that capture must still reach the owner (window-
    bounded by closed_at), never a newer sibling.
    """
    if not session_id or session_id == "unknown":
        return None
    base = Path(project_dir) / ".agent-session"
    if not base.is_dir():
        return None
    for d in sorted(base.iterdir()):
        yml = d / "session.yml"
        if yml.exists() and session_id in _read_session_id_list(yml, "observed_sessions"):
            return d
    return None


def register_observed_session(session_yml: Path, session_id: str) -> bool:
    """Append session_id under `observed_sessions:` in session.yml (adoption).

    Idempotent; pure text edit like register-impl-session.register_session,
    2-space list indentation matching the existing blocks.
    """
    if not session_id or session_id == "unknown":
        return False
    text = session_yml.read_text(encoding="utf-8") if session_yml.exists() else ""
    if re.search(rf'^\s*-\s*["\']?{re.escape(session_id)}["\']?\s*$', text, re.MULTILINE):
        return False
    item = f'  - "{session_id}"'
    lines = text.splitlines()
    key_idx = next(
        (i for i, ln in enumerate(lines) if re.match(r"^\s*observed_sessions\s*:", ln)),
        None)
    if key_idx is None:
        if lines and lines[-1].strip() == "":
            lines.pop()
        lines += ["observed_sessions:", item]
    else:
        lines.insert(key_idx + 1, item)
    session_yml.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return True


def resolve_capture_session(project_dir: Path, session_id: str | None) -> Path | None:
    """The Session dir a Stop/SubagentStop cost capture belongs to.

    Stop hooks carry no Work Packet, so resolve_dispatch_session can't anchor
    them; this is the observed-mode counterpart. Order:
      1. The registered owner (observed_sessions) wins — even closed, so the
         final post-close Stop still lands on the right dir.
      2. Otherwise route as today (newest-mtime); if that target is an OPEN
         observed dir and the id is trustworthy, ADOPT the chat session there,
         making ownership sticky for every later Stop.
      3. A CLOSED observed target that never owned this chat session gets
         nothing: unowned work after close is out of contract (the OBS-002
         25h-window contamination), and a silent wrong attribution is worse
         than no capture.
    Non-observed (pipeline) dirs keep today's behavior untouched.
    """
    owner = find_owner_session(project_dir, session_id)
    if owner is not None:
        return owner
    target = find_active_session(Path(project_dir))
    if target is None:
        return None
    yml = target / "session.yml"
    if read_yaml_scalar(yml, "mode") != "observed":
        return target
    if (read_yaml_scalar(yml, "status") or "") in _TERMINAL_STATUS:
        # mtime-newest is a CLOSED observed dir — it cannot adopt. If an OPEN
        # observed session exists, the capture belongs to it (else the cost is
        # silently discarded). SDD/pipeline dirs are unaffected — they already
        # returned at the mode!=observed check above.
        rescue = find_open_observed_session(Path(project_dir))
        if rescue is None:
            return None
        target = rescue
        yml = target / "session.yml"
    if session_id and session_id != "unknown":
        try:
            register_observed_session(yml, session_id)
        except OSError:
            pass  # fail-open: adoption is provenance, capture still proceeds
    return target


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
    Skip sessions that clearly never entered Phase 4 — avoids blocking
    unrelated chats while a FEAT folder exists.
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
