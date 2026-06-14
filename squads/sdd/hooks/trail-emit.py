#!/usr/bin/env python3
"""ai-squad helper — trail-emit (observability-OS shell).

Model-invoked, NOT a hook: the model runs
  python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/trail-emit.py" decision \
      --what "..." [--why "..."] [--rejected "..."] [--ref "..."]
when it makes a real choice. The script resolves the open observed session,
stamps `at` mechanically and appends one {kind:"decision"} line to trail.jsonl.

The JSON line is built with json.dumps from argv, so shell quoting and accents
survive intact — the corruption mode a printf-based direct append would hit.
The companion hook track-trail.py suppresses the duplicate `run` line for this
command. Pure stdlib, fail-open: any error exits 0 without touching the file.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    resolve_project_root, read_yaml_scalar, _TERMINAL_STATUS,
)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _resolve_observed_session() -> Path | None:
    """The newest OPEN observed Session dir, or None.

    Filters candidates to mode==observed + non-terminal BEFORE picking the
    newest, so a more-recent non-observed sibling (e.g. an SDD dir) neither
    steals the decision nor makes the helper give up. Unlike track-trail.py
    this cannot honor the observed_sessions owner registry — the helper runs
    as a Bash command with no hook payload, so it has no session_id to anchor
    on; newest-open-observed is the best routing available here.
    """
    root = resolve_project_root(None)  # uses CLAUDE_PROJECT_DIR / cwd
    base = root / ".agent-session"
    if not base.is_dir():
        return None
    best: Path | None = None
    best_mtime = -1.0
    for d in base.iterdir():
        yml = d / "session.yml"
        if not yml.exists():
            continue
        if read_yaml_scalar(yml, "mode") != "observed":
            continue
        if (read_yaml_scalar(yml, "status") or "") in _TERMINAL_STATUS:
            continue
        try:
            mt = d.stat().st_mtime
        except OSError:
            continue
        if mt > best_mtime:
            best, best_mtime = d, mt
    return best


def _emit_decision(args: argparse.Namespace) -> int:
    session_dir = _resolve_observed_session()
    if session_dir is None:
        return 0
    event = {
        "at": _now(),
        "kind": "decision",
        "what": args.what,
        "why": args.why,
        "rejected": args.rejected,
        "ref": args.ref,
    }
    line = json.dumps(event, ensure_ascii=False)
    try:
        with (session_dir / "trail.jsonl").open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:
        print(f"trail-emit: write failed ({exc})", file=sys.stderr)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="trail-emit", add_help=True)
    sub = parser.add_subparsers(dest="kind")

    p_dec = sub.add_parser("decision", help="record a decision marker")
    p_dec.add_argument("--what", required=True)
    p_dec.add_argument("--why", default=None)
    p_dec.add_argument("--rejected", default=None)
    p_dec.add_argument("--ref", default=None)

    try:
        args = parser.parse_args(argv)
    except SystemExit:
        return 0  # malformed args: fail-open, never derail the session
    if args.kind == "decision":
        return _emit_decision(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
