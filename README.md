# ai-squad

A generic SDD (Spec Driven Development) agent team framework for Claude Code.

Bring your project — the squad brings the flow.

## How it works

```
PHASE 1 — Interactive (human present)
  Human ↔ spec-writer → approved spec

PHASE 2 — Autonomous (human absent)
  orchestrator → designer → dev → tech-lead → handoff
```

## Team

| Role | Responsibility |
|---|---|
| **orchestrator** | Routing, session state, human-readable output |
| **spec-writer** | Feature request → approved spec (interactive) |
| **designer** | Spec → UX/system design decisions |
| **dev** | Spec + design → implementation |
| **tech-lead** | Implementation vs spec: patterns + logic review |
| **blocker-specialist** | Unblocks what no other agent can resolve |

## Install

```bash
./tools/deploy.sh
```

## Usage

```
/spec-writer   → start a spec session (interactive)
/orchestrator  → run the autonomous team against an approved spec
```

## Project context

Each project injects its own context via `work-packet.yml`. The squad skills stay generic.

See `docs/customizing.md` for how to wire up a project.
