# Changelog

All notable changes to `@ai-squad/agentops` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.1.0] - 2026-05-10

### Added
- `agentops report` — Markdown/HTML report generation from `.agent-session/` directories; configurable `sessionPrefix` (string or array) and `reportCommand`
- `agentops capture` — PM session capture for Claude Code Stop hooks; writes Output Packets to dispatch-manifest
- `agentops doctor` — prints resolved config (env > `.agentops.json` > defaults) with source attribution per field; exits non-zero if required fields are missing
- `agentops install-hooks` — idempotent Stop hook registration in `.claude/settings.local.json`; atomic write; correct Claude Code nested hook format
- `.agentops.json` configuration: `sessionPrefix`, `priorFlows`, `bypassFlows`, `reportCommand`
- CJS bundle via esbuild — no `tsx` required in consumer projects; install with `npm install @ai-squad/agentops`
- Multi-prefix `sessionPrefix` support: accepts string or string array (e.g. `["FEAT-", "DISC-"]`)
- Configurable `priorFlows` / `bypassFlows` arrays replace hardcoded values
- Exit code non-zero with actionable message when scan finds zero matching sessions
