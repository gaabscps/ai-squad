#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — block-git-write.

Purpose: enforce the "no git writes from orchestrator" invariant — the human
         reviews and commits after the pipeline handoff.

Mechanism: `ai-squad deploy` registers this hook globally under
           PreToolUse(Bash). To preserve the intended orchestrator-only
           scoping, the hook detects the currently active Skill by scanning
           the transcript JSONL for the latest
           `Base directory for this skill: .../skills/<name>` marker. Only
           enforces the rule when the active Skill is `orchestrator`.

Default: allow. Main session, other skills, and subagents may run any git
         command. This protects callers (including the human dogfooding the
         framework) from spurious blocks.

Pure stdlib. Python 3.8+.
"""
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import shell_command, tool_input_dict

_SKILL_MARKER_PATTERN = re.compile(
    r"[Bb]ase directory for this [Ss]kill:\s*\S*?/skills/([A-Za-z0-9_-]+)"
)
_TRANSCRIPT_TAIL_BYTES = 256 * 1024  # 256 KiB tail is enough for the latest skill marker


def _detect_active_skill(payload: dict) -> str | None:
    """Return the slug of the most recently activated Skill, or None if unknown.

    Mirror of the helper in guard-session-scope.py. If a third hook needs
    this, lift into hook_runtime.py.
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

GIT_WRITE_VERBS = {
    "add", "rm", "mv",
    "commit", "amend",
    "push", "pull", "fetch",
    "reset", "restore", "checkout", "switch",
    "merge", "rebase", "cherry-pick", "revert",
    "tag", "branch",  # branch with -d/-D is write; bare `git branch` is read — handled below
    "stash", "clean",
    "init", "clone",
    "config",  # could mutate; safer to deny
    "remote",
}

# Subset of `git branch` / `git tag` invocations that are read-only.
# We allow them when called with NO args or only flags like `-l`, `--list`, `-v`.
READ_ONLY_FLAG_ONLY = {"branch", "tag"}


def is_git_write(cmd: str) -> tuple[bool, str]:
    """Return (is_write, reason). Naive parser — good enough for hook scope."""
    # Strip leading env vars / cd / && chains — we check each segment.
    segments = re.split(r"&&|\|\||;", cmd)
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        # Match `git <verb> ...` (allow leading env, sudo, etc. by finding `git`).
        m = re.search(r"\bgit\s+(\S+)(.*)$", seg)
        if not m:
            continue
        verb = m.group(1).lstrip("-")  # `git -C dir verb` edge case still detected via verb token
        rest = m.group(2)

        # `git -C <dir> <verb>` style
        if verb == "C" or verb in {"-c", "--git-dir", "--work-tree"}:
            m2 = re.search(r"\s(\S+)\s+(\S+)", rest)
            if m2:
                verb = m2.group(2).lstrip("-")
                rest = rest[m2.end():]

        if verb in READ_ONLY_FLAG_ONLY:
            # Allow only if rest contains no destructive flag.
            if re.search(r"-[dDmM]\b|--delete|--move", rest):
                return True, f"`git {verb}{rest}` (destructive flag detected)"
            continue

        if verb in GIT_WRITE_VERBS:
            return True, f"`git {verb}` is a write operation"

    return False, ""


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"block-git-write: malformed stdin ({exc})", file=sys.stderr)
        return 0

    if not isinstance(payload, dict):
        return 0

    # Only enforce when the active Skill is the orchestrator. If we can't
    # identify the active skill, allow — the invariant is orchestrator-specific.
    active_skill = _detect_active_skill(payload)
    if active_skill != "orchestrator":
        return 0

    tool_input = tool_input_dict(payload)
    cmd = shell_command(tool_input)
    if not cmd:
        return 0

    is_write, reason = is_git_write(cmd)
    if not is_write:
        return 0

    decision = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": (
                f"Orchestrator must not run git write commands ({reason}). "
                f"The human reviews and commits after the pipeline handoff. "
                f"Read-only commands (status, diff, log) are allowed."
            ),
        }
    }
    print(json.dumps(decision))
    return 0


if __name__ == "__main__":
    sys.exit(main())
