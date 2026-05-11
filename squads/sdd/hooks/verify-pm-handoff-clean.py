#!/usr/bin/env python3
"""
ai-squad Stop hook — verify-pm-handoff-clean.

Wired to the pm Skill's frontmatter. Fires when the pm Skill attempts to end
its session. Refuses to allow stop if the working tree contains any of the
canonical debt markers:

  TODO  FIXME  xfail  @skip  pending  mock-only

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
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from _pm_shared import enumerate_working_tree_files, grep_debt_markers
from hook_runtime import resolve_project_root

# ---------------------------------------------------------------------------
# Hard-coded canonical debt-marker pattern (spec-frozen, do not modify here —
# change the spec first).
#
# Word-boundary notes:
#   - \bTODO\b, \bFIXME\b, \bxfail\b, \bpending\b: standard \b anchors work
#     because these tokens consist entirely of word characters (\w).
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
    r"\b(TODO|FIXME|xfail|pending)\b"
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
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(
            f"verify-pm-handoff-clean: malformed stdin ({exc})", file=sys.stderr
        )
        return 0

    # Guard against infinite stop-hook loop.
    if payload.get("stop_hook_active"):
        return 0

    project_dir = resolve_project_root(payload)

    # Enumerate working tree files (git ls-files primary, rglob fallback).
    # Excludes are applied inside enumerate_working_tree_files via _pm_shared.
    files = enumerate_working_tree_files(project_dir)

    # Grep for debt markers across all enumerated files.
    # Pass project_dir as root so exempt canonical sources are skipped.
    matches = grep_debt_markers(files, [_DEBT_PATTERN], root=project_dir)

    if not matches:
        # AC-002: zero matches → allow Stop
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
