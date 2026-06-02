#!/usr/bin/env python3
"""ai-squad Stop hook — generate-session-report.

On session end, render .agent-session/<FEAT>/report.html (cost + code review +
git diff) when a pipeline session is active. Guard: only runs if the session
has a costs/ dir (i.e. a pipeline ran). Fail-open — never blocks a session.
"""
import json
import subprocess
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

import session_report  # noqa: E402
from hook_runtime import find_active_session, resolve_project_root  # noqa: E402


def _git_diff_provider(repo_root):
    def provider(files):
        if not files:
            return ""
        try:
            out = subprocess.run(
                ["git", "-C", str(repo_root), "diff", "HEAD", "--", *files],
                capture_output=True, text=True, timeout=15,
            )
            return out.stdout
        except (OSError, subprocess.SubprocessError):
            return ""
    return provider


def generate(session_dir, diff_provider):
    try:
        session_dir = Path(session_dir)
        html = session_report.build_html_report(session_dir, diff_provider=diff_provider)
        if html is None:  # guard: no pipeline cost data -> no report
            return 0
        out = session_dir / "report.html"
        tmp = out.with_suffix(".html.tmp")
        tmp.write_text(html, encoding="utf-8")
        tmp.replace(out)  # atomic
    except Exception as e:  # fail-open
        print(f"generate-session-report: {e}", file=sys.stderr)
    return 0


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    repo_root = Path(resolve_project_root(payload))
    session_dir = find_active_session(repo_root)
    if session_dir is None:
        return 0
    return generate(session_dir, _git_diff_provider(repo_root))


if __name__ == "__main__":
    sys.exit(main())
