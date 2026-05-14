#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — verify-tier-calibration.

Wired to the orchestrator Skill's frontmatter with matcher "Task".
Fires on every Task tool invocation the orchestrator attempts.

Phase 1 (T-008 / AC-006, AC-007):
  - Parse the Task `prompt` argument for a `WorkPacket:` fenced YAML block.
  - Extract task_id, model, effort, tier, subagent_type from the Work Packet.
  - Short-circuit allow when:
      a) subagent_type in {audit-agent, blocker-specialist}  (AC-007)
      b) model or effort are absent                          (AC-006)
  - All other paths delegate to _verify_tier_calibration_for_task().

Phase 2 (T-009 / AC-005, AC-008): lookup table + loop-kind derivation.
  - Canonical Tier × Loop table mirrored from shared/concepts/effort.md.
  - Loop-kind derived from dispatch-manifest.json actual_dispatches[].
  - tasks.md Tier: field read from .agent-session/<task_id>/tasks.md.
  - Mtime cache in /tmp to minimise repeated disk reads (NFR-004 < 50ms).
  - tier_missing block when tasks.md lacks Tier: (AC-008).
  - tier_calibration_mismatch block when model/effort diverge (AC-005).

Output per Claude Code PreToolUse hook contract:
  stdout: JSON  {decision: "allow"}
              | {decision: "block", reason: str}

Python 3.8+. No external dependencies (stdlib only).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import detect_active_skill

# ---------------------------------------------------------------------------
# Roles that are tier-independent — always allowed (AC-007).
# ---------------------------------------------------------------------------
_TIER_INDEPENDENT_ROLES = frozenset(
    {"audit-agent", "blocker-specialist"}
)

# ---------------------------------------------------------------------------
# Pattern that matches a WorkPacket fenced YAML block in a Task prompt.
#
# The prompt may contain the block as:
#   ```yaml
#   WorkPacket:
#     field: value
#   ```
# OR (common in ai-squad dispatches):
#   WorkPacket:
#   ```yaml
#   field: value
#   ...
#   ```
#
# Strategy: find occurrences of "WorkPacket:" (case-sensitive) within or
# adjacent to fenced YAML blocks.  We do a minimal key=value parse with
# regex rather than importing PyYAML (no-external-deps constraint).
#
# If NO fenced block is found the hook emits silent allow WITHOUT parsing
# the prompt body — prevents stray top-level YAML from polluting fields.
# If MORE than one fenced block is found the hook emits a block decision.
# ---------------------------------------------------------------------------

# Extracts the body of the WorkPacket YAML block from:
#   WorkPacket:\n```yaml\n<body>\n```
_WORKPACKET_FENCED = re.compile(
    r"WorkPacket:\s*\n```(?:ya?ml)?\s*\n(.*?)```",
    re.DOTALL,
)

# OR from:
#   ```yaml\nWorkPacket:\n<body>\n```
_WORKPACKET_INLINE_FENCED = re.compile(
    r"```(?:ya?ml)?\s*\nWorkPacket:\s*\n(.*?)```",
    re.DOTALL,
)


def _extract_workpacket_body(prompt: str) -> str | None:
    """Return the raw YAML text of the WorkPacket block, or None if not found."""
    m = _WORKPACKET_FENCED.search(prompt)
    if m:
        return m.group(1)
    m = _WORKPACKET_INLINE_FENCED.search(prompt)
    if m:
        return m.group(1)
    return None


def _count_workpacket_blocks(prompt: str) -> int:
    """Return the total number of WorkPacket fenced blocks in the prompt."""
    fenced = _WORKPACKET_FENCED.findall(prompt)
    inline = _WORKPACKET_INLINE_FENCED.findall(prompt)
    return len(fenced) + len(inline)


# ---------------------------------------------------------------------------
# Minimal YAML key-value extractor (no PyYAML dependency).
#
# Handles:
#   key: value          → scalar string "value"
#   key: "value"        → scalar string "value" (strips quotes)
#   key: 'value'        → scalar string "value" (strips quotes)
#   key:                → empty string (or None below)
#
# Does NOT handle nested mappings, lists, or multi-line values — not needed
# for the flat WorkPacket structure being extracted here.
# ---------------------------------------------------------------------------

