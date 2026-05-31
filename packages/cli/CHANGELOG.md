# Changelog

## 0.10.0 — 2026-05-31

Orchestrator no longer forces a manual `session.yml` edit when a human starts an unplanned implementation (Gap B).

### Changed

- **`/orchestrator` recognizes explicit human invocation as authorization.** The recommended SDD flow scopes a Session at `/spec-writer` time and often defers implementation to a later session, so `planned_phases` frequently lacks `implementation`. Previously the orchestrator hard-refused ("Implementation was not planned… edit planned_phases in session.yml"), forcing every such feature to be edited by hand (hit on FEAT-005 and FEAT-006). The refusal now branches on `auto_approved_by`: a non-null value (an autonomous driver like `pm` is steering) still hard-refuses — reaching there without declaring implementation is a real misconfiguration; a null value (a human typed `/orchestrator` directly) is treated as the authorization. The orchestrator confirms once via `AskUserQuestion`, then self-appends `implementation` to `planned_phases` with a `phase_history.implementation` audit note, and proceeds. The confirm runs at the entry point (human present), preserving the HOTL guarantee. All other gates (Spec/Plan/Tasks approval) are unchanged, and `--resume` on a never-planned implementation is routed through the same confirm-once path instead of erroring. `pm` is unaffected — it already declares `implementation` upfront, so it never reaches this branch.

## 0.9.0 — 2026-05-31

