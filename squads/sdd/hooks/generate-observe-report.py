#!/usr/bin/env python3
"""ai-squad Stop hook — generate-observe-report.

On session end, render .agent-session/<id>/report.md + report.json (parecer
determinístico) for OBSERVED sessions. Guard: only mode: observed. Reusa o
extrator existente (build_delivery_facts, ramo 'observed') — sem LLM. Fail-open.
"""
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    resolve_project_root, resolve_capture_session, read_yaml_scalar,
)
from delivery_report import build_delivery_facts  # noqa: E402
from observe_report import build_observe_report_md  # noqa: E402


def _atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    root = Path(resolve_project_root(payload))
    session_id = payload.get("session_id") or "unknown"
    session_dir = resolve_capture_session(root, session_id)
    if session_dir is None:
        return 0
    if read_yaml_scalar(session_dir / "session.yml", "mode") != "observed":
        return 0
    try:
        facts = build_delivery_facts(str(session_dir))
        _atomic_write(session_dir / "report.json", json.dumps(facts, indent=2, ensure_ascii=False))
        _atomic_write(session_dir / "report.md", build_observe_report_md(facts))
    except Exception as exc:  # fail-open
        print(f"generate-observe-report: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
