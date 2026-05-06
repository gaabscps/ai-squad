# Changelog

All notable changes to ai-squad are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## 0.3.0 — 2026-05-06

### Added

- **Kiro deploy path** — `./tools/deploy-kiro.sh` converts every ai-squad skill (`squads/<squad>/skills/*/skill.md`) and subagent (`squads/<squad>/agents/*.md`) to a Kiro Custom Agent at `~/.kiro/agents/<name>.json` (via [`tools/kiro_convert_agent.py`](tools/kiro_convert_agent.py)) and syncs `hooks/*.py` to `~/.kiro/hooks/`. Hooks are wired per-agent inside each agent JSON (`preToolUse[]` + `stop[]`), mirroring the per-Skill/Subagent wiring used in Claude Code — so `guard-session-scope` only fires for the orchestrator. Does not touch `~/.claude/`, `~/.cursor/`, or `~/.kiro/skills/` (Kiro's native Skills primitive is left untouched because it can't carry hooks).
- **`scripts/smoke-kiro-export.sh`** — validates that every agent `.md` converts to parseable JSON and every `skill.md` exports cleanly. Does not install to `~/.kiro/`.

### Fixed

- Docs: Cursor **does** support slash + skill name (and `@skill` / picker); removed incorrect “no slash in Cursor” wording in README and `cursor_export_skill.py` callout.
- **Schema/hook drift on `summary`** — `shared/concepts/output-packet.md` always required `summary`, but `shared/schemas/output-packet.schema.json` and `squads/sdd/hooks/verify-output-packet.py` did not enforce it. Schema + hook now match the canonical doc.
- **Severity enum drift** — schema previously listed `["blocker","major","minor","error","warning","info"]` while the doc described 4 reviewer levels. Aligned both around the 6-level closed enum (`info | warning | error | critical | major | blocker`) with `major`/`blocker` reserved for `audit-agent` reconciliation findings (already in use since 0.2.0).
- **`ac_coverage` pattern drift** — schema now requires the prefixed form `^(FEAT|DISC)-\d{3,}/AC-\d{3,}$` (was `^AC-\d{3,}$`), matching the canonical example in `shared/concepts/output-packet.md` and Discovery's cross-squad usage. Updated `qa.md` Output contract to use `FEAT-XXX/AC-XXX` keys.
- **Evidence enum trimmed to 6 kinds** — removed `kind: commit` (workflow does not produce commits at the dev step; humans review and commit after handoff). Updated `evidence.md`, `glossary.md`, `output-packet.md`, schema, and example template.

### Notes (Kiro compatibility)

- **Tool names** — `tools/kiro_convert_agent.py` emits Kiro's canonical names (`read`, `write`, `shell`, `grep`, `glob`); legacy aliases (`fs_read`, `fs_write`, `execute_bash`) are still accepted by Kiro CLI per the in-binary changelog ("Hook matchers now recognize tool aliases").
- **Models** — `MODEL_MAP` uses official Kiro `model_id`s verified via `kiro-cli chat --list-models`: `auto` (default; chosen per task) for `sonnet`/`opus`, `claude-haiku-4.5` for `haiku`.
- **`WebSearch` / `WebFetch`** — no built-in Kiro equivalent; converter drops them with a stderr warning. Install an MCP server that provides them and reference via `@<server>/<tool>` in the agent's `tools[]`.
- **Slash command** — inside a Kiro chat, `/agent` opens a picker. Direct launch is `kiro-cli --agent <name>` from the shell.

## 0.2.0 — 2026-05-06

### Added