Cost-report read-scoping (Gap A). The 0.8.1 fixes hardened the **write** side (backfill + capture no longer scoop other projects), but `build_cost_report` still trusted everything already on disk — so historical contamination in `costs/` (from old wide globs, or `capture-session-cost`'s mtime-based feature attribution) kept inflating the report until the files were deleted by hand. This release makes the **read** side scope provenance, so contamination is inert without manual cleanup.

### Added

- **Authoritative implementation-session registry.** New `register-impl-session.py` Stop hook, wired to the orchestrator Skill. It records the orchestrator's own session id (from the hook payload — trustworthy, never an mtime guess, since the hook only fires from an orchestrator session) into a new `implementation_sessions:` list in `session.yml`. Subagents dispatched by the orchestrator live under exactly this session id, so it is the precise anchor for "which subagent cost files are this feature's". Idempotent and fail-open; multiple ids accumulate across `--resume` / multi-instance runs.
- **`excluded_subagents` in the cost report.** `build_cost_report` now reports how many out-of-scope agent cost files it ignored, and `render_markdown` adds a `NOTE` line when any were dropped — contamination is surfaced, never silently truncated.

### Bug fixes

- **Cost report counted subagents from other features/projects on read.** `build_cost_report` iterated every `agent-*.json` in `costs/` regardless of provenance; a contaminated dir (e.g. FEAT-005's 2804 agents, of which only 60 were real) inflated `subagent_count` and `implementation_cost_usd` until the strays were deleted by hand. The reader now scopes each agent file by its transcript's parent session: when `implementation_sessions:` is present it is the authoritative allow-list (also closing the wholesale-session-leak case the write-side fixes can't); otherwise it falls back to disk cross-validation — an agent is in-scope only if its parent session also wrote a `session-*.json` here. Both legs leave provenance-unknown legacy files (no transcript path) untouched. Verified: clean FEAT-005 reads unchanged (60 agents / $29.13, `excluded_subagents: 0`).

## 0.8.2 — 2026-05-31

### Bug fixes

- **HTML report crashed on `findings` emitted as a dict.** A packet that emits `findings` as a name-keyed object instead of the canonical list (e.g. a fact-finding dev returning `{discrepancy: {...}, raw_data: {...}}`) made `session_report._split_findings` iterate the string keys and raise on `fd.get(...)`, crashing `build_html_report`. Because `generate-session-report` is a fail-open Stop hook, the crash silently left a **stale `report.html`** (one cause of the old-template report on FEAT-005). `_finding_list` now coerces a dict to its values and keeps only dict entries; `_finding_li` gained an `issue` text fallback so dict-keyed findings still render.

## 0.8.1 — 2026-05-31

Cost-reporting fixes surfaced by a consumer-repo `/orchestrator` run whose deployed hooks were a stale SDD version (one report showed 2804 subagents / ~$821, another showed `planning $0`, both wrong).

### Bug fixes

- **Subagent cost backfill scooped up other projects.** The orchestrator backfill globbed `~/.claude/projects/*/*/subagents/agent-*.jsonl` — every project and session on the machine — and `backfill_missing` trusted that list, inflating one report to 2804 agents / ~$821 when the real session had 60 / ~$74. Backfill now derives THIS session's `subagents/` dir from an already-captured `costs/agent-*.json` (`cost_report.session_transcripts` / `_session_subagents_dir`); `backfill_missing` rejects transcripts outside it (defense in depth). No anchor → empty list, never a wide glob.
- **`<synthetic>` messages flagged the report incomplete.** Non-billable transcript messages (context summaries, synthetic errors, harness interruptions) tagged `model: "<synthetic>"` were counted as unpriced models. They are now skipped entirely in `transcript_cost`.
- **Historical unpriced entries froze cost at $0 (the "planning $0" bug).** A session captured before its model entered the price table wrote `total_cost_usd: 0.0` with per-model `cost_usd: null`; adding the price later never repaired the file, and the report trusted the frozen zero. `build_cost_report` now treats a cost file as the immutable record of tokens and re-prices null entries at report time with the current table (verified on real data: FEAT-005 planning $0.00 → $3.73). A present `cost_usd` is trusted verbatim.
- **Subagent capture fallback also globbed all projects.** When a `SubagentStop` payload lacks the transcript path, `capture-subagent-cost` globs for `agent-<id>.jsonl`; the glob was machine-wide (`projects/*/*`). Now scoped to the current project's Claude slug (`_glob_subagent_transcript` / `_slugify_project`, replacing both `/` and `.`), so a homonym agent id under another project is never picked up.

## 0.8.0 — 2026-05-30

Post-mortem of the `[Soundwave] Orchestrator FEAT-010` run surfaced a cluster of governance, identity, and packaging bugs. This release fixes them.

### Breaking changes

- **Canonical identity vocabulary (`spec_id` / `task_id` / `dispatch_id`).** `task_id` was overloaded — the feature in `session.yml` / manifest / audit Work Packet, but a task elsewhere — and the feature itself had three names (`task_id` / `spec_id` / `session_id`). Now: `spec_id` = the feature/Session (`FEAT-NNN`), `task_id` = one task (`T-XXX`), `dispatch_id` = one dispatch. Single source of truth: `shared/concepts/identity.md`.
  - Output Packet schema gains `task_id` (`T-XXX`), **required** for task-scoped roles (dev, code-reviewer, logic-reviewer, qa, blocker-specialist); pipeline-scoped roles (audit-agent, committer) omit it.
  - Work Packet, manifest, and `session.yml` use `spec_id`. Hooks read it with `session_id` / legacy-`task_id` read-compat, so Sessions created before the rename keep working.

### Bug fixes

- **audit-agent Check 3 false-positive — the FEAT-010 root cause.** The audit demanded a `task_id` the Output Packet schema (`additionalProperties: false`) forbade, so every reviewer packet was flagged as "likely fabrication"; the orchestrator then hand-edited 96 packets and re-ran the audit 4× until it passed. Check 3 now correlates by `dispatch_id` and validates `role` + `task_id` (task-scoped only).
- **Cost report claimed `complete: true` with $0.** Two causes: `model_prices.json` was never deployed (the hook copy loop only took `.py` files), and `build_cost_report` treated zero captures as complete. Now the price table ships per-repo and global, `pricing.load_prices` resolves local → global, token capture is decoupled from pricing (tokens are recorded even with no price table — the model is flagged unpriced), and `complete` requires `subagent_count > 0`.
- **Skill templates were not deployed.** `spec-writer` / `designer` / `task-builder` / `discovery-lead` read their templates from the source-repo path, so a clean install fell back to the ai-squad source tree. Deploy now bundles each template into the skill's own dir as `<name>.template.md`.

### Hardening

- **A `blocked` audit verdict is now terminal.** The orchestrator may not edit `outputs/` or re-dispatch the audit to flip a verdict; `guard-session-scope.py` mechanically blocks orchestrator writes under `outputs/`. Recovery from a blocked audit is `/orchestrator FEAT-NNN --restart`.

## 0.7.2 — 2026-05-16

### Bug fixes

- **`spec-writer` still inferred PM mode from `.agent-session/` history despite 0.7.1 fix.** Observed in calendarfr: a repo with 3 prior `auto_approved_by: pm` Sessions caused Opus 4.7 to write `auto_approved_by: pm`, `pipeline_mode: standard`, and full `planned_phases` into a new Session without running `AskUserQuestion`, even with the in-step invariants from 0.7.1. The model made the decision before reaching steps 2/2.5 by doing in-context learning on prior `session.yml` files. Fix layered in three places:
  - **Top-of-file Hard rule** (above `## When to invoke`): explicit "fresh-start mode is ALWAYS interactive. NEVER infer PM bypass / pipeline_mode / planned_phases from prior `.agent-session/` files. PM bypass is set EXCLUSIVELY by `/pm` in the same invocation."
  - **Step 1 read constraint**: when scanning prior `FEAT-*/` directories for ID increment, the ONLY field readable from any prior `session.yml` is the directory name itself. `auto_approved_by`, `pipeline_mode`, `planned_phases`, `phase_history`, `notes` MUST NOT be opened from history.
  - **`## Hard rules` section**: enumerated invariants near the end of the skill restating the same rules, for a third pass of reinforcement.

  The structural fix (PM mode as an out-of-band signal from `/pm`, not a file-inferred state) is tracked as a separate issue for the 0.8 cycle — this 0.7.2 patch is the immediate doc-level mitigation.

## 0.7.1 — 2026-05-16

### Bug fixes

- **`spec-writer` skipped `planned_phases` and `pipeline_mode` questions in repos with prior PM-mode sessions.** Observed in calendarfr: spec-writer detected `auto_approved_by=pm` in `.agent-session/` history and auto-decided both `planned_phases` (full) and `pipeline_mode` (standard) without running `AskUserQuestion`, removing user control over intent. Root cause: steps 2 and 2.5 lacked an explicit invariant that they are NEVER skipped by PM bypass — Opus 4.7 inferred "PM mode end-to-end" from context. Fix: both steps now declare `MANDATORY — runs on every fresh-start invocation. NEVER skipped by PM bypass.` with explicit anti-inference wording. PM bypass only governs approval gates (steps 6.5/7); intent collection is always interactive.

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
