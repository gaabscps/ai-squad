"""
shared/lib/canonical_statuses.py — single source of truth for dispatch status and role enums.

Reads `shared/schemas/dispatch-manifest.schema.json` once at module-load time and
exposes:
  - VALID_STATUSES: frozenset of canonical (non-deprecated) dispatch status strings.
  - VALID_ROLES: frozenset of canonical dispatch role strings.
  - format_valid_list(values) -> str: sorted, comma-separated list of values.

Consumers (AC-002, AC-004):
  - `.claude/hooks/verify-output-packet.py` (hook validation, T-005)
  - `packages/agentops/src/canonical-statuses.ts` (TS module, T-003; reads schema directly)

Design constraints:
  - NO try/except swallowing: if the schema is missing or malformed, this module raises
    immediately at import time (fail-fast). Callers must ensure the schema exists.
  - Pure stdlib, Python 3.8+.
  - Module-level constants: schema is parsed once; I/O cost is paid at import, not per call.
  - Path resolution: `Path(__file__).resolve().parents[2] / "shared/schemas/..."` resolves
    from `shared/lib/` up to the project root (parents[2] == repo root), then down into
    `shared/schemas/`. Compatible with the `resolve_project_root` convention in `_pm_shared.py`.

Schema structure notes (FEAT-006 T-001 update):
  - `status` uses `anyOf` to mark 'partial' as deprecated. Non-deprecated values are in
    anyOf[0]["enum"] (the variant without `deprecated: true`).
  - `role` uses a plain `enum` including 'committer' (added T-001).
  - If T-001 has not yet run and `status` is still a plain `enum`, the plain-enum path
    is used as fallback. Either way, no edit to this module is needed (AC-004/AC-013).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import FrozenSet

# ---------------------------------------------------------------------------
# Schema path resolution
# ---------------------------------------------------------------------------
# Path(__file__).resolve() => /repo/shared/lib/canonical_statuses.py
# .parents[0]              => /repo/shared/lib
# .parents[1]              => /repo/shared
# .parents[2]              => /repo  (project root)
_PROJECT_ROOT: Path = Path(__file__).resolve().parents[2]
_SCHEMA_PATH: Path = _PROJECT_ROOT / "shared" / "schemas" / "dispatch-manifest.schema.json"

# ---------------------------------------------------------------------------
# Load schema — fail-fast (no try/except)
# ---------------------------------------------------------------------------
# FileNotFoundError if schema missing; json.JSONDecodeError if malformed;
# KeyError if schema structure is unexpected. All propagate to the caller.
_schema: dict = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))

# Navigate to dispatch item properties.
_dispatch_item_props: dict = (
    _schema["properties"]["actual_dispatches"]["items"]["properties"]
)


def _extract_status_enum(status_prop: dict) -> list:
    """Extract the canonical (non-deprecated) status values from the schema property.

    Handles two schema shapes:
      1. Plain enum: {"type": "string", "enum": [...]}
      2. anyOf with deprecated variant (FEAT-006 T-001):
         {"anyOf": [{"enum": [<canonical>], ...}, {"const": "partial", "deprecated": true, ...}]}

    Only values from variants without `"deprecated": true` are returned.
    Raises KeyError / ValueError if the structure is unrecognised — fail-fast.
    """
    if "enum" in status_prop:
        # Plain enum — all values are canonical.
        return list(status_prop["enum"])

    if "anyOf" in status_prop:
        values: list = []
        for variant in status_prop["anyOf"]:
            if variant.get("deprecated", False):
                # Skip deprecated variants (e.g. 'partial').
                continue
            if "enum" in variant:
                values.extend(variant["enum"])
            elif "const" in variant:
                values.append(variant["const"])
            else:
                raise KeyError(
                    f"unrecognized anyOf variant shape — expected 'enum' or 'const' keys, "
                    f"got {sorted(variant.keys())}"
                )
        if not values:
            raise ValueError(
                f"No non-deprecated status values found in anyOf: {status_prop}"
            )
        return values

    raise KeyError(
        f"Unrecognised status schema structure (expected 'enum' or 'anyOf'): "
        f"{list(status_prop.keys())}"
    )


# ---------------------------------------------------------------------------
# Public constants
# ---------------------------------------------------------------------------
VALID_STATUSES: FrozenSet[str] = frozenset(
    _extract_status_enum(_dispatch_item_props["status"])
)
"""Canonical set of dispatch status values derived from dispatch-manifest.schema.json.

Current values (as of FEAT-006 after T-001):
  blocked, done, escalate, failed, needs_changes, needs_review, pending, running

'partial' is NOT in this set — it is deprecated per AC-005 (FEAT-006 T-001) and
excluded from the canonical enum. Hook validation in verify-output-packet.py rejects
'partial' as a new status but agentops accepts it with a deprecation warning.
"""

VALID_ROLES: FrozenSet[str] = frozenset(
    _dispatch_item_props["role"]["enum"]
)
"""Canonical set of dispatch role values derived from dispatch-manifest.schema.json.

Current values (as of FEAT-006 after T-001):
  audit-agent, blocker-specialist, code-reviewer, committer, dev, logic-reviewer, qa

'committer' was added to the schema by T-001 and is automatically picked up here
without any edit to this module (AC-004/AC-013).
"""


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def format_valid_list(values: FrozenSet[str]) -> str:
    """Return a sorted, comma-separated string of *values*.

    Used in hook error messages to cite the full list of valid values
    without hardcoding it in the hook (AC-002, AC-013).

    Parameters
    ----------
    values:
        Any frozenset (or iterable) of strings.

    Returns
    -------
    str
        Sorted values joined by ', '. Empty frozenset returns ''.

    Examples
    --------
    >>> format_valid_list(frozenset({'done', 'blocked', 'escalate'}))
    'blocked, done, escalate'
    >>> format_valid_list(frozenset())
    ''
    """
    return ", ".join(sorted(values))
