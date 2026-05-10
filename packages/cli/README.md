# @ai-squad/cli

CLI to deploy [ai-squad](https://github.com/gaabscps/ai-squad) squads (skills, agents, hooks) into Claude Code (`~/.claude/`) and Cursor (`~/.cursor/`).

## Install

```bash
npm i -g @ai-squad/cli
```

## Usage

```bash
ai-squad deploy                      # all squads → ~/.claude/
ai-squad deploy --squad sdd          # only sdd
ai-squad deploy --cursor             # all squads + ~/.cursor/ mirror
ai-squad help
```

After deploy:

- Skills land flat in `~/.claude/skills/<skill>/`
- Subagents in `~/.claude/agents/<agent>.md`
- Python hooks in `~/.claude/hooks/<name>.py` (chmod +x preserved)

Hook scripts are referenced from component frontmatter as
`python3 $HOME/.claude/hooks/<name>.py` — global install, no per-project setup.

## Squads bundled

- **sdd** — Spec-Driven Development pipeline (4 phases: Specify → Plan → Tasks → Implementation). Subagents: `dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`, `audit-agent`.
- **discovery** — Cagan-style Discovery (Frame → Investigate → Synthesize). Subagents: `codebase-mapper`, `risk-analyst`.

## Companion: observability

For session reports (tokens, cost, AC closure, reviewer findings):

```bash
npx @ai-squad/agentops report
```

## Requirements

- Node ≥ 18
- Python 3.8+ on PATH (hook scripts are pure-stdlib Python)

## License

MIT — Gabriel Andrade
