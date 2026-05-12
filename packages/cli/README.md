# @ai-squad/cli

CLI to deploy [ai-squad](https://github.com/gaabscps/ai-squad) squads into Claude Code. Skills + agents install user-globally; hooks install per-repo (so the `.agent-session/` telemetry your `@ai-squad/agentops` reports rely on stays consistent with the hook version that produced it).

## Install

```bash
npm i -g @ai-squad/cli
```

## Usage

```bash
# Run once per consumer repo — installs skills+agents globally AND hooks locally.
cd <consumer-repo>
ai-squad deploy

# Selective:
ai-squad deploy --squad sdd          # only the sdd squad
ai-squad deploy --hooks-only         # re-sync just hooks (after upgrading the CLI)
ai-squad deploy --global-only        # skip per-repo hooks (CI / dotfile flow)
ai-squad deploy --cursor             # also mirror to ~/.cursor/
ai-squad help
```

After deploy:

- Skills land flat in `~/.claude/skills/<skill>/` (user-global)
- Subagents in `~/.claude/agents/<agent>.md` (user-global)
- Python hooks in `<repo>/.claude/hooks/<name>.py` (per-repo, chmod +x)
- `.claude/hooks/` is appended to the repo's `.gitignore` automatically

Hook scripts are referenced from component frontmatter as
`python3 $CLAUDE_PROJECT_DIR/.claude/hooks/<name>.py` — Claude Code expands
`$CLAUDE_PROJECT_DIR` to the current project root before invoking the hook.

### Why per-repo hooks?

- **Telemetry consistency:** the hooks that produced `.agent-session/<id>/dispatch-manifest.json` ship in the same repo, so the report engine and the data always agree on schema.
- **Reproducible CI:** runners don't need a pre-seeded `$HOME` — `ai-squad deploy` in setup works.
- **Multi-version safe:** different consumer repos can run different ai-squad versions concurrently without `~/.claude/hooks/` collisions.
- **Inspectable:** `cat <repo>/.claude/hooks/verify-tier-calibration.py` shows exactly what is running, no guessing about which `~/.claude/` version got installed.

### Upgrading

```bash
npm i -g @ai-squad/cli@latest
cd <each consumer repo>
ai-squad deploy --hooks-only    # pick up the new hooks
```

The global skills+agents update automatically on any `ai-squad deploy`.

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
