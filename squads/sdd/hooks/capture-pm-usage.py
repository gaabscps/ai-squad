#!/usr/bin/env python3
"""
ai-squad Stop hook — capture-pm-usage.

Fires when the PM Skill's main session ends (Stop event).

Capture strategy (AC-013):
  1. Platform-captured path: hook payload contains a top-level ``usage``
     dict with token telemetry from Claude Code.  Source = "platform_captured".
  2. Self-reported path (fallback): payload lacks ``usage`` but
     ``.agent-session/<task_id>/pm_handoff.json`` exists — written by the PM
     Skill at handoff time with pre-computed usage.  Source = "self_reported".
  3. Both absent: no entry written; logs a warning to stderr; still allows.

Appends to ``dispatch-manifest.json.pm_sessions[]`` via
``_pm_shared.atomic_manifest_mutate`` (tmp + rename with fcntl.flock).

This is an INFORMATIONAL hook: it ALWAYS emits ``{decision: "allow"}``.
It never blocks a session Stop, regardless of capture outcome.

Conformance:
  - pm_sessions[] entry shape per shared/schemas/dispatch-manifest.schema.json v2.
  - AC-013 (capture + source provenance).
  - NFR-001 (5s timeout convention — no long-running I/O paths; manifest write is atomic).

Python 3.8+. No external dependencies (stdlib only).
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from _pm_shared import atomic_manifest_mutate
from hook_runtime import resolve_project_root

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Pricing constants for platform-captured cost estimation.
# These are approximate defaults; exact values depend on model + date.
# When the payload includes a pre-computed cost_usd field, we use that instead.
# Cost per million tokens (USD):
_DEFAULT_INPUT_COST_PER_M = 3.0    # claude-sonnet pricing (input)
_DEFAULT_OUTPUT_COST_PER_M = 15.0  # claude-sonnet pricing (output)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_valid_iso(value: Any) -> bool:
    """Return True if *value* is a string parseable as ISO 8601."""
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except (ValueError, AttributeError):
        return False


def _safe_int(value: Any, default: int = 0) -> int:
    """Convert *value* to non-negative int, returning *default* on failure."""
    try:
        result = int(value)
        return max(0, result)
    except (TypeError, ValueError):
        return default


def _estimate_cost_usd(usage: dict) -> float:
    """Rough cost estimate from token counts (USD).

    Prefers the ``cost_usd`` field if already present in *usage*.
    Falls back to a token-count estimate using default sonnet pricing.
    Cache tokens are billed at a lower rate; we approximate by treating
    cache_read_input_tokens as ~10% of normal input cost and
    cache_creation_input_tokens at normal input cost.
    """
    if isinstance(usage.get("cost_usd"), (int, float)):
        return float(usage["cost_usd"])

    input_t = _safe_int(usage.get("input_tokens"))
    output_t = _safe_int(usage.get("output_tokens"))
    cache_create = _safe_int(usage.get("cache_creation_input_tokens"))
    cache_read = _safe_int(usage.get("cache_read_input_tokens"))

    cost = (
        (input_t + cache_create) / 1_000_000 * _DEFAULT_INPUT_COST_PER_M
        + output_t / 1_000_000 * _DEFAULT_OUTPUT_COST_PER_M
        + cache_read / 1_000_000 * _DEFAULT_INPUT_COST_PER_M * 0.1
    )
    return round(cost, 8)


def _build_entry_from_platform(
    session_id: str,
    usage_raw: dict,
    completed_at: str,
) -> dict:
    """Build a pm_sessions entry from platform-captured usage telemetry.

    total_tokens = input + output only; cache tokens are tracked separately
    in the cache_create/cache_read pattern (per schema convention).
    """
    input_t = _safe_int(usage_raw.get("input_tokens"))
    output_t = _safe_int(usage_raw.get("output_tokens"))
    # total_tokens: input + output only (cache billed separately; AC-013 schema)
    total_t = input_t + output_t

    # Validate started_at; fall back to completed_at when invalid.
    raw_started = usage_raw.get("started_at")
    started_at = raw_started if _is_valid_iso(raw_started) else completed_at

    return {
        "session_id": session_id,
        "started_at": started_at,
        "completed_at": completed_at,
        "usage": {
            "input_tokens": input_t,
            "output_tokens": output_t,
            "total_tokens": total_t,
            "cost_usd": _estimate_cost_usd(usage_raw),
        },
        "source": "platform_captured",
    }


def _build_entry_from_handoff(handoff: dict, completed_at: str) -> dict:
    """Build a pm_sessions entry from self-reported pm_handoff.json data."""
    raw_usage = handoff.get("usage")
    # Guard against non-dict usage field
    usage: dict = raw_usage if isinstance(raw_usage, dict) else {}

    input_t = _safe_int(usage.get("input_tokens"))
    output_t = _safe_int(usage.get("output_tokens"))
    total_t = _safe_int(usage.get("total_tokens"), default=input_t + output_t)
    cost = _estimate_cost_usd(usage)

    # Validate started_at / completed_at; fall back to hook's completed_at.
    raw_started = handoff.get("started_at")
    raw_completed = handoff.get("completed_at")
    started_at = raw_started if _is_valid_iso(raw_started) else completed_at
    completed_at_out = raw_completed if _is_valid_iso(raw_completed) else completed_at

    return {
        "session_id": handoff.get("session_id", f"pm-unknown-{uuid.uuid4().hex[:8]}"),
        "started_at": started_at,
        "completed_at": completed_at_out,
        "usage": {
            "input_tokens": input_t,
            "output_tokens": output_t,
            "total_tokens": total_t,
            "cost_usd": cost,
        },
        "source": "self_reported",
    }


def _append_pm_session(manifest: dict, entry: dict) -> dict:
    """Mutator for atomic_manifest_mutate: appends *entry* to pm_sessions[].

    Idempotency: skips append when pm_sessions[] already contains an entry
    with the same session_id (informational log written to stderr).
    """
    if not isinstance(manifest.get("pm_sessions"), list):
        manifest["pm_sessions"] = []

    new_sid = entry.get("session_id")
    for existing in manifest["pm_sessions"]:
        if isinstance(existing, dict) and existing.get("session_id") == new_sid:
            print(
                f"capture-pm-usage: session_id {new_sid!r} already in pm_sessions; skipping",
                file=sys.stderr,
            )
            return manifest

    manifest["pm_sessions"].append(entry)
    return manifest


def find_active_session(project_dir: Path) -> Path | None:
    """Return the most-recently-modified .agent-session/<task_id>/ directory.

    Prefers the CLAUDE_PROJECT_DIR env var (already resolved into project_dir
    by resolve_project_root) over the mtime-based heuristic.  The caller passes
    project_dir from resolve_project_root which already honours CLAUDE_PROJECT_DIR,
    so this function simply locates the most-recently-modified sub-directory.
    """
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    _allow = {"decision": "allow"}

    # ---------- parse stdin --------------------------------------------------
    try:
        payload: dict[str, Any] = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(
            f"capture-pm-usage: malformed stdin ({exc})", file=sys.stderr
        )
        print(json.dumps(_allow))
        return 0

    # ---------- re-entrancy guard -------------------------------------------
    if payload.get("stop_hook_active"):
        print(json.dumps(_allow))
        return 0

    # ---------- locate session dir + manifest --------------------------------
    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        print(json.dumps(_allow))
        return 0

    manifest_path = session_dir / "dispatch-manifest.json"
    if not manifest_path.exists():
        print(json.dumps(_allow))
        return 0

    # ---------- determine capture path ---------------------------------------
    # Generate a unique fallback session_id when none is provided.
    raw_session_id = payload.get("session_id")
    session_id: str = (
        raw_session_id if isinstance(raw_session_id, str) and raw_session_id.strip()
        else f"pm-unknown-{uuid.uuid4().hex[:8]}"
    )
    completed_at: str = _now_iso()

    usage_raw = payload.get("usage")
    entry: dict | None = None

    try:
        if isinstance(usage_raw, dict):
            # Path 1: platform-captured telemetry present in hook payload
            entry = _build_entry_from_platform(session_id, usage_raw, completed_at)
        else:
            # Path 2: fallback — read pm_handoff.json written by PM Skill at handoff
            handoff_path = session_dir / "pm_handoff.json"
            if handoff_path.exists():
                try:
                    handoff = json.loads(handoff_path.read_text(encoding="utf-8"))
                    if isinstance(handoff, dict):
                        entry = _build_entry_from_handoff(handoff, completed_at)
                except (OSError, json.JSONDecodeError) as exc:
                    print(
                        f"capture-pm-usage: cannot read pm_handoff.json ({exc})",
                        file=sys.stderr,
                    )
            else:
                # Path 3: both absent — warn, do not write entry
                print(
                    "capture-pm-usage: no usage telemetry in payload and no "
                    "pm_handoff.json found; pm_sessions entry NOT written",
                    file=sys.stderr,
                )
    except Exception as exc:  # noqa: BLE001
        print(
            f"capture-pm-usage: unexpected error building entry ({exc}); skipping write",
            file=sys.stderr,
        )
        entry = None

    # ---------- append to manifest -------------------------------------------
    if entry is not None:
        try:
            atomic_manifest_mutate(
                manifest_path,
                lambda doc: _append_pm_session(doc, entry),
            )
        except Exception as exc:
            print(
                f"capture-pm-usage: manifest update failed ({exc})",
                file=sys.stderr,
            )

    # ---------- always allow -------------------------------------------------
    print(json.dumps(_allow))
    return 0


if __name__ == "__main__":
    sys.exit(main())
