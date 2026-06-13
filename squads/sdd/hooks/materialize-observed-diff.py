#!/usr/bin/env python3
"""ai-squad Stop hook — materialize-observed-diff.

Freezes `git diff <base_sha>` into .agent-session/<id>/diff.json for an
observed session, so the aiOS reads a stable snapshot (immune to later work in
the repo). Falls back to HEAD when base_sha is absent (old sessions). Observed
sessions only; SDD sessions keep using report.html. Fail-open.
"""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import (  # noqa: E402
    resolve_project_root, resolve_capture_session, read_yaml_scalar,
)


def _git(repo, *args):
    return subprocess.run(["git", "-C", str(repo), *args],
                          capture_output=True, text=True, timeout=20)


def build_diff(repo: Path, base: str) -> dict:
    numstat = _git(repo, "diff", "--numstat", base)
    files = []
    for line in numstat.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added_s, removed_s, path = parts
        patch = _git(repo, "diff", base, "--", path).stdout
        files.append({
            "path": path,
            "added": None if added_s == "-" else int(added_s),
            "removed": None if removed_s == "-" else int(removed_s),
            "patch": patch,
        })
    return {
        "base_sha": base,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "files": files,
    }


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    repo = Path(resolve_project_root(payload))
    session_id = payload.get("session_id") or "unknown"
    session_dir = resolve_capture_session(repo, session_id)
    if session_dir is None:
        return 0

    yml = session_dir / "session.yml"
    if read_yaml_scalar(yml, "mode") != "observed":
        return 0  # SDD usa report.html

    base = read_yaml_scalar(yml, "base_sha") or "HEAD"  # fallback graceful
    try:
        data = build_diff(repo, base)
        out = session_dir / "diff.json"
        tmp = out.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(out)  # atomic
    except Exception as exc:  # fail-open
        print(f"materialize-observed-diff: {exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
