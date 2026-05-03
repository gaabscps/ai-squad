# ai-squad

A generic SDD (Spec Driven Development) agent team framework for Claude Code.

Bring your project — the squad brings the flow.

## How it works

Four Phases. The first three are AI-driven *with* the human in-the-loop; the fourth is fully autonomous.

```
PHASE 1 — Specify (interactive)
  Human ↔ /spec-writer → spec.md (status: approved)

PHASE 2 — Plan (interactive)
  Human ↔ /designer → plan.md (status: approved)

PHASE 3 — Tasks (interactive)
  Human ↔ /task-builder → tasks.md (status: approved)

PHASE 4 — Implementation (autonomous)
  /orchestrator → [dev × N] → (code-reviewer ‖ logic-reviewer) → qa → handoff

POST — Cleanup
  /ship FEAT-XXX → removes runtime artifacts
```

Each Skill, on completion, instructs the human exactly what command to run next — no need to memorize the flow.

## Team

| Role | Phase | Materialization | Responsibility |
|------|-------|-----------------|----------------|
| **spec-writer** | 1 — Specify | Skill | Feature request → approved Spec (interactive). |
| **designer** | 2 — Plan | Skill | Spec → approved Plan: architecture, data model, UX surface, risks (interactive). |
| **task-builder** | 3 — Tasks | Skill | Spec + Plan → approved Tasks: granular work units with file scope and AC coverage (interactive). |
| **orchestrator** | 4 — Implementation | Skill | Reads Spec/Plan/Tasks; dispatches Subagents; enforces caps; emits handoff. |
| **dev** | 4 | Subagent | Spec + Plan + Tasks → implementation. |
| **code-reviewer** | 4 | Subagent | Implementation vs codebase patterns and conventions. |
| **logic-reviewer** | 4 | Subagent | Implementation vs Spec: edge cases, missing flows, partial-failure risks. |
| **qa** | 4 | Subagent | Runs the feature against the Spec's acceptance criteria, reports pass/fail. |
| **blocker-specialist** | 4 (escalation) | Subagent | Unblocks what no other agent can resolve, arbitrates reviewer disagreements. |

4 Skills (one per Phase) + 5 Subagents (all Phase 4) = 9 canonical Roles.

## Repo layout

```
skills/                       ← Claude Code skills (run in main session, slash-invoked)
  spec-writer/skill.md
  designer/skill.md
  task-builder/skill.md
  orchestrator/skill.md
agents/                       ← Claude Code subagents (isolated context, dispatched by orchestrator)
  dev.md
  code-reviewer.md
  logic-reviewer.md
  qa.md
  blocker-specialist.md
templates/                    ← Spec / Plan / Tasks (Markdown) + Work/Output Packets (JSON) + Session (YAML)
  spec.md
  plan.md
  tasks.md
  work-packet.json
  output-packet.json
  session.yml
docs/                         ← Glossary + concept definitions (start here)
tools/deploy.sh               ← Installs to ~/.claude/skills and ~/.claude/agents
```

## Install

```bash
./tools/deploy.sh
```

## Usage

Invoke each Phase's Skill in order. The first Skill (`/spec-writer`) asks via interactive checkbox which Phases will run for this Session (default: all 4):

```
/spec-writer       → Phase 1: interactive Spec session (asks planned_phases at entry)
/designer          → Phase 2: interactive Plan session (after Spec approved)
/task-builder      → Phase 3: interactive Tasks session (after Plan approved)
/orchestrator      → Phase 4: autonomous Implementation (after Tasks approved)
/ship FEAT-XXX     → Post-LGTM: removes runtime artifacts
```

The selected `planned_phases` is saved to the Session and respected by every subsequent Skill. Skipping any Phase (including Phase 4 itself) is supported.

**Workflow examples:**

- **Full run** (default): all 4 Phases checked → Spec → Plan → Tasks → Implementation → handoff.
- **Plan now, execute later**: check Specify + Plan + Tasks but uncheck Implementation. Session ends in `paused` after Tasks. Resume any time with `/orchestrator FEAT-XXX --resume`.
- **Spec only**: check only Specify (e.g. for ticketing without ai-squad implementation). Session enters `paused` after Specify; clean up with `/ship` when done.

**Power-user flag override** (skips the interactive prompt): `/spec-writer FEAT-042 --plan="specify,plan,tasks"`.

## Recommended runtime model per Phase

Skills inherit the model from the human's main session. Set with `/model` before invoking.

- **Phase 1 (`/spec-writer`):** `/model opus` recommended — Spec drafting benefits from Opus's reasoning.
- **Phase 2 (`/designer`):** `/model opus` recommended — Plan decisions are reasoning-heavy.
- **Phase 3 (`/task-builder`):** `/model sonnet` is sufficient — task decomposition is more procedural.
- **Phase 4 (`/orchestrator`):** `/model sonnet` for sequential dispatch; `/model opus` if the orchestrator needs to decompose for multi-instance fan-out.

Subagent models are fixed in the Role definitions and follow the calibration in [`docs/concepts/effort.md`](docs/concepts/effort.md) — Sonnet for most Roles; Opus for `logic-reviewer` and `blocker-specialist`.

## Persistence model — runtime only

ai-squad treats all Phase artifacts (Spec / Plan / Tasks / Work Packets / Output Packets / logs) as **runtime contracts**, not long-term documentation. They live under `.agent-session/<task_id>/` in the consumer project, which **must be gitignored**.

After the human accepts the handoff, `/ship FEAT-XXX` removes the directory entirely. Long-term tracking (Jira, ClickUp, GitHub PR descriptions) is the consumer project's responsibility — the orchestrator's handoff message is designed to be copied directly into those systems.

This avoids duplicating information that already lives in proper tracking tools, and keeps the consumer's repo clean of framework-specific artifacts.

## Project context

The squad is project-agnostic. Each project injects its own context via the Work Packet's `project_context` field (stack, standards reference). The Roles never reference a specific project.

## Read first

- [`docs/glossary.md`](docs/glossary.md) — canonical vocabulary. Every other doc and Role file must use these terms.
- [`docs/concepts/`](docs/concepts/) — one file per canonical concept (`role`, `skill-vs-subagent`, `effort`, `spec`, `evidence`, `output-packet`, `work-packet`, `phase`, …).
