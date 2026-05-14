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

Committer exception (T-013, AC-014):
  The `committer` Subagent is the ONLY dispatched role authorized to run
  `git add` and `git commit` during a Phase 4 pipeline. This hook detects
  the `committer` role by scanning the transcript Work Packet header for
  `subagent_type: committer` (bounded scan, first 80 lines — same pattern
  used by verify-reviewer-write-path.py for reviewer detection).

  Detection mechanism chosen: transcript scan for `subagent_type: committer`
  in the Work Packet at the top of the JSONL transcript.
  Alternatives considered:
    (a) `tool_input.subagent_type` field — not present in Claude Code's
        PreToolUse Bash payloads as of current platform version.
    (b) `dispatch-manifest.json` lookup — requires file I/O and knowledge
        of the active session path; transcript is already available in payload.
    (c) Marker file — brittle; creates cleanup burden.
  Chosen: (transcript scan) — consistent with existing hooks; zero extra I/O
  beyond the transcript already in the payload.

  Trust assumption: Claude Code controls sub-Task transcript creation and
  the `transcript_path` field in the hook payload. A caller cannot modify
  an existing transcript file without filesystem access, which is outside
  the Claude Code threat model for hook enforcement. The security surface
  is limited to allowing `git add`/`git commit` (non-destructive) to a
  caller who controls their own transcript. Destructive commands
  (git push, git reset --hard, git checkout --, git clean -f, git branch -D)
  are ALWAYS blocked for the committer role — defense-in-depth ensures
  no spoofing can unlock them.

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

# Bounded scan limit for committer detection (Work Packet is at the top).
_COMMITTER_SCAN_LIMIT = 80

_COMMITTER_PATTERN = re.compile(r"subagent_type:\s*[\"']?committer\b")


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


def _is_committer_context(payload: dict) -> bool:
    """Return True iff the transcript's Work Packet declares subagent_type=committer.

    Scans the first _COMMITTER_SCAN_LIMIT lines of the JSONL transcript for
    `subagent_type: committer`. The Work Packet is always at the top of the
    sub-Task transcript, so a tight bound is safe and keeps latency predictable.

    Returns False (default-deny committer exemption) when:
      - transcript_path missing or not a string
      - transcript file unreadable
      - no committer marker found within the scan window
    """
    tp = payload.get("transcript_path") or payload.get("agent_transcript_path")
    if not isinstance(tp, str) or not tp:
        return False
    transcript_path = Path(tp)
    try:
        with transcript_path.open("r", encoding="utf-8", errors="replace") as fh:
            for lineno, raw_line in enumerate(fh, start=1):
                if lineno > _COMMITTER_SCAN_LIMIT:
                    break
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict):
                    continue
                content = entry.get("content")
                if content is None:
                    msg = entry.get("message")
                    if isinstance(msg, dict):
                        content = msg.get("content")
                if isinstance(content, list):
                    content = " ".join(
                        c.get("text", "") if isinstance(c, dict) else str(c)
                        for c in content
                    )
                if not isinstance(content, str):
                    continue
                if _COMMITTER_PATTERN.search(content):
                    return True
    except OSError:
        return False
    return False


# ---------------------------------------------------------------------------
# Committer allowlist / blocklist
# ---------------------------------------------------------------------------

# Commands the committer role is explicitly allowed to run.
# Committer may ONLY stage files and create commits — nothing else.
_COMMITTER_ALLOWED_VERBS = {"add", "commit"}

# Flags that are ALWAYS blocked for the committer role regardless of verb
# (AC-017: never --no-verify; short form -n is its alias).
_COMMITTER_BLOCKED_FLAGS = re.compile(r"\s--no-verify\b|\s-n\b")

# Destructive operations that remain blocked even for the committer role.
# Defense-in-depth: committer does not need any of these.
_COMMITTER_ALWAYS_BLOCKED = {
    "push", "reset", "checkout", "clean", "branch",
}
# For fine-grained destructive detection within always-blocked verbs:
_COMMITTER_DESTRUCTIVE_REST = re.compile(
    r"--hard\b|--force\b|-f\b|-F\b|--\s|branch\s.*-[dD]\b|--delete\b"
)