_KV_RE = re.compile(
    r"^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*?)[ \t]*$",
    re.MULTILINE,
)


def _parse_flat_yaml(text: str) -> dict[str, str]:
    """Minimal flat YAML → dict parser; values are raw strings (quotes stripped)."""
    result: dict[str, str] = {}
    for m in _KV_RE.finditer(text):
        key = m.group(1)
        raw_val = m.group(2).strip()
        # Strip surrounding quotes if present.
        if (raw_val.startswith('"') and raw_val.endswith('"')) or (
            raw_val.startswith("'") and raw_val.endswith("'")
        ):
            raw_val = raw_val[1:-1]
        result[key] = raw_val
    return result


def _extract_fields(prompt: str) -> dict[str, str] | None:
    """Extract Work Packet fields from a Task prompt string.

    Returns a dict with whatever keys are present, or None when no fenced
    WorkPacket block is found (caller must handle None as 'no block' case).

    Does NOT fall back to parsing the raw prompt body — stray top-level YAML
    outside a fenced block must never pollute Work Packet fields.
    """
    body = _extract_workpacket_body(prompt)
    if body is None:
        return None

    parsed = _parse_flat_yaml(body)

    # Normalise: accept snake_case and camelCase variants seen in the wild.
    fields: dict[str, str] = {}
    for src_key, canonical_key in (
        ("task_id", "task_id"),
        ("taskId", "task_id"),
        ("model", "model"),
        ("effort", "effort"),
        ("tier", "tier"),
        ("subagent_type", "subagent_type"),
        ("subagentType", "subagent_type"),
        # dispatch_id used to derive subagent_type when subagent_type absent
        ("dispatch_id", "dispatch_id"),
        ("dispatchId", "dispatch_id"),
    ):
        val = parsed.get(src_key, "")
        if val:
            fields[canonical_key] = val

    # If subagent_type is absent, try to infer from dispatch_id pattern like
    # "d-T-008-dev-l1" → subagent_type = "dev"
    # "d-audit-l1"    → subagent_type = "audit-agent"
    # "d-T-008-blocker-specialist-l1" → subagent_type = "blocker-specialist"
    if "subagent_type" not in fields:
        dispatch_id = fields.get("dispatch_id", "")
        inferred = _infer_subagent_type(dispatch_id)
        if inferred:
            fields["subagent_type"] = inferred

    return fields


# Mapping from dispatch_id segment patterns to subagent_type values.
_ROLE_SEGMENT_MAP = (
    ("blocker-specialist", "blocker-specialist"),
    ("audit-agent", "audit-agent"),
    ("audit", "audit-agent"),
    ("code-reviewer", "code-reviewer"),
    ("logic-reviewer", "logic-reviewer"),
    ("qa", "qa"),
    ("dev", "dev"),
)


def _infer_subagent_type(dispatch_id: str) -> str | None:
    """Attempt to infer subagent_type from a dispatch_id string."""
    lower = dispatch_id.lower()
    for segment, role in _ROLE_SEGMENT_MAP:
        if segment in lower:
            return role
    return None


# Matches the loop suffix in dispatch_id strings like "d-T-001-dev-l2" → 2.
_LOOP_SUFFIX_RE = re.compile(r"-l(\d+)$", re.IGNORECASE)


def _derive_loop_suffix_from_dispatch_id(dispatch_id: str) -> int | None:
    """Extract the loop number from a dispatch_id like 'd-T-001-dev-l2' → 2.

    Returns None when no recognizable suffix is found.
    """
    m = _LOOP_SUFFIX_RE.search(dispatch_id)
    if m:
        return int(m.group(1))
    return None


# ---------------------------------------------------------------------------
# T-009: Canonical Tier × Loop table
# Mirror of shared/concepts/effort.md — keep in sync
#
# Structure: _TIER_LOOP_TABLE[role_key][tier] = (model, effort)
#
# Role keys for dev use the full loop-kind string (e.g. "dev L1").
# Reviewer / qa roles are loop-independent — key is the role name only.
# ---------------------------------------------------------------------------

# See _TIER_LOOP_TABLE below for the full canonical model/effort pairs
# per (loop_kind_or_role, tier).

