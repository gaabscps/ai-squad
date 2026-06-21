#!/usr/bin/env python3
"""ai-squad hook — track-trail (observability-OS shell).

PostToolUse(Bash): appends one carimbado line to .agent-session/<id>/trail.jsonl,
ONLY for free/observed, non-terminal sessions. Edits já vivem em edits.jsonl;
aqui só entra o que falta pro ponto-a-ponto (comandos). Pure stdlib, fail-open.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    resolve_project_root, resolve_capture_session,
    tool_input_dict, read_yaml_scalar, _TERMINAL_STATUS,
)

_MAX_SUMMARY = 200

# Invocação do helper trail-emit (script + subcomando), não mera menção ao arquivo.
_EMIT_INVOCATION = re.compile(r"""trail-emit\.py["']?\s+(decision|verify)\b""")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    if payload.get("tool_name") != "Bash":
        return 0

    cmd = (tool_input_dict(payload).get("command") or "").strip()
    if not cmd:
        return 0

    # Supressão: o helper trail-emit roda como Bash e já gravou a linha
    # decision/verify carimbada; não duplicar essa invocação como um marker run.
    # Casa só a invocação real (script + subcomando), não `cat trail-emit.py`.
    if _EMIT_INVOCATION.search(cmd):
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
    # Sessao de produto: a timeline fala a linguagem de produto (decisao,
    # pergunta, entregavel), nao comandos de shell. O marco run e ruido de
    # engenharia aqui, entao a trilha de produto nasce limpa na origem.
    if read_yaml_scalar(yml, "work_type") == "product":
        return 0

    event = {"at": _now(), "kind": "run", "tool": "Bash", "summary": cmd[:_MAX_SUMMARY], "result_ref": None}
    line = json.dumps(event, ensure_ascii=False)
    try:
        with (session_dir / "trail.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        print(f"track-trail: write failed ({exc})", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
