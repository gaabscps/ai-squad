# Changelog

## 0.3.0 — 2026-05-12

### Bug fixes

- **`verify-pm-handoff-clean.py` — falso positivo com `pending` como vocabulário de domínio (Issue #2)**
  O padrão `\b(pending)\b` disparava em código legítimo como `status = 'pending'`, `isPending`, React `useTransition`, HTTP `pendingRequest`. O `pending` agora só é detectado em contexto de anotação de dívida técnica intencional: `@pending`, `// pending`, `# pending`, `/* pending`. Código de produção que usa `pending` como estado/flag/variável não é mais bloqueado.

- **`capture-subagent-usage.py` — bookkeeping gap: auto-criação de entrada no manifest quando orchestrator não escreveu**
  Quando o orchestrator pulava o passo de escrita em `actual_dispatches[]` após disparar um Task, `update_manifest` retornava silenciosamente sem registrar nada, causando todos os ACs como "missing" no agentops report. O hook agora infere role/subtask/loop a partir do Output Packet e auto-cria a entrada (marcada `auto_captured: true`), preservando `ac_coverage` para QA packets.

- **`_pm_shared.py` — bug macOS no fallback rglob (symlink /var → /private/var)**
  `tempfile.mkdtemp()` retorna `/var/folders/...`, que é um symlink para `/private/var/folders/...`. `p.resolve().relative_to(root)` lançava `ValueError` quando `root` não estava resolvido, excluindo todos os arquivos. Corrigido com `root = root.resolve()` no início de `_rglob_files`.

## 0.2.0 — 2026-05-12

**Breaking:** hooks now install per-repo instead of globally. Skills + agents stay user-global.

- `ai-squad deploy` (no flags) — installs skills+agents to `~/.claude/{skills,agents}/` AND hooks to `<cwd>/.claude/hooks/`. Auto-appends `.claude/hooks/` to the repo's `.gitignore`.
- New flag `--hooks-only` — re-sync only hooks (useful after `npm i -g @ai-squad/cli@latest`).
- New flag `--global-only` — skip per-repo hook install (CI flow or dotfile-managed setups).
- New flag `--repo-root PATH` — explicit target repo for hook install (default: cwd).
- Component frontmatter migrated: `$HOME/.claude/hooks/X.py` → `$CLAUDE_PROJECT_DIR/.claude/hooks/X.py`. The orchestrator skill now also wires `verify-tier-calibration.py` (root-cause fix for the "qa runs in opus despite haiku calibration" cost bug — see AC-009).
- New hooks shipped (previously only in the source repo, now bundled into the CLI components): `verify-tier-calibration.py`, `capture-pm-usage.py`, `verify-pm-handoff-clean.py`, `verify-reviewer-write-path.py`, `_pm_shared.py`.

**Why this change:** the previous global-only install meant the hooks that produced a session's `.agent-session/<id>/dispatch-manifest.json` could drift out of sync with the hooks installed when the report was rendered. Per-repo hooks pin the schema with the data. Also unblocks CI environments (no pre-seeded `$HOME`) and lets different consumer repos run different ai-squad versions concurrently.

**Migration from 0.1.x:**

```bash
# Optional: clean the now-unused global hooks (they were left in place; harmless but stale)
rm -f ~/.claude/hooks/{stamp-session-id,verify-output-packet,capture-subagent-usage,verify-audit-dispatch,block-git-write,guard-session-scope,hook_runtime}.py

# In each consumer repo:
cd <repo>
ai-squad deploy
```

## 0.1.0 — 2026-05-10

Initial release.

- `ai-squad deploy` — installs all bundled squads (skills, agents, hooks) to `~/.claude/`
- `ai-squad deploy --squad <name>` — selective squad install
- `ai-squad deploy --cursor` — also syncs hooks to `~/.cursor/` and merges `~/.cursor/hooks.json`
- Squads bundled: `sdd`, `discovery`
- Hooks ship with chmod +x, including the new `stamp-session-id.py` and `capture-subagent-usage.py` (token capture for `@ai-squad/agentops` reports).