_TIER_LOOP_TABLE: dict[str, dict[str, tuple[str, str]]] = {
    "dev L1": {
        "T1": ("haiku", "high"),
        "T2": ("sonnet", "medium"),
        "T3": ("sonnet", "high"),
        "T4": ("sonnet", "high"),
    },
    "dev L2": {
        "T1": ("sonnet", "medium"),
        "T2": ("sonnet", "high"),
        "T3": ("sonnet", "high"),
        "T4": ("sonnet", "high"),
    },
    "dev L3": {
        "T1": ("sonnet", "high"),
        "T2": ("sonnet", "high"),
        "T3": ("sonnet", "high"),
        "T4": ("opus", "high"),
    },
    "dev qa-L1": {
        "T1": ("sonnet", "medium"),
        "T2": ("sonnet", "high"),
        "T3": ("sonnet", "high"),
        "T4": ("sonnet", "high"),
    },
    "dev qa-L2": {
        "T1": ("sonnet", "high"),
        "T2": ("sonnet", "high"),
        "T3": ("sonnet", "high"),
        "T4": ("opus", "high"),
    },
    # Reviewer / qa: loop-independent — key is role name only.
    # Loop_kind for these roles resolves to "<role> L1" but lookup uses role.
    "code-reviewer": {
        "T1": ("haiku", "high"),
        "T2": ("haiku", "high"),
        "T3": ("sonnet", "medium"),
        "T4": ("sonnet", "medium"),
    },
    "logic-reviewer": {
        "T1": ("sonnet", "medium"),
        "T2": ("sonnet", "medium"),
        "T3": ("sonnet", "high"),
        "T4": ("opus", "high"),
    },
    "qa": {
        "T1": ("haiku", "high"),
        "T2": ("haiku", "high"),
        "T3": ("sonnet", "medium"),
        "T4": ("sonnet", "high"),
    },
}

# Roles whose loop_kind key in the table is just the role name (loop-independent).
_LOOP_INDEPENDENT_ROLES = frozenset({"code-reviewer", "logic-reviewer", "qa"})


def _lookup_canonical(
    role: str,
    tier: str,
    loop_kind: str,
) -> tuple[str, str] | None:
    """Look up (model, effort) from the canonical Tier × Loop table.

    Returns None when role, tier, or loop_kind are not found in the table.
    """
    # Loop-independent roles: key is the role name directly.
    if role in _LOOP_INDEPENDENT_ROLES:
        role_entry = _TIER_LOOP_TABLE.get(role)
    else:
        # dev: key is the full loop_kind string (e.g. "dev L1").
        role_entry = _TIER_LOOP_TABLE.get(loop_kind)

    if role_entry is None:
        return None
    return role_entry.get(tier)


# ---------------------------------------------------------------------------
# T-009: Loop-kind derivation from dispatch-manifest.json actual_dispatches[]
# ---------------------------------------------------------------------------


def _derive_loop_kind(
    task_id: str,
    role: str,
    actual_dispatches: list[dict],
) -> str:
    """Derive the loop_kind for the current dispatch from prior dispatch history.

    Rules for dev:
      - Count prior dev dispatches for this task_id.
      - Count prior qa dispatches with pm_note containing "qa_fail".
      - If qa-fail count >= 2 → "dev qa-L2"
      - If qa-fail count >= 1 → "dev qa-L1"
      - Prior dev count == 0 → "dev L1"
      - Prior dev count == 1 → "dev L2"
      - Prior dev count >= 2 → "dev L3"

    For loop-independent roles (code-reviewer, logic-reviewer, qa):
      - Return "<role> L1" (loop_kind is not significant for table lookup).
    """
    if role in _LOOP_INDEPENDENT_ROLES:
        return f"{role} L1"

    if role == "dev":
        # Filter to dispatches for this specific task_id
        task_dispatches = [
            d for d in actual_dispatches
            if d.get("task_id") == task_id
        ]

        # Count prior qa-fail dispatches
        qa_fail_count = sum(
            1 for d in task_dispatches
            if d.get("role") == "qa"
            and isinstance(d.get("pm_note"), str)
            and "qa_fail" in d["pm_note"]
        )

        if qa_fail_count >= 2:
            return "dev qa-L2"
        if qa_fail_count >= 1:
            return "dev qa-L1"

        # Count prior dev dispatches
        prior_dev_count = sum(
            1 for d in task_dispatches
            if d.get("role") == "dev"
        )

        if prior_dev_count == 0:
            return "dev L1"
        if prior_dev_count == 1:
            return "dev L2"
        return "dev L3"

    # Unknown role: return "<role> L1" as a safe default.
    return f"{role} L1"


