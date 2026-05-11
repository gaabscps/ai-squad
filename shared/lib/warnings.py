#!/usr/bin/env python3
"""
shared/lib/warnings.py — structured warning helper for ai-squad hooks.

Exposes append_warning() for writing entries to
.agent-session/<task_id>/warnings.json in a schema-consistent,
atomic, append-only manner.

Schema (warnings.json):
  {
    "schema_version": 1,
    "warnings": [
      {
        "id": "<uuid4>",
        "timestamp": "<iso8601>",
        "source": "<caller>",
        "reason": "<short_snake_case>",
        "severity": "info|warning|error",
        "metadata": {<arbitrary>}
      }
    ]
  }

Security: task_id is validated against ^FEAT-\\d{3,4}$ before any file op.
PII must NOT be placed in metadata.
Atomic write: fcntl.LOCK_EX on the file during read-modify-write.
Pure stdlib. Python 3.8+.
"""

import fcntl
import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_TASK_ID_RE = re.compile(r"^(FEAT|DISC)-\d{3,4}$")
_VALID_SEVERITIES = {"info", "warning", "error"}
_SCHEMA_VERSION = 1


def _agent_session_root() -> Path:
    """Locate .agent-session/ relative to the repo root.

    Walks upward from this file's location looking for .agent-session/.
    Falls back to cwd if not found — callers pass task_id, not full path,
    so the root must be discoverable.
    """
    candidate = Path(__file__).resolve()
    for parent in candidate.parents:
        if (parent / ".agent-session").is_dir():
            return parent / ".agent-session"
    # fallback: use cwd
    return Path.cwd() / ".agent-session"


def append_warning(
    task_id: str,
    reason: str,
    source: str,
    metadata: dict[str, Any] | None = None,
    severity: str = "warning",
) -> dict[str, Any]:
    """Append a warning entry to .agent-session/<task_id>/warnings.json.

    Parameters
    ----------
    task_id:  Session identifier, e.g. 'FEAT-003'. Must match ^FEAT-\\d{3,4}$.
    reason:   Short snake_case reason string, e.g. 'empty_transcript'.
    source:   Emitter name, e.g. 'capture-pm-session' or 'verify-output-packet'.
    metadata: Optional dict of additional context. Must not contain PII.
    severity: One of 'info', 'warning', 'error'. Defaults to 'warning'.

    Returns
    -------
    The warning entry dict that was written.

    Raises
    ------
    ValueError: if task_id does not match ^FEAT-\\d{3,4}$ or severity is invalid.
    """
    if not _TASK_ID_RE.match(task_id):
        raise ValueError(
            f"Invalid task_id '{task_id}': must match ^FEAT-\\d{{3,4}}$"
        )
    if severity not in _VALID_SEVERITIES:
        raise ValueError(
            f"Invalid severity '{severity}': must be one of {sorted(_VALID_SEVERITIES)}"
        )

    warnings_path = _agent_session_root() / task_id / "warnings.json"
    warnings_path.parent.mkdir(parents=True, exist_ok=True)

    entry: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "reason": reason,
        "severity": severity,
        "metadata": metadata if metadata is not None else {},
    }

    with warnings_path.open("a+", encoding="utf-8") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            fh.seek(0)
            raw = fh.read().strip()
            if raw:
                try:
                    doc = json.loads(raw)
                except json.JSONDecodeError:
                    doc = {"schema_version": _SCHEMA_VERSION, "warnings": []}
            else:
                doc = {"schema_version": _SCHEMA_VERSION, "warnings": []}

            if not isinstance(doc, dict):
                doc = {"schema_version": _SCHEMA_VERSION, "warnings": []}
            if not isinstance(doc.get("warnings"), list):
                doc["warnings"] = []
            doc["schema_version"] = _SCHEMA_VERSION

            doc["warnings"].append(entry)

            fh.seek(0)
            fh.truncate()
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)

    return entry
