# Changelog

## 0.7.0 — 2026-05-16

### New features

- **Pipeline lite mode (SDD squad).** New `session.yml.pipeline_mode` field with values `lite | standard`. Selected interactively in `spec-writer` step 2.5 (or via `--mode=lite|standard` flag). Lite mode is the compressed pipeline for single-purpose changes (fix, small refactor, doc/copy, single-file feature):
  - `spec-writer`: caps US count to 1.
  - `task-builder`: hard cap of 2 tasks total, disallows Setup/Foundational phases, auto-appends `Skip reviewers:` marker to single-file trivial/small tasks (grants the existing orchestrator reviewer-skip exception without manual annotation).
  - `orchestrator`: clamps fan-out cap to 1 (sequential) and clamps per-task tier ceiling to T2 (cheap dispatch by default). Reviewer-skip markers honored independently of mode.
  - Quality gates (logic-gap sweep, edge-case categories, audit-gate) remain mandatory in lite mode. Lite reduces volume, not rigor. Pre-v0.7 sessions default to `standard` for backward compatibility.

- **Spec rigor sweep (Frente B).** `spec-writer` now performs an explicit logic-gap sweep before any approval path (PM bypass or human gate), with concrete edge-case categories (empty / error / concurrent / partial-failure) mandatory at draft time. Clarifications touching external APIs, concurrency, security, or data migration now trigger a research dispatch (single Explore pass per decision block) before asking the human. Designed to cut Phase 4 review_loops/qa_loops cascades by resolving gaps upstream.

### Performance

- **Orchestrator single-turn fan-out (Frente C).** Phase 4 dispatch loop and per-task reviewers fan-out (code-reviewer + logic-reviewer) now explicitly require issuing all N `Task` tool calls in the SAME assistant turn. The previous wording was ambiguous enough that dispatches ran serially despite the "concurrent" intent — defeating the entire fan-out model. Expected impact: significant Phase 4 wall-clock reduction on multi-task pipelines.

- **Prompt caching strategy.** Work Packet structure reordered so stable context (`session_id`, `spec_ref`, `plan_ref`, `tasks_ref`, `standards_ref`) precedes per-dispatch variable fields. Anthropic's ephemeral cache (5-min TTL) keys on the longest matching prefix; this ordering enables cache hits across the 20-50+ dispatches in a typical pipeline.

### Code quality

- **Tighter comments policy (Frente D).** `dev` and `code-reviewer` updated with a hard rule defaulting to NO comments. Comments are added only when the WHY is non-obvious (hidden constraint, subtle invariant, workaround for a specific bug, surprising behavior). Forbidden patterns: comments restating WHAT the code does, references to current task/PR/issue/callers, multi-paragraph docstrings on simple functions, stale TODOs without owner+date+condition. `code-reviewer` flags noise comments under `dimension: comments`.

### Bug fixes

- **Orchestrator preflight false-positive `MISSING_HOOKS`.** Preflight check now resolves repo root via `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}` instead of relying on `$CLAUDE_PROJECT_DIR` being exported into ad-hoc Bash invocations. Matches the pattern already used in `pm/skill.md`. Eliminates false-positive aborts in freshly-deployed consumer repos.

## 0.4.0 — 2026-05-13

### Bug fixes

- **Stop hooks emitiam `{"decision": "allow"}` — JSON rejeitado pelo Claude Code (Issue #3)**
  O Claude Code v2.1.140+ valida output de hook contra um schema estrito: `decision` aceita apenas `"approve" | "block"`. O valor `"allow"` é exclusivo de `permissionDecision` (PreToolUse), não de `decision`. Vários hooks ai-squad emitiam `{"decision": "allow"}` em caminhos de "fail-open" (allow continuar), causando `Hook JSON output validation failed` no transcript e, em alguns casos, interrupção do fluxo. Corrigido em `capture-pm-usage.py` (5 sites de output) e `verify-tier-calibration.py` (4 returns internos). A forma canônica de implicit allow agora é `{}` (empty JSON object), sempre schema-válido.

- **`/pm` e `/orchestrator` entravam em loop infinito em repos sem hooks per-repo instalados (Issue #3 parte 2)**
  Quando o consumer repo não tinha `.claude/hooks/` populado (deploy nunca rodado), os Stop hooks chamavam `python3` em arquivos inexistentes. O `python3` retornava exit code 2 (`No such file or directory`), o Claude Code interpretava como "Stop bloqueado", tentava finalizar de novo, e travava em loop. Duas correções combinadas:
  - **Wrapper resiliente em todos os Stop hooks** (15 commands em 8 arquivos — `pm`, `orchestrator`, 6 subagents): `command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/X.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/X.py"'`. Se o arquivo existe, o exit code do `python3` propaga (bloqueios legítimos preservados). Se ausente, `exit 0` = fail-open. `PreToolUse`/`PostToolUse` intencionalmente não foram envolvidos (silenciar `block-git-write` ou `guard-session-scope` seria uma armadilha de segurança).
  - **Pre-flight check em `/pm` e `/orchestrator`**: antes de qualquer ação, o agente roda um bash que valida a presença dos hooks esperados em `$CLAUDE_PROJECT_DIR/.claude/hooks/`. Se algum faltar, aborta com `MISSING_HOOKS: ...` + `Run: ai-squad deploy --hooks-only`. Evita degradação silenciosa de observabilidade quando o deploy foi esquecido.

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
