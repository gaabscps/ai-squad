#!/usr/bin/env python3
"""
ai-squad CLI: python3 manifest_append.py <manifest_path>  (dispatch JSON on stdin)

Atomically append one dispatch entry to dispatch-manifest.json's
actual_dispatches[]. Replaces the orchestrator's by-hand JSON editing, which
could (and did) corrupt the manifest. Wraps _pm_shared.atomic_manifest_mutate
(tmp + rename + sidecar fcntl lock) so the write is atomic and concurrency-safe.

stdin: a single JSON object — the actual_dispatches[] entry to append.
stdout (success): {"appended": true, "actual_dispatches_count": <n>}  -> exit 0
stderr (failure): {"appended": false, "error": "<reason>"}            -> exit 1

Pure stdlib. Python 3.8+.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from _pm_shared import atomic_manifest_mutate


def _fail(reason: str) -> int:
    print(json.dumps({"appended": False, "error": reason}), file=sys.stderr)
    return 1


# Roles whose dispatch entry must carry a concrete review_loop (integer >= 1).
# Pipeline-scoped roles (audit-agent, committer) derive review_loop differently
# (audit step 8, blocker handling) and are exempt here.
_REVIEW_LOOP_REQUIRED_ROLES = {"dev", "code-reviewer", "logic-reviewer", "qa"}


def _validate_entry(entry: dict):
    """FEAT-041 shift-left of audit sweep (d): a task-scoped dispatch entry must
    record a concrete review_loop (integer >= 1). The defect was dev fix-dispatch
    entries written with review_loop: null — well-formed JSON that the manifest
    accepted, surfacing only at the final audit gate where recovery costs a full
    --restart. Catch it at the write point instead. Returns an error string, or
    None when the entry is acceptable.

    Scope note: this enforces presence/validity (>= 1), not the sweep's stricter
    ">= 2 on a fix-dispatch" rule — that needs cross-dispatch context the append
    site lacks, so the audit sweep stays the backstop for the >= 2 nuance.
    """
    role = entry.get("role")
    if role not in _REVIEW_LOOP_REQUIRED_ROLES:
        return None
    if "review_loop" not in entry:
        return (
            f"dispatch entry for role '{role}' is missing required field "
            "'review_loop' (integer >= 1)"
        )
    rl = entry["review_loop"]
    # bool is an int subclass — reject True/False explicitly so review_loop: true
    # does not masquerade as a valid integer.
    if isinstance(rl, bool) or not isinstance(rl, int) or rl < 1:
        return (
            f"dispatch entry for role '{role}' has invalid review_loop={rl!r} "
            "(must be an integer >= 1; null/0 means the orchestrator failed to "
            "increment task_states loops before appending)"
        )
    return None


def main(argv: list[str]) -> int:
    if len(argv) < 1:
        return _fail("usage: manifest_append.py <manifest_path> (dispatch JSON on stdin)")
    manifest_path = Path(argv[0])

    try:
        raw = sys.stdin.read()
        entry = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        return _fail(f"malformed dispatch JSON on stdin ({exc})")
    if not isinstance(entry, dict):
        return _fail("dispatch entry must be a JSON object")

    entry_error = _validate_entry(entry)
    if entry_error is not None:
        return _fail(entry_error)

    # count_holder smuggles the post-append length out of the mutator closure
    # (the mutator runs inside atomic_manifest_mutate; a plain int can't be rebound across that call).
    count_holder = {}

    def mutator(doc: dict) -> dict:
        dispatches = doc.get("actual_dispatches")
        if not isinstance(dispatches, list):
            dispatches = []
            doc["actual_dispatches"] = dispatches
        dispatches.append(entry)
        count_holder["n"] = len(dispatches)
        return doc

    try:
        atomic_manifest_mutate(manifest_path, mutator)
    except FileNotFoundError:
        return _fail(f"manifest not found: {manifest_path}")
    except json.JSONDecodeError as exc:
        return _fail(f"manifest is not valid JSON ({exc})")
    except OSError as exc:
        return _fail(f"manifest write failed ({exc})")

    print(json.dumps({"appended": True, "actual_dispatches_count": count_holder["n"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
