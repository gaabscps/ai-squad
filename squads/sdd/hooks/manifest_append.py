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