# ---------------------------------------------------------------------------
# T-009: tasks.md Tier: field reader + /tmp mtime cache
# ---------------------------------------------------------------------------

# Regex to extract Tier: field from tasks.md for a specific task section.
# Matches lines of the form:
#   **Tier:** T3
#   Tier: T2
# at the beginning of a line, optionally with bold markdown.
_TIER_FIELD_RE = re.compile(
    r"(?:^|\n)\s*(?:\*\*Tier:\*\*|Tier:)\s*(T[1-4])",
    re.MULTILINE,
)

# Cache entry: {task_id: {path_str: str, mtime: float, tier: str|None}}
_tier_cache: dict[str, dict] = {}


def _read_task_tier(task_id: str, session_dir: Path) -> str | None:
    """Read the Tier: field for *task_id* from its tasks.md file.

    Caches the result per-session in /tmp/ai-squad-tier-cache-<task_id>.json
    (keyed by tasks.md mtime) to satisfy NFR-004 latency requirements.

    Returns the tier string (e.g. "T3") or None when:
      - The tasks.md file does not exist.
      - The file exists but no Tier: line is found.
    """
    tasks_path = session_dir / task_id / "tasks.md"
    tasks_path_str = str(tasks_path)

    # Check in-process cache first (fastest path — avoids /tmp I/O on repeat calls).
    try:
        current_mtime = tasks_path.stat().st_mtime
    except (OSError, FileNotFoundError):
        # HOTFIX FEAT-006: fall back to the "1 dir per feature" convention.
        # The session_dir/<task_id>/tasks.md path (per-task convention) does not
        # exist. Identify the owning session by finding the dispatch-manifest.json
        # whose expected_pipeline references this task_id, then read THAT
        # session's tasks.md. This prevents cross-session contamination — older
        # sessions (FEAT-001..N) may have unrelated tasks reusing the same T-XXX
        # numbering. Only triggers for T-XXX task_ids; FEAT-NNN inputs preserve
        # original path. NOTE(FEAT-007): replace with proper session_id-based
        # resolution that gets the session_id directly from the Work Packet.
        if re.match(r"^T-\d+$", task_id):
            # T-XXX numbering is reused across features (FEAT-001 and FEAT-006 may
            # both have ## T-001 sections). Pick the manifest by recency: the
            # session actively being dispatched will have the most recently
            # modified dispatch-manifest.json (orchestrator appends entry
            # immediately before each Task tool call).
            owning_manifests: list[tuple[float, Path]] = []
            for manifest_path in session_dir.glob("*/dispatch-manifest.json"):
                try:
                    doc = json.loads(manifest_path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, OSError, ValueError):
                    continue
                expected = doc.get("expected_pipeline") or []
                if not isinstance(expected, list):
                    continue
                if not any(
                    isinstance(e, dict) and e.get("task_id") == task_id
                    for e in expected
                ):
                    continue
                try:
                    mtime = manifest_path.stat().st_mtime
                except OSError:
                    continue
                owning_manifests.append((mtime, manifest_path))
            for _mtime, manifest_path in sorted(owning_manifests, reverse=True):
                feat_tasks_path = manifest_path.parent / "tasks.md"
                try:
                    content = feat_tasks_path.read_text(encoding="utf-8", errors="replace")
                except (OSError, IOError):
                    continue
                tier = _extract_tier_for_task(content, task_id)
                if tier is not None:
                    return tier
        return None

    cached = _tier_cache.get(tasks_path_str)
    if cached is not None and cached["mtime"] == current_mtime:
        return cached["tier"]

    # Check /tmp disk cache (survives across multiple dispatches in same session).
    cache_path = Path(f"/tmp/ai-squad-tier-cache-{task_id}.json")
    try:
        with cache_path.open("r", encoding="utf-8") as fh:
            disk_cache = json.load(fh)
        if (
            disk_cache.get("path") == tasks_path_str
            and disk_cache.get("mtime") == current_mtime
        ):
            tier = disk_cache.get("tier")
            _tier_cache[tasks_path_str] = {"mtime": current_mtime, "tier": tier}
            return tier
    except (OSError, json.JSONDecodeError, KeyError):
        pass

    # Cache miss — read tasks.md.
    try:
        content = tasks_path.read_text(encoding="utf-8", errors="replace")
    except (OSError, IOError):
        return None

    # Find the section for task_id, then extract the first Tier: field within it.
    tier = _extract_tier_for_task(content, task_id)

    # Update caches.
    _tier_cache[tasks_path_str] = {"mtime": current_mtime, "tier": tier}
    try:
        cache_obj = {
            "path": tasks_path_str,
            "mtime": current_mtime,
            "tier": tier,
        }
        # Atomic write: tmp + rename.
        tmp_path = cache_path.with_suffix(".tmp")
        with tmp_path.open("w", encoding="utf-8") as fh:
            json.dump(cache_obj, fh)
        tmp_path.replace(cache_path)
    except OSError:
        pass  # Cache write failure is non-fatal.

    return tier


