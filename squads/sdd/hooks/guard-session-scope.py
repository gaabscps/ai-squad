#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — guard-session-scope.

Purpose: enforce the orchestrator non-edit invariant — source-file edits must
         flow through `dev` Subagent dispatches, never through orchestrator
         direct Edit/Write/MultiEdit.

Mechanism: `ai-squad deploy` registers this hook globally under
           PreToolUse(Edit|Write|MultiEdit). To preserve the intended scoping
           (orchestrator Skill only), the hook detects the currently active
           Skill by scanning the transcript JSONL for the latest
           `Base directory for this skill: .../skills/<name>` marker that
           Claude Code emits when a Skill is invoked.

Default: allow. Only enforce the `.agent-session/` rule when the active Skill
         is positively identified as `orchestrator`. This protects the main
         session, other skills, and subagents from spurious blocks.

Pure stdlib. Python 3.8+.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from audit_baseline import BASELINE_FILENAME
from hook_runtime import edit_target_path, resolve_project_root, tool_input_dict

_SKILL_MARKER_PATTERN = re.compile(
    r"[Bb]ase directory for this [Ss]kill:\s*\S*?/skills/([A-Za-z0-9_-]+)"
)
_TRANSCRIPT_TAIL_BYTES = 256 * 1024  # 256 KiB tail is enough for the latest skill marker


def _detect_active_skill(payload: dict) -> str | None:
    """Return the slug of the most recently activated Skill, or None if unknown.

    Scans the tail of the JSONL transcript for the canonical Claude Code
    Skill-activation marker `Base directory for this skill: .../skills/<name>`.
    The LAST occurrence wins — a session may load multiple skills in sequence,
    and only the most recent one defines the current scope.

    Returns None when:
      - transcript_path missing or not a string
      - transcript file unreadable
      - no skill marker found in the scanned tail
    """
    tp = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not isinstance(tp, str) or not tp:
        return None
    transcript_path = Path(tp)
    try:
        with transcript_path.open("rb") as fh:
            fh.seek(0, 2)
            size = fh.tell()
            start = max(0, size - _TRANSCRIPT_TAIL_BYTES)
            fh.seek(start)
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return None

    matches = _SKILL_MARKER_PATTERN.findall(tail)
    if not matches:
        return None
    return matches[-1]


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        # Malformed stdin — fail open (don't block) but log to stderr for debugging.
        print(f"guard-session-scope: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if not isinstance(payload, dict):
        return 0

    # Only enforce when the active Skill is the orchestrator. If we can't
    # identify the active skill, allow — the invariant is orchestrator-specific.
    active_skill = _detect_active_skill(payload)
    if active_skill != "orchestrator":
        return 0

    tool_input = tool_input_dict(payload)
    file_path = edit_target_path(tool_input)

    if not file_path:
        # No path field — let the call through; not our concern.
        return 0

    project_dir = resolve_project_root(payload)
    try:
        abs_path = Path(file_path).resolve()
        project_root = Path(project_dir).resolve()
    except (OSError, ValueError):
        return 0

    # The orchestrator may write to .agent-session/<spec_id>/ only — and NOT to
    # outputs/, which holds subagent-authored Output Packets. Editing those is
    # evidence tampering (the FEAT-010 audit-gaming pattern: the orchestrator
    # patched packets and re-ran the audit until it flipped to done). A blocked
    # audit is terminal; recovery is /orchestrator --restart, not packet edits.
    session_root = project_root / ".agent-session"
    try:
        rel = abs_path.relative_to(session_root)
    except ValueError:
        rel = None
    if rel is not None:
        # rel = <spec_id>/<subdir-or-file>/...  — some entries are off-limits.
        parts = rel.parts
        if len(parts) >= 2 and parts[1] == "outputs":
            decision = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Orchestrator must not write Output Packets. Path '{file_path}' is "
                        f"under .agent-session/<spec_id>/outputs/, authored exclusively by "
                        f"subagents. Editing it is evidence tampering — a blocked audit is "
                        f"terminal; recover with /orchestrator --restart "
                        f"(see squads/sdd/skills/orchestrator/skill.md step 8)."
                    ),
                }
            }
            print(json.dumps(decision))
            return 0
        if len(parts) >= 2 and parts[-1] == BASELINE_FILENAME:
            # The audit baseline is the Root of Trust for Check 6 — captured by
            # the deterministic capture-baseline hook. The orchestrator rewriting
            # it could hide source edits from the audit (Spec A attestation).
            decision = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Orchestrator must not write the audit baseline. Path '{file_path}' "
                        f"is the deterministic pre-Phase-4 dirty snapshot captured by "
                        f"capture-baseline.py (Root of Trust for audit Check 6). Rewriting it "
                        f"would let source edits escape detection (Spec A)."
                    ),
                }
            }
            print(json.dumps(decision))
            return 0
        return 0  # other .agent-session/ paths (manifest, inputs/, session.yml, ...) — allowed

    # Path is outside .agent-session/. Deny.
    decision = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Orchestrator must not edit source files. "
                f"Path '{file_path}' is outside .agent-session/. "
                f"Source edits flow through `dev` Subagent dispatches only "
                f"(see squads/sdd/skills/orchestrator/skill.md, hard rules)."
            ),
        }
    }
    print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    sys.exit(main())
