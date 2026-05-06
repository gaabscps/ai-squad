#!/usr/bin/env python3
"""
Merge squads/sdd/hooks/cursor-hooks.json into the user's ~/.cursor/hooks.json.

Appends ai-squad hook definitions without removing existing entries. De-duplicates
by identical \"command\" string within each hook event bucket. Backs up the
previous hooks.json once per run.
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
FRAGMENT = REPO_ROOT / "squads" / "sdd" / "hooks" / "cursor-hooks.json"
USER_HOOKS = Path.home() / ".cursor" / "hooks.json"


def main() -> int:
    if not FRAGMENT.is_file():
        print(f"ERROR: missing {FRAGMENT}", file=sys.stderr)
        return 1

    fragment = json.loads(FRAGMENT.read_text(encoding="utf-8"))
    frag_hooks = fragment.get("hooks") or {}
    if not isinstance(frag_hooks, dict):
        print("ERROR: fragment hooks must be an object", file=sys.stderr)
        return 1

    if USER_HOOKS.exists():
        user = json.loads(USER_HOOKS.read_text(encoding="utf-8"))
    else:
        user = {"version": 1, "hooks": {}}

    if not isinstance(user.get("hooks"), dict):
        user["hooks"] = {}
    user["version"] = user.get("version") or 1

    for event, entries in frag_hooks.items():
        if not isinstance(entries, list):
            continue
        user["hooks"].setdefault(event, [])
        bucket = user["hooks"][event]
        if not isinstance(bucket, list):
            user["hooks"][event] = []
            bucket = user["hooks"][event]
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            cmd = entry.get("command")
            if cmd and any(
                isinstance(e, dict) and e.get("command") == cmd for e in bucket
            ):
                continue
            bucket.append(entry)

    USER_HOOKS.parent.mkdir(parents=True, exist_ok=True)
    if USER_HOOKS.exists():
        bak = USER_HOOKS.with_name(f"hooks.json.bak.{int(datetime.now().timestamp())}")
        shutil.copy2(USER_HOOKS, bak)
        print(f"Backup: {bak}")

    USER_HOOKS.write_text(json.dumps(user, indent=2) + "\n", encoding="utf-8")
    print(f"Merged ai-squad entries into {USER_HOOKS}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