def _extract_tier_for_task(content: str, task_id: str) -> str | None:
    """Extract the Tier: value from *content* for the given *task_id*.

    Strategy:
      1. Find the task's section header (## T-XXX or ## T-XXX [P] ...).
      2. Extract content until the next ## -level header.
      3. Find the first `**Tier:**` / `Tier:` line in that slice.

    Returns the tier string (e.g. "T3") or None.
    """
    # Match section header: ## T-001 ... or ## T-001 [P] ...
    # task_id may be "T-001", "T-009", etc.
    escaped = re.escape(task_id)
    # Header pattern: ## T-009 followed by any characters on the same line
    section_re = re.compile(
        r"^##\s+" + escaped + r"\b.*$",
        re.MULTILINE,
    )
    m = section_re.search(content)
    if m is None:
        # Task section not found → return None so caller blocks with tier_missing.
        # Do NOT fall back to scanning the whole document: that would silently allow
        # wrong-tier dispatches when a task section is absent (AC-008 invariant).
        return None

    section_start = m.end()

    # Find next ## header (end of this task's section)
    next_section_re = re.compile(r"\n##\s+", re.MULTILINE)
    nm = next_section_re.search(content, section_start)
    section_end = nm.start() if nm else len(content)

    section_text = content[section_start:section_end]
    tier_m = _TIER_FIELD_RE.search(section_text)
    return tier_m.group(1) if tier_m else None


# ---------------------------------------------------------------------------
# T-009: Full Tier × Loop verification
# ---------------------------------------------------------------------------


def _resolve_session_dir() -> Path | None:
    """Return the .agent-session directory from CLAUDE_PROJECT_DIR env var.

    Returns None when the env var is absent or the directory does not exist.
    """
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not project_dir:
        return None
    agent_session_dir = Path(project_dir) / ".agent-session"
    if not agent_session_dir.is_dir():
        # Fallback: try the project dir itself as the session dir root.
        # (Some setups write session subdirs directly under CLAUDE_PROJECT_DIR.)
        pd = Path(project_dir)
        if pd.is_dir():
            return pd
        return None
    return agent_session_dir


# Sentinel: returned by _load_manifest_dispatches when no manifest file is found.
_MANIFEST_MISSING: list[dict] | None = None

# Sentinel string prefix stored in a tuple to distinguish malformed from missing.
# _load_manifest_dispatches returns:
#   _MANIFEST_MISSING        → no manifest file found (legitimate first dispatch)
#   ("malformed", "<err>")   → manifest file found but JSON is invalid
#   list[dict]               → parsed actual_dispatches[]


