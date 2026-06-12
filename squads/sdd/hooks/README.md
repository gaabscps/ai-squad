# SDD hooks — mechanical enforcement layer

Pure-stdlib Python 3 scripts wired to ai-squad SDD components via Skill/Subagent
frontmatter `hooks:` fields. They close the gap between "the orchestrator
*should* dispatch the audit-agent" (prompt discipline) and "the orchestrator
*cannot finish* without dispatching the audit-agent" (mechanical enforcement).

Pattern lineage: GitHub required status checks + transactional Outbox +
Verifiability-First Audit Agents (arXiv 2512.17259).

## Why hooks (and why declared in component frontmatter, not `settings.json`)

Claude Code's project-level `.claude/settings.json` hooks **do not fire inside
subagent contexts** (issue [#34692](https://github.com/anthropics/claude-code/issues/34692)).
Hooks declared in a component's own frontmatter (Skill or Subagent) DO fire
during that component's lifecycle. ai-squad's enforcement therefore lives
in the markdown components, exactly where the rules are.

## The hook scripts

| Script | Wired to | Event | What it enforces |
|--------|----------|-------|------------------|
| [`hook_runtime.py`](hook_runtime.py) | *(library)* | — | Shared `resolve_project_root()` (`CLAUDE_PROJECT_DIR`, falling back to the payload's `cwd`), helpers, `should_run_audit_manifest_verify()` for `Stop` hooks. |
| [`guard-session-scope.py`](guard-session-scope.py) | `skills/orchestrator` | `PreToolUse` (Edit\|Write\|MultiEdit) | Orchestrator can edit only inside `.agent-session/<spec_id>/`. Any source-tree edit is denied. |
| [`block-git-write.py`](block-git-write.py) | `skills/orchestrator` | `PreToolUse` (Bash) | Orchestrator cannot run git write commands (commit, add, reset, push, branch -d, etc.). Read-only commands (status, diff, log) are allowed. |
| [`verify-audit-dispatch.py`](verify-audit-dispatch.py) | `skills/orchestrator` | `Stop` | Orchestrator session cannot end without an `audit-agent` entry in `dispatch-manifest.json`'s `actual_dispatches[]` with `status: done`. |
| [`register-impl-session.py`](register-impl-session.py) | `skills/orchestrator` | `Stop` | Bookkeeping (fail-open, never blocks). Records the orchestrator's own session id into `implementation_sessions:` in `session.yml` — the authoritative anchor `cost_report.build_cost_report` uses to scope which subagent cost files belong to this feature (ignoring foreign-session/project contamination on read). |
| [`verify-output-packet.py`](verify-output-packet.py) | every Phase 4 Subagent (`dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`, `audit-agent`) | `Stop` (auto-becomes `SubagentStop`) | Subagent cannot complete without writing `outputs/<dispatch_id>.json` (parsed dispatch_id from its prompt). Validates required fields + status enum. |

## Deployment

`./tools/deploy.sh` copies all 3 component types globally to `~/.claude/`:
- `squads/sdd/skills/`  → `~/.claude/skills/`
- `squads/sdd/agents/`  → `~/.claude/agents/`
- `squads/sdd/hooks/`   → `~/.claude/hooks/`  (chmod +x preserved)

The frontmatter references `python3 $HOME/.claude/hooks/<name>.py` — global
install, no per-project setup. Same model as Claude Code's user-level skills
and agents. `$HOME` is expanded by the shell when Claude Code runs the hook
command (`type: command` is bash by default).

No changes to `<project>/.claude/settings.json` are required — all hook
declarations live in component frontmatter.

## Requirements

- Python 3.8 or newer (universal: macOS ≥10.15, all current Linux distros, Windows with `py -3`).
- No third-party dependencies. Stdlib only (`json`, `os`, `pathlib`, `re`, `sys`). Hook scripts import [`hook_runtime.py`](hook_runtime.py) from the same directory (`sys.path` bootstrap in each script).
- Each script has a `timeout: 5` second budget — enforcement runs are fast (file read + JSON parse).

## Failure semantics

- **`PreToolUse` deny** (`guard-session-scope`, `block-git-write`): emits `permissionDecision: "deny"` with a human-readable reason. Claude sees the denial and adjusts (e.g., dispatches `dev` instead of editing directly).
- **`Stop` block** (`verify-audit-dispatch`, `verify-output-packet`): emits `{"decision":"block", "reason":...}`. Claude sees the block and continues working (dispatches the missing audit-agent, or writes the missing Output Packet). Both honor `stop_hook_active` to avoid infinite loops.
- **Hook script error** (malformed stdin, missing files, exceptions): scripts fail open (exit 0, no output). Defense-in-depth via the audit-agent's reconciliation gate (step 8) catches what the hooks miss.

## Testing the hooks locally

```bash
# Should DENY (path outside .agent-session/)
echo '{"tool_input":{"file_path":"/repo/src/foo.ts"}}' | \
  python3 squads/sdd/hooks/guard-session-scope.py

# Should ALLOW (silent — empty output, exit 0)
echo '{"tool_input":{"file_path":".agent-session/FEAT-001/spec.md"}}' | \
  CLAUDE_PROJECT_DIR=. python3 squads/sdd/hooks/guard-session-scope.py

# Should DENY
echo '{"tool_input":{"command":"git commit -m foo"}}' | \
  python3 squads/sdd/hooks/block-git-write.py

# Should ALLOW
echo '{"tool_input":{"command":"git status"}}' | \
  python3 squads/sdd/hooks/block-git-write.py
```

## What hooks do NOT enforce

- They do not prevent the orchestrator from misreading the Spec, picking the wrong dispatch order, or generating bad work — those are agent-quality issues that the audit-agent's semantic checks (after the hooks pass) catch.
- They do not replace the audit-agent. Hooks enforce *that the pipeline ran*; the audit-agent verifies *that what ran is consistent and complete*.
- They do not prevent a malicious user with shell access from editing the files directly. The threat model is "model laziness or confusion," not adversarial sabotage.
