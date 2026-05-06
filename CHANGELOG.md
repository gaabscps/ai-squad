# Changelog

All notable changes to ai-squad are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Dev agent no longer commits automatically — changes stay in the working tree for human review before commit
- Reviewers and QA reference `files_changed[]` directly instead of commit SHAs
- Orchestrator handoff instructs human to review with `git diff` / `git status` before committing

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
