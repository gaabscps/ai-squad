#!/usr/bin/env python3
"""
ai-squad PreToolUse hook — block-git-write.

Wired to the orchestrator Skill's frontmatter. Fires on every Bash call.
Denies any git write operation (commit, add, reset, push, checkout to a different
ref, etc.) — the human reviews and commits after the pipeline handoff.

Read-only git commands (status, diff, log, show, rev-parse, branch with no args)
are allowed for state inspection.

Pure stdlib. Python 3.8+.
"""
import json
import re
import sys

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

    tool_input = payload.get("tool_input", {}) or {}
    cmd = tool_input.get("command", "")
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
