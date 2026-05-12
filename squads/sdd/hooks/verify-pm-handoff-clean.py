#!/usr/bin/env python3
"""
ai-squad Stop hook — verify-pm-handoff-clean.

Wired to the pm Skill's frontmatter. Fires when the pm Skill attempts to end
its session. Refuses to allow stop if the working tree contains any of the
canonical debt markers:

  TODO  FIXME  xfail  @skip  pending (annotation-prefix only)  mock-only

Excludes:
  .agent-session/  node_modules/  vendor/  dist/  build/  .next/

Output JSON contract (Claude Code hook):
  {decision: "block"|"allow", evidence?: [...], reason?: str}

When blocking: reason is a markdown table (NFR-003) listing every match as
  | file:line | marker | snippet |

When allowing: emits {} (empty stdout — Claude Code treats empty stdout as
implicit allow; explicit {"decision":"allow"} is also accepted).

Honors `stop_hook_active` to avoid infinite blocking loops.

Pure stdlib. Python 3.8+.
"""
from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from _pm_shared import enumerate_working_tree_files, grep_debt_markers
from hook_runtime import resolve_project_root

# ---------------------------------------------------------------------------
# Soft budget for the scan operation (NFR-001: hook must complete within 5 s).
# 4.5 s leaves 0.5 s margin for JSON serialisation and process overhead.
# ---------------------------------------------------------------------------
_SCAN_TIMEOUT_SECS: float = 4.5

# ---------------------------------------------------------------------------
# Hard-coded canonical debt-marker pattern (spec-frozen, do not modify here —
# change the spec first).
#
# Word-boundary notes:
#   - \bTODO\b, \bFIXME\b, \bxfail\b: standard \b anchors work because these
#     tokens consist entirely of word characters (\w).
#   - pending: restricted to annotation-prefix syntax only — @pending,
#     // pending, /* pending, # pending. Bare "pending" (e.g. "pending save",
#     React isPending, HTTP pending request) is NOT a debt marker.  The capture
#     group (pending) ensures the extracted marker text is "pending", not the
#     full prefix+word match.
#   - @skip: the @ character is a non-word char so \b before it anchors
#     correctly. The lookahead (?![-\w]) blocks "false positives" like
#     "@skip-slow" (trailing hyphen is also excluded).
#   - mock-only: hyphens are non-word chars; we need lookaround on both sides.
#     (?<!\w) prevents matching "nomock-only"; (?![-\w]) prevents "mock-only-x".
#
# The pattern is intentionally identical to _CANONICAL_PATTERN in test_pm_shared.py
# and must stay in sync with it.
# ---------------------------------------------------------------------------
_DEBT_PATTERN = (
    r"\b(TODO|FIXME|xfail)\b"
    r"|(?:@|//\s*|/\*\s*|#\s*)(pending)\b"
    r"|(?<!\w)(@skip)(?![-\w])"
    r"|(?<!\w)(mock-only)(?![-\w])"
)


def _build_markdown_table(matches: list[dict]) -> str:
    """Render match list as a markdown table (NFR-003).

    Columns: File:Line | Marker | Snippet
    """
    rows = ["| File:Line | Marker | Snippet |", "| --- | --- | --- |"]
    for m in matches:
        file_path = m["file"]
        line = m["line"]
        marker = m["marker"]
        snippet = m["snippet"].replace("|", r"\|")  # escape table-breaking pipes
        # Show relative path when possible for readability
        try:
            rel = str(Path(file_path).relative_to(Path.cwd()))
        except ValueError:
            rel = file_path
        rows.append(f"| {rel}:{line} | `{marker}` | {snippet} |")
    return "\n".join(rows)


def main() -> int:
    _output_written = False
    try:
        try:
            payload = json.load(sys.stdin)
        except json.JSONDecodeError as exc:
            print(
                f"verify-pm-handoff-clean: malformed stdin ({exc})", file=sys.stderr
            )
            _output_written = True  # intentional allow (malformed payload)
            return 0

        # Guard against infinite stop-hook loop.
        if payload.get("stop_hook_active"):
            _output_written = True  # intentional allow
            return 0

        project_dir = resolve_project_root(payload)

        # -----------------------------------------------------------------------
        # AC-003 / NFR-001: wrap scan in try/except + 4.5 s soft budget.
        # On any exception or timeout → block with reason "scan_failed: <detail>".
        # Never silently allow on scan error.
        # -----------------------------------------------------------------------
        _result: dict = {}
        _exc: list[BaseException] = []

        def _run_scan() -> None:
            try:
                # Enumerate working tree files (git ls-files primary, rglob fallback).
                # Excludes are applied inside enumerate_working_tree_files via _pm_shared.
                files = enumerate_working_tree_files(project_dir)

                # Grep for debt markers across all enumerated files.
                # Pass project_dir as root so exempt canonical sources are skipped.
                matches = grep_debt_markers(files, [_DEBT_PATTERN], root=project_dir)
                _result["matches"] = matches
            except BaseException as exc:  # noqa: BLE001
                _exc.append(exc)

        scan_thread = threading.Thread(target=_run_scan, daemon=True)
        scan_thread.start()
        scan_thread.join(timeout=_SCAN_TIMEOUT_SECS)

        if scan_thread.is_alive():
            # Timeout: scan thread is still running — block with scan_failed:timeout.
            block = {
                "decision": "block",
                "reason": "scan_failed: timeout — scan exceeded 4.5 s budget",
            }
            print(json.dumps(block))
            _output_written = True  # intentional block
            return 1

        if _exc:
            # Exception raised inside scan thread — block with scan_failed:<err>.
            block = {
                "decision": "block",
                "reason": f"scan_failed: {type(_exc[0]).__name__}",
            }
            print(json.dumps(block))
            _output_written = True  # intentional block
            return 1

        matches = _result.get("matches", [])

        if not matches:
            # AC-002: zero matches → allow Stop
            _output_written = True  # intentional allow
            return 0

        # AC-001: one or more matches → block with evidence + markdown table reason
        table = _build_markdown_table(matches)
        reason = (
            f"PM handoff blocked: {len(matches)} debt marker(s) found in working tree.\n\n"
            f"Resolve all markers before emitting the final handoff:\n\n"
            f"{table}"
        )

        decision = {
            "decision": "block",
            "evidence": matches,
            "reason": reason,
        }
        print(json.dumps(decision))
        _output_written = True
        return 0
    finally:
        if not _output_written:
            print(json.dumps({
                "decision": "block",
                "reason": "scan_failed: hook terminated unexpectedly",
            }))
            sys.exit(1)


if __name__ == "__main__":
    sys.exit(main())