def _load_manifest_dispatches(
    session_dir: Path,
    task_id: str,
) -> "list[dict] | None | tuple[str, str]":
    """Load actual_dispatches[] from dispatch-manifest.json.

    Tries two paths:
      1. session_dir / dispatch-manifest.json  (root-level manifest)
      2. session_dir / task_id / dispatch-manifest.json  (task-level manifest)

    Returns:
      - list[dict]              when a valid manifest is found (may be empty list).
      - _MANIFEST_MISSING       when NO manifest file exists (legitimate first dispatch).
      - ("malformed", "<err>")  when a manifest file EXISTS but JSON is invalid or
                                actual_dispatches is not a list — caller MUST block.
    """
    # Primary candidates: the two historical paths (per-task and root-of-session-dir).
    primary_candidates = [
        session_dir / "dispatch-manifest.json",
        session_dir / task_id / "dispatch-manifest.json",
    ]

    # HOTFIX FEAT-006: also scan per-feature manifests under session_dir/*/dispatch-manifest.json
    # for the "1 dir per feature" convention. T-XXX numbering is reused across features, so
    # pick fallback candidates by mtime (most recent first) — the active session's manifest is
    # always the freshest one. Cross-session contamination is further guarded below via the
    # _is_referencing_task check. Only triggers for T-XXX task_ids.
    # NOTE(FEAT-007): replace with proper session_id-based resolution.
    fallback_candidates: list[Path] = []
    if re.match(r"^T-\d+$", task_id):
        scored: list[tuple[float, Path]] = []
        for cand in session_dir.glob("*/dispatch-manifest.json"):
            if cand in primary_candidates:
                continue
            try:
                scored.append((cand.stat().st_mtime, cand))
            except OSError:
                continue
        fallback_candidates = [p for _m, p in sorted(scored, reverse=True)]

    def _is_referencing_task(doc: dict) -> bool:
        expected = doc.get("expected_pipeline") or []
        if isinstance(expected, list):
            for entry in expected:
                if isinstance(entry, dict) and entry.get("task_id") == task_id:
                    return True
        dispatches = doc.get("actual_dispatches") or []
        if isinstance(dispatches, list):
            for entry in dispatches:
                if isinstance(entry, dict) and entry.get("task_id") == task_id:
                    return True
        return False

    for candidate in primary_candidates:
        if candidate.exists():
            try:
                doc = json.loads(candidate.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError, ValueError) as exc:
                return ("malformed", str(exc))
            dispatches = doc.get("actual_dispatches")
            if dispatches is None:
                return []
            if not isinstance(dispatches, list):
                return ("malformed", "actual_dispatches is not a list")
            return dispatches

    for candidate in fallback_candidates:
        try:
            doc = json.loads(candidate.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, ValueError):
            continue  # skip malformed fallback candidates; do not block on cross-session noise
        if not isinstance(doc, dict) or not _is_referencing_task(doc):
            continue
        dispatches = doc.get("actual_dispatches")
        if dispatches is None:
            return []
        if not isinstance(dispatches, list):
            return ("malformed", "actual_dispatches is not a list")
        return dispatches

    return _MANIFEST_MISSING