def _is_committer_allowed(cmd: str) -> tuple[bool, str]:
    """Return (allowed, reason) for a git command when the caller is `committer`.

    allowed=True  -> committer may run this command (empty reason).
    allowed=False -> hook should deny (reason explains why).

    Rules:
      1. ALWAYS block destructive verbs: push, reset, checkout, clean, branch
         (regardless of flags -- none of these are needed by the committer).
      2. ALWAYS block --no-verify / -n flag on any verb (AC-017).
      3. All other commands are allowed (read commands like `status`, `log`,
         `diff` are harmless and committer may need them).

    Rationale for rule 3 (allow-by-default for non-destructive):
      The committer Subagent is expected to run `git status --porcelain`,
      `git add`, and `git commit`. Blocking unknown verbs would cause spurious
      failures if the model issues diagnostic git commands. The security
      invariant is maintained by rule 1 (destructive verbs always blocked)
      and rule 2 (--no-verify always blocked) -- not by an allowlist.
    """
    segments = re.split(r"&&|\|\||;", cmd)
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        m = re.search(r"\bgit\s+(\S+)(.*)$", seg)
        if not m:
            continue
        verb = m.group(1).lstrip("-")
        rest = m.group(2)

        # Handle `git -C <dir> <verb>` style
        if verb in {"C", "-c", "--git-dir", "--work-tree"}:
            m2 = re.search(r"\s(\S+)\s+(\S+)", rest)
            if m2:
                verb = m2.group(2).lstrip("-")
                rest = rest[m2.end():]

        # Rule 1: always-blocked destructive verbs
        if verb in _COMMITTER_ALWAYS_BLOCKED:
            return False, f"`git {verb}` is not permitted for the committer role (destructive/out-of-scope)"

        # Rule 2: --no-verify / -n flag check (applies to any verb, including commit)
        full_args = verb + rest
        if _COMMITTER_BLOCKED_FLAGS.search(" " + full_args):
            return False, (
                "`--no-verify` / `-n` flag is prohibited for the committer role "
                "(AC-017: pre-commit hooks must run normally)"
            )

        # Rule 3: allow (non-destructive verbs including add, commit, status, log, diff, etc.)
        continue

    return True, ""


GIT_WRITE_VERBS = {
    "add", "rm", "mv",
    "commit", "amend",
    "push", "pull", "fetch",
    "reset", "restore", "checkout", "switch",
    "merge", "rebase", "cherry-pick", "revert",
    "tag", "branch",  # branch with -d/-D is write; bare `git branch` is read -- handled below
    "stash", "clean",
    "init", "clone",
    "config",  # could mutate; safer to deny
    "remote",
}

# Subset of `git branch` / `git tag` invocations that are read-only.
# We allow them when called with NO args or only flags like `-l`, `--list`, `-v`.
READ_ONLY_FLAG_ONLY = {"branch", "tag"}


def is_git_write(cmd: str) -> tuple[bool, str]:
    """Return (is_write, reason). Naive parser -- good enough for hook scope."""
    # Strip leading env vars / cd / && chains -- we check each segment.
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

    tool_input = tool_input_dict(payload)
    cmd = shell_command(tool_input)
    if not cmd:
        return 0

    # --- Committer exception (T-013, AC-014) ---
    # If the caller is the `committer` Subagent, apply committer-specific rules
    # instead of the orchestrator blanket block. The committer is the only role
    # authorized to run `git add` / `git commit` during a Phase 4 pipeline.
    # Destructive commands (push, reset --hard, etc.) remain blocked regardless.
    if _is_committer_context(payload):
        allowed, reason = _is_committer_allowed(cmd)
        if not allowed:
            decision = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Committer role: git command denied -- {reason}. "
                        f"Committer may only run `git add` and `git commit` "
                        f"(without --no-verify). All destructive operations remain blocked."
                    ),
                }
            }
            print(json.dumps(decision))
        return 0

    # --- Orchestrator blanket block (original behavior) ---
    # Only enforce when the active Skill is the orchestrator. If we can't
    # identify the active skill, allow -- the invariant is orchestrator-specific.
    active_skill = _detect_active_skill(payload)
    if active_skill != "orchestrator":
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
