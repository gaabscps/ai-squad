#!/usr/bin/env python3
"""ai-squad hook — track-edits (observability-OS shell).

PostToolUse(Write|Edit|MultiEdit): appends one carimbado line per edited file
to .agent-session/<id>/edits.jsonl, ONLY for free/observed, non-terminal
sessions. Edits inside .agent-session/ are skipped (the trail must not record
itself). Pure stdlib, fail-open.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    resolve_project_root, resolve_capture_session,
    tool_input_dict, edit_target_path, read_yaml_scalar, _TERMINAL_STATUS,
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0

    target = edit_target_path(tool_input_dict(payload))
    if not target:
        return 0

    root = Path(resolve_project_root(payload))
    session_id = payload.get("session_id") or "unknown"
    session_dir = resolve_capture_session(root, session_id)
    if session_dir is None:
        return 0

    yml = session_dir / "session.yml"
    if read_yaml_scalar(yml, "mode") != "observed":
        return 0
    if (read_yaml_scalar(yml, "status") or "") in _TERMINAL_STATUS:
        return 0

    # Normaliza para caminho relativo ao projeto; ignora edições internas.
    abs_target = (root / target).resolve() if not Path(target).is_absolute() else Path(target).resolve()
    try:
        rel = abs_target.relative_to(root)
    except ValueError:
        return 0  # fora do projeto
    if rel.parts and rel.parts[0] == ".agent-session":
        return 0  # não registra a própria trilha

    line = json.dumps({"at": _now(), "file": str(rel)}, ensure_ascii=False)
    try:
        with (session_dir / "edits.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        print(f"track-edits: write failed ({exc})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