- **Cursor orchestrator export** — `tools/cursor_export_skill.py` appends a Cursor-only hard-rules callout when `name` is `orchestrator` (no change to `squads/` skill source read by Claude).
- **Cursor deploy path** — `./tools/deploy-cursor.sh` exports skills, always syncs `squads/sdd/hooks/*.py` to `~/.cursor/hooks/ai-squad/`, and merges `squads/sdd/hooks/cursor-hooks.json` into `~/.cursor/hooks.json` (see `tools/merge_ai_squad_cursor_hooks.py`). Optional `SKIP_CURSOR_HOOK_MERGE`.
- **Dual-runtime hooks** — new [`hook_runtime.py`](squads/sdd/hooks/hook_runtime.py); all enforcement scripts resolve project root from `CLAUDE_PROJECT_DIR` or Cursor stdin (`workspace_roots` / `cwd`). `verify-audit-dispatch` skips when `session.yml` shows no Phase 4–style activity (safer global `stop` in Cursor). **`guard-session-scope`** is not merged into Cursor's `hooks.json` (would block `dev`); same Python source, Claude-only wiring via Skill frontmatter.
- **`audit-agent` Subagent** (haiku, read-only with Bash for git inspection, singleton) — last gate before pipeline handoff. Reconciles dispatch manifest vs. actual outputs to detect orchestrator-bypass (issue #1). 6 mechanical checks: manifest completeness, dispatch-to-output 1:1, role/task_id consistency, pipeline-stage coverage, AC closure, source-file ownership. Pattern lineage: GitHub required status checks + Verifiability-First Audit Agents (arXiv 2512.17259) + transactional Outbox.
- **Dispatch manifest** at `.agent-session/<task_id>/dispatch-manifest.json` — orchestrator declares expected pipeline before any Task dispatch and appends to `actual_dispatches[]` after each. Mechanical audit trail (JSON for stdlib parseability by hooks).
- **Audit-failure handoff** shape — fourth handoff variant emitted when audit-agent flags bypass; refuses normal handoff and surfaces findings.
- **Mechanical enforcement layer (Claude Code hooks)** — pure-stdlib Python 3 scripts wired via Skill/Subagent frontmatter, closing the prompt-discipline → mechanical-enforcement gap:
  - `guard-session-scope.py` — orchestrator can edit only inside `.agent-session/<task_id>/`
  - `block-git-write.py` — orchestrator cannot run git write commands (commit, add, reset, push, etc.)
  - `verify-audit-dispatch.py` — orchestrator session cannot end without `audit-agent` in `actual_dispatches[]`
  - `verify-output-packet.py` — every Phase 4 Subagent must write `outputs/<dispatch_id>.json` before completing
  - Distribution: `./tools/deploy.sh` copies hooks to `~/.claude/hooks/` (global, same model as skills/agents). Frontmatter references `python3 $HOME/.claude/hooks/<name>.py`; `$HOME` expanded by shell. No per-project setup. Requires Python 3.8+ on PATH (verified by deploy.sh).
- **`tools/deploy.sh` updated** — verifies Python 3 availability, copies `squads/<squad>/hooks/*.py` to `~/.claude/hooks/`, preserves `chmod +x`.

### Changed

- Phase transitions auto-advance after approval — skills invoke the next planned Phase automatically instead of asking the human to type the slash command
- Dev agent no longer commits automatically — changes stay in the working tree for human review before commit
- Reviewers and QA reference `files_changed[]` directly instead of commit SHAs
- Orchestrator handoff instructs human to review with `git diff` / `git status` before committing
- Orchestrator: hard rule "Never edit consumer-repo source files; writes restricted to `.agent-session/`"
- Role count: 9 → 10 (added `audit-agent`); Subagent count: 5 → 6
- Output Packet schema: `audit-agent` added to role enum; `bypass_detected` documented as `blocker_kind`

### Removed

- Automatic `git commit` step from dev agent pipeline (was step 8)
- "Commits" section from handoff template
- Commit SHA references from reviewer and QA input contracts

## 0.1.0 — 2026-05-03

Initial architecture and full pipeline implementation.

### Added

- Project scaffolding with `squads/` + `shared/` mono-repo layout
- **SDD squad** — 4 Phase pipeline: Specify → Plan → Tasks → Implementation
  - 4 Skills: `spec-writer`, `designer`, `task-builder`, `orchestrator`
  - 5 Subagents: `dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`
- **Discovery squad** — 3 Phase pipeline: Frame → Investigate → Decide
  - 2 Skills: `discovery-lead`, `discovery-synthesizer`
  - 2 Subagents: `codebase-mapper`, `risk-analyst`
- Shared concepts: Evidence taxonomy (7 kinds), Output Packet schema, Role/Skill/Subagent split, Phase lifecycle
- Canonical templates: `spec.md`, `plan.md`, `tasks.md`
- `planned_phases` checkbox UI — any Phase (including Implementation) can be skipped
- `bypassPermissions` on all 5 SDD Subagents for Phase 4 autonomy
- Orchestrator dispatch loop with capped concurrency (5), hash-based stall detection, and blocker-specialist cascade
- MIT license
- V2 concept research: Supervisor agent (HOTL pattern) documented in `docs/`
