#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — verify-impl-seal.

Purpose: make the /implementer Checkpoint B trail mechanical. FEAT-013 lesson:
         the implementer reached the seal with decisions[] and evidence[]
         absent from session.yml, so its rationalizations (e.g. duplicating
         masks.cpf despite the Reuse Map entry) never surfaced to the human.

Mechanism: registered globally under PreToolUse(Edit|Write|MultiEdit) via
           claude-hooks.json; scoped to the /implementer Skill by transcript
           detection. When a write to .agent-session/<spec>/session.yml
           declares the seal (attention.kind: final_approval or status: done),
           the hook requires `decisions:` and `evidence:` to be present and
           non-empty in the RESULTING file (current content + the fragment
           being written). Missing trail -> deny with the recording steps.

Default: allow. Non-seal writes, other files, other skills — untouched.

Pure stdlib. Python 3.8+.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import detect_active_skill, edit_target_path, tool_input_dict

_SEAL_RE = re.compile(r"kind\s*:\s*[\"']?final_approval\b|^status\s*:\s*[\"']?done\b", re.M)


def _key_present_nonempty(union: str, key: str) -> bool:
    """True iff `key:` appears as a YAML key and is not an empty list."""
    m = re.search(rf"^\s*{key}\s*:\s*(.*)$", union, re.M)
    if not m:
        return False
    inline = m.group(1).split("#", 1)[0].strip()
    if inline in ("[]", "{}", "null", "~"):
        return False
    return True


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"verify-impl-seal: malformed stdin ({exc})", file=sys.stderr)
        return 0
    if not isinstance(payload, dict):
        return 0

    if detect_active_skill(payload) != "implementer":
        return 0

    tool_input = tool_input_dict(payload)
    file_path = edit_target_path(tool_input)
    if not file_path:
        return 0
    p = Path(file_path)
    if p.name != "session.yml" or ".agent-session" not in p.parts:
        return 0

    fragment = ""
    for field in ("content", "new_string"):
        val = tool_input.get(field)
        if isinstance(val, str):
            fragment += val + "\n"
    if not _SEAL_RE.search(fragment):
        return 0  # not a seal write — out of jurisdiction

    try:
        existing = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        existing = ""
    # For Write the fragment REPLACES the file; for Edit it merges into it.
    union = fragment if "content" in tool_input else existing + "\n" + fragment

    missing = [k for k in ("decisions", "evidence") if not _key_present_nonempty(union, k)]
    if not missing:
        return 0

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Checkpoint B seal denied: {' and '.join(missing)} missing or "
                f"empty in session.yml. Record the trail FIRST — decisions[] "
                f"(each real choice/deviation with rationale + ref, including "
                f"every reuse-vs-rewrite call) and evidence[] (test commands + "
                f"results). The human gates the seal on this trail; an empty "
                f"trail hides rationalizations (see skill steps 4, 5 and 8)."
            ),
        }
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