def _verify_tier_calibration_for_task(
    task_id: str,
    model: str,
    effort: str,
    tier: str,
    subagent_type: str,
    prompt: str,
    tool_model: str | None = None,
    session_dir: Path | None = None,
) -> dict:
    """Full Tier × Loop verification (T-009 / AC-005, AC-008, AC-009).

    Steps:
      1. Resolve session directory (CLAUDE_PROJECT_DIR env var or parameter).
      2. Read tasks.md to obtain the authoritative Tier: for the task.
         Block with tier_missing if absent (AC-008).
      3. Load dispatch-manifest.json actual_dispatches[] to derive loop_kind.
      4. Look up canonical (model, effort) from the Tier × Loop table.
      5. If `tool_model` was passed (Task tool `model` param), enforce
         it against canonical_model (AC-009 — root-cause fix for the
         "Work Packet declares haiku but subagent runs in opus" bug).
      6. Compare Work Packet model/effort against canonical when both are
         populated. Skip this comparison when the Work Packet omits them
         (AC-006 fallback — frontmatter default applies, but tool_model
         enforcement above still guards the actual run-model).

    Parameters:
      tool_model:  the `model` parameter actually passed to the Task tool
                   (sonnet|opus|haiku|""). When None (default), skip the
                   tool-model check — used by legacy unit tests that call
                   this function directly. main() always passes a string
                   (possibly empty) so production runs always enforce.
      session_dir: optional override for the .agent-session directory path.
                   When None, resolved via CLAUDE_PROJECT_DIR env var.
                   Useful in tests.
    """
    # Step 1: resolve session dir.
    if session_dir is None:
        session_dir = _resolve_session_dir()

    if session_dir is None:
        # No session dir available — cannot verify.  Fail open (allow) so
        # dispatches outside a formal .agent-session context are not blocked.
        # Empty dict = implicit allow (Claude Code rejects {"decision":"allow"}).
        return {}

    # Step 2: read Tier from tasks.md (authoritative).
    task_tier = _read_task_tier(task_id, session_dir)
    if task_tier is None:
        return {
            "decision": "block",
            "reason": f"tier_missing: tasks.md for {task_id} does not declare a Tier: field",
        }

    # Step 3: load manifest dispatches for loop-kind derivation.
    manifest_result = _load_manifest_dispatches(session_dir, task_id)

    if isinstance(manifest_result, tuple) and manifest_result[0] == "malformed":
        # Manifest file exists but is invalid JSON or has wrong schema.
        # Block — silently allowing would produce wrong loop_kind for L2/L3 (AC-005).
        return {
            "decision": "block",
            "reason": f"manifest_malformed: {manifest_result[1]}",
        }

    if manifest_result is _MANIFEST_MISSING:
        # No manifest found — legitimate for the very first dispatch (L1).
        # But if dispatch_id explicitly identifies an L2+ loop, something is wrong:
        # a manifest should already exist by that point in the pipeline.
        wp_body = _extract_workpacket_body(prompt) or ""
        wp_fields = _parse_flat_yaml(wp_body)
        dispatch_id_str = wp_fields.get("dispatch_id", "")
        loop_suffix = _derive_loop_suffix_from_dispatch_id(dispatch_id_str)
        if loop_suffix is not None and loop_suffix >= 2:
            return {
                "decision": "block",
                "reason": (
                    f"manifest_malformed: no dispatch-manifest.json found but "
                    f"dispatch_id '{dispatch_id_str}' suggests loop {loop_suffix} "
                    f"(task={task_id})"
                ),
            }
        actual_dispatches: list[dict] = []
    else:
        actual_dispatches = manifest_result

    # Step 4: derive loop_kind.
    loop_kind = _derive_loop_kind(task_id, subagent_type, actual_dispatches)

    # Step 5: look up canonical (model, effort).
    canonical = _lookup_canonical(subagent_type, task_tier, loop_kind)

    if canonical is None:
        # Unknown role or tier — cannot verify; fail open.
        return {}

    canonical_model, canonical_effort = canonical

    # ---- Step 5: enforce Task tool `model` param against canonical (AC-009) ----
    # This is the root-cause fix: the Work Packet YAML is descriptive, but the
    # actual model that runs the subagent is the `model` parameter passed to
    # the Task tool. If the orchestrator omits it, Claude Code inherits the
    # parent session's model (typically opus), bypassing the Tier × Loop table.
    if tool_model is not None:
        tool_model_norm = tool_model.strip().lower()
        if not tool_model_norm:
            return {
                "decision": "block",
                "reason": (
                    f"task_tool_model_missing: Task tool requires an explicit "
                    f"`model` parameter (expected '{canonical_model}') for "
                    f"task={task_id} (tier={task_tier}, loop_kind={loop_kind}). "
                    f"Omitting it causes the subagent to inherit the parent "
                    f"session's model and bypass tier calibration. "
                    f"Pass model='{canonical_model}' to the Task tool."
                ),
            }
        if tool_model_norm != canonical_model.lower():
            return {
                "decision": "block",
                "reason": (
                    f"task_tool_model_mismatch: Task tool `model` parameter "
                    f"'{tool_model_norm}' does not match canonical "
                    f"'{canonical_model}' for task={task_id} "
                    f"(tier={task_tier}, loop_kind={loop_kind}). The subagent "
                    f"would run on the wrong model. "
                    f"Pass model='{canonical_model}' to the Task tool."
                ),
            }

    # ---- Step 6: compare Work Packet model/effort against canonical (AC-005) ----
    # Skipped when either is absent (AC-006 fallback path).
    if model and effort:
        if model == canonical_model and effort == canonical_effort:
            return {}

        expected_str = f"{canonical_model}, {canonical_effort}"
        got_str = f"{model}, {effort}"
        return {
            "decision": "block",
            "reason": (
                f"tier_calibration_mismatch: expected {expected_str}, got {got_str} "
                f"(task={task_id}, tier={task_tier}, loop_kind={loop_kind})"
            ),
        }

    return {}


