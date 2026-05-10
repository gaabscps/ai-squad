# @ai-squad/agentops

AgentOps observability for [ai-squad](https://github.com/gaabscps/ai-squad) SDD and Discovery pipelines.

## Install

```bash
npm install @ai-squad/agentops
```

## Configuration

Create `.agentops.json` in your project root:

```json
{
  "sessionPrefix": "FEAT-",
  "reportCommand": null,
  "priorFlows": [],
  "bypassFlows": [],
  "rootDir": ".agent-session"
}
```

Only `sessionPrefix` is required. All other fields are optional with the defaults shown above.

## Commands

```bash
npx agentops report          # Generate Markdown + HTML reports
npx agentops capture         # Claude Code Stop hook (PM session capture)
npx agentops doctor          # Diagnose configuration
npx agentops install-hooks   # Register Stop hook in .claude/settings.local.json
```
