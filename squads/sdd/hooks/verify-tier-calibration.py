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
  - All other paths delegate to _verify_tier_calibration_for_task() which is a
    stub returning allow until T-009 fills in the Tier × Loop lookup.

Phase 2 (T-009 / AC-005, AC-008): lookup table + loop-kind derivation — NOT YET
implemented; _verify_tier_calibration_for_task() is a stub returning allow.

Output per Claude Code PreToolUse hook contract:
  stdout: JSON  {decision: "allow"}
              | {decision: "block", reason: str}

Python 3.8+. No external dependencies (stdlib only).
"""
from __future__ import annotations

import json
import re
import sys

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


# ---------------------------------------------------------------------------
# Stub: T-009 will implement the full Tier × Loop lookup + tasks.md read.
# ---------------------------------------------------------------------------


def _verify_tier_calibration_for_task(
    task_id: str,
    model: str,
    effort: str,
    tier: str,
    subagent_type: str,
    prompt: str,
) -> dict:
    """Stub: full Tier × Loop verification (T-009 — not yet implemented).

    Returns allow unconditionally until T-009 fills in:
      - Canonical Tier × Loop table lookup.
      - Loop-kind derivation from dispatch-manifest.json.
      - tasks.md Tier: field reader + /tmp mtime cache.
      - tier_missing block when Tier: absent.

    The stub signature is the full signature T-009 will implement so the
    caller does not need to change when T-009 lands.
    """
    # TODO(T-009): replace stub with lookup table + tasks.md read.
    return {"decision": "allow"}


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

    # -----------------------------------------------------------------
    # AC-006: Short-circuit allow when model or effort are absent
    # (frontmatter fallback path — no override in Work Packet).
    # -----------------------------------------------------------------
    model = fields.get("model", "")
    effort = fields.get("effort", "")

    if not subagent_type:
        # subagent_type absent AND inference failed.
        if not model or not effort:
            # model/effort also absent → fall through to AC-006 allow (silent).
            return 0
        else:
            # model/effort present but subagent_type unresolvable → block.
            print(json.dumps({
                "decision": "block",
                "reason": (
                    "subagent_type required for tier verification (AC-007); "
                    "could not be resolved from Work Packet or dispatch_id"
                ),
            }))
            return 0

    if not model or not effort:
        # model/effort absent → allow (Subagent uses its own frontmatter default).
        # Silent allow — no stdout.
        return 0

    # -----------------------------------------------------------------
    # All other paths: delegate to T-009 lookup (stub returns allow).
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
    )

    if result.get("decision") == "block":
        print(json.dumps(result))

    # On allow (stub allow), emit nothing — Claude Code interprets no
    # stdout + exit 0 as allow.
    return 0


if __name__ == "__main__":
    sys.exit(main())
