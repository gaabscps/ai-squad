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
| [`hook_runtime.py`](hook_runtime.py) | *(library)* | — | Shared `resolve_project_root()` (Claude `CLAUDE_PROJECT_DIR` vs Cursor `workspace_roots` / `cwd`), helpers, `should_run_audit_manifest_verify()` for global `stop` hooks. |
| [`guard-session-scope.py`](guard-session-scope.py) | `skills/orchestrator` | `PreToolUse` (Edit\|Write\|MultiEdit) | Orchestrator can edit only inside `.agent-session/<task_id>/`. Any source-tree edit is denied. |
| [`block-git-write.py`](block-git-write.py) | `skills/orchestrator` | `PreToolUse` (Bash) | Orchestrator cannot run git write commands (commit, add, reset, push, branch -d, etc.). Read-only commands (status, diff, log) are allowed. |
| [`verify-audit-dispatch.py`](verify-audit-dispatch.py) | `skills/orchestrator` | `Stop` | Orchestrator session cannot end without an `audit-agent` entry in `dispatch-manifest.json`'s `actual_dispatches[]` with `status: done`. |
| [`verify-output-packet.py`](verify-output-packet.py) | every Phase 4 Subagent (`dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`, `audit-agent`) | `Stop` (auto-becomes `SubagentStop`) | Subagent cannot complete without writing `outputs/<dispatch_id>.json` (parsed dispatch_id from its prompt). Validates required fields + status enum. |

## Cursor / Cursor CLI (same scripts, native `hooks.json`)

[`./tools/deploy-cursor.sh`](../../../tools/deploy-cursor.sh) syncs these `.py` files to `~/.cursor/hooks/ai-squad/` and merges [`cursor-hooks.json`](cursor-hooks.json) into `~/.cursor/hooks.json`. Cursor's runtime accepts the **same stdout JSON** as Claude Code ([compatibility](https://cursor.com/docs/reference/third-party-hooks)).

Shared logic lives in **[`hook_runtime.py`](hook_runtime.py)** (`resolve_project_root`, etc.): the hook reads `CLAUDE_PROJECT_DIR` **or** Cursor’s `workspace_roots` / `cwd` from stdin so path checks resolve to the consumer project.

| Script | In `cursor-hooks.json` | Notes |
|--------|------------------------|--------|
| `block-git-write.py` | yes (`preToolUse` / Shell) | Safe globally — blocks git writes for orchestrator **and** dev (human commits after handoff). |
| `verify-audit-dispatch.py` | yes (`stop`) | Skips verification unless `dispatch-manifest.json` exists **and** `session.yml` shows Phase 4–style state (avoids blocking unrelated chats). |
| `verify-output-packet.py` | yes (`subagentStop`) | Same as Claude. |
| `guard-session-scope.py` | **no** | Would deny every `Write` outside `.agent-session/`, including **`dev`** editing source. Keep this hook on **Claude Code** only (orchestrator Skill frontmatter / Third-party Claude config). |

To merge hooks manually: `python3 tools/merge_ai_squad_cursor_hooks.py`. Use `SKIP_CURSOR_HOOK_MERGE=1` with `deploy-cursor.sh` to skip merging.

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

# Cursor-style stdin (project root from workspace_roots)
echo '{"tool_input":{"command":"git status"},"workspace_roots":["'$PWD'"]}' | \
  python3 squads/sdd/hooks/block-git-write.py
```

## What hooks do NOT enforce

- They do not prevent the orchestrator from misreading the Spec, picking the wrong dispatch order, or generating bad work — those are agent-quality issues that the audit-agent's semantic checks (after the hooks pass) catch.
- They do not replace the audit-agent. Hooks enforce *that the pipeline ran*; the audit-agent verifies *that what ran is consistent and complete*.
- They do not prevent a malicious user with shell access from editing the files directly. The threat model is "model laziness or confusion," not adversarial sabotage.