# ---------------------------------------------------------------------------
# Main hook logic
# ---------------------------------------------------------------------------


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        # Malformed stdin — fail open (allow) but log to stderr.
        print(f"verify-tier-calibration: malformed stdin ({exc})", file=sys.stderr)
        return 0

    # Skill-scope gate: this hook enforces tier calibration on Task dispatches
    # issued by the orchestrator Skill. When deploy registers it globally under
    # PreToolUse(Task), any non-orchestrator session would otherwise see every
    # Task call inspected and potentially blocked. Default: allow when the
    # active Skill is not positively identified as `orchestrator`.
    if detect_active_skill(payload) != "orchestrator":
        return 0

    # Extract the Task tool's `prompt` argument.
    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        tool_input = {}
    prompt = tool_input.get("prompt", "")
    if not isinstance(prompt, str):
        prompt = ""

    if not prompt:
        # No prompt → nothing to verify; silent allow.
        return 0

    # -----------------------------------------------------------------
    # Guard: multiple fenced WorkPacket blocks are ambiguous — block.
    # -----------------------------------------------------------------
    block_count = _count_workpacket_blocks(prompt)
    if block_count > 1:
        print(json.dumps({
            "decision": "block",
            "reason": "multiple WorkPacket blocks not supported; exactly one expected",
        }))
        return 0

    # -----------------------------------------------------------------
    # Extract fields.  None means no fenced block was found.
    # -----------------------------------------------------------------
    fields = _extract_fields(prompt)

    if fields is None:
        # No WorkPacket fenced block present — fail open (allow) without
        # parsing stray top-level YAML.  Silent allow (no stdout).
        return 0

    # -----------------------------------------------------------------
    # AC-007: Short-circuit allow for tier-independent roles.
    # Normalize subagent_type before comparison.
    # -----------------------------------------------------------------
    raw_subagent_type = fields.get("subagent_type", "")
    subagent_type = raw_subagent_type.lower().strip()
    if subagent_type in _TIER_INDEPENDENT_ROLES:
        # Silent allow — matches guard-session-scope.py:50 convention.
        return 0

    model = fields.get("model", "")
    effort = fields.get("effort", "")

    # Extract the Task tool's `model` parameter (sonnet|opus|haiku|""). Always
    # a string — empty when omitted. Forwarded to the verifier so production
    # runs always enforce the run-model against the canonical Tier × Loop cell.
    raw_tool_model = tool_input.get("model", "")
    tool_model = raw_tool_model if isinstance(raw_tool_model, str) else ""

    if not subagent_type:
        # subagent_type absent AND inference failed.
        if not model or not effort:
            # No way to derive canonical → silent allow (AC-006 fallback).
            return 0
        # model/effort present but subagent_type unresolvable → block.
        print(json.dumps({
            "decision": "block",
            "reason": (
                "subagent_type required for tier verification (AC-007); "
                "could not be resolved from Work Packet or dispatch_id"
            ),
        }))
        return 0

    # -----------------------------------------------------------------
    # Full verification path — covers AC-005 (Work Packet compare),
    # AC-006 (Work Packet model/effort absent → fall through to allow
    # after tool_model check), AC-008 (tier_missing), and AC-009
    # (Task tool `model` param enforcement).
    # -----------------------------------------------------------------
    task_id = fields.get("task_id", "")
    tier = fields.get("tier", "")

    result = _verify_tier_calibration_for_task(
        task_id=task_id,
        model=model,
        effort=effort,
        tier=tier,
        subagent_type=subagent_type,
        prompt=prompt,
        tool_model=tool_model,
    )

    if result.get("decision") == "block":
        print(json.dumps(result))

    # On allow (stub allow), emit nothing — Claude Code interprets no
    # stdout + exit 0 as allow.
    return 0


if __name__ == "__main__":
    sys.exit(main())
