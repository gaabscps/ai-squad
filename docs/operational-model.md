# Operational model

How ai-squad is wired at runtime: which Claude model each Phase uses, how permissions are scoped, where state lives.

## Recommended Claude model per Phase

| Squad | Phase | Model | Why |
|-------|-------|-------|-----|
| SDD | 1 — Specify | opus | Spec drafting is reasoning-heavy |
| SDD | 2 — Plan | opus | Architecture decisions are reasoning-heavy |
| SDD | 3 — Tasks | sonnet | Decomposition is more procedural |
| SDD | 4 — Orchestrator | sonnet (opus for complex fan-out) | Sequential dispatch + state management |
| Discovery | 1 — Frame | opus | Opportunity framing is reasoning-heavy |
| Discovery | 2 — Investigate | sonnet (mapper) / opus (risk-analyst) | Mapping is procedural; risk judgment is reasoning-heavy |
| Discovery | 3 — Decide | opus | Synthesis + decision rules + override judgment |

Subagent models are fixed in their definitions per [`shared/concepts/effort.md`](../shared/concepts/effort.md).

## Permissions

SDD Phase 4 workers and Discovery Phase 2 workers run in `bypassPermissions` mode (autonomous by design). Safety comes from defense-in-depth:

- **Per-worker tool allowlists** — Discovery's `codebase-mapper` is read-only by allowlist (Read, Bash, Grep, Glob); `risk-analyst` adds WebSearch/WebFetch; SDD's `dev` adds Edit/Write.
- **Per-task file scope** — every Work Packet carries `scope_files`; the Subagent's prompt forbids edits outside it; the orchestrator verifies on read.
- **Per-role authority boundaries** — reviewers are read-only; only `dev` writes code; only the entry Skills write the Phase artifact (spec/plan/tasks/memo).

Run on a feature branch you'd normally review before merging — never in a directory mixed with secrets.

## Persistence

All artifacts live under `.agent-session/<task_id>/` in your project (gitignored).

```
<consumer-project>/
  .agent-session/                        ← gitignored
    FEAT-042/                            ← SDD session
      spec.md
      plan.md
      tasks.md
      session.yml
      inputs/<dispatch_id>.json
      outputs/<dispatch_id>.json
      handoff.md
    DISC-007/                            ← Discovery session
      memo.md
      session.yml
      inputs/<dispatch_id>.json          ← codebase-mapper + 4× risk-analyst
      outputs/<dispatch_id>.json
```

After you accept the handoff, `/ship FEAT-NNN` or `/ship DISC-NNN` deletes the directory. Long-term tracking belongs in your existing tools — copy what you need before running `/ship`:

- **SDD handoff** → Jira / Linear / GitHub PR description (the handoff message is formatted to copy-paste cleanly)
- **Discovery memo** → Confluence / Productboard / Notion (or wherever you keep durable Discovery records)
