# Concept — `Skill` vs `Subagent`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md) and [`phase.md`](phase.md).

## Definition

Skill and Subagent are the two **materializations** a Role can take on the Claude Code platform. They are mutually exclusive: a Role is either a Skill or a Subagent — never both. The choice is determined by a single binary criterion (below) and is not a stylistic preference.

> *Terms used in this doc:*
> - **frontmatter:** the YAML block between `---` markers at the top of a `.md` file. Carries config and metadata.
> - **dispatch:** a Skill (or another parent context) invoking a Subagent via the `Agent` tool.
> - **human-in-the-loop:** the human participates repeatedly during the Role's execution (multiple turns of question/answer), as opposed to participating only at entry and exit.

## The decision criterion

A Role is a **Skill** if at least one of the following is true:

1. It needs to interact with the human in-the-loop, **OR**
2. It needs to dispatch Subagents.

Otherwise, it is a **Subagent**.

The criterion is binary. There is no half-Skill / half-Subagent. If a new Role's classification is ambiguous, default to **Subagent** (more isolated, less surprise; easier to lift to Skill later than the reverse).

### Truth table for the 10 canonical Roles

| Role | Phase | Needs human in-the-loop? | Needs to dispatch Subagents? | → Materialization |
|------|-------|--------------------------|------------------------------|-------------------|
| `spec-writer` | 1 | Yes (asks scoping questions, refines Spec) | No | **Skill** |
| `designer` | 2 | Yes (refines design decisions, validates Plan) | No | **Skill** |
| `task-builder` | 3 | Yes (reviews task decomposition, AC mapping) | No | **Skill** |
| `orchestrator` | 4 | No (only the final handoff, which is one-shot) | Yes (dev, reviewers, qa, blocker-specialist, audit-agent) | **Skill** |
| `dev` | 4 | No | No | **Subagent** |
| `code-reviewer` | 4 | No | No | **Subagent** |
| `logic-reviewer` | 4 | No | No | **Subagent** |
| `qa` | 4 | No | No | **Subagent** |
| `blocker-specialist` | 4 (escalation) | No (returns `status: escalate`; the orchestrator handles the human handoff) | No | **Subagent** |
| `audit-agent` | 4 (pre-handoff gate) | No | No | **Subagent** |

4 Skills + 6 Subagents = 10 canonical Roles. Each Skill is a Skill for at least one of the two criteria; each Subagent is a Subagent because it satisfies neither.

Note on `orchestrator`: the final handoff message to the human is **not** "human-in-the-loop". It is one-shot output. The criterion's "in-the-loop" means N rounds of interactive question/answer, which is what the 3 Phase 1–3 Skills do.

Note on `blocker-specialist`: "escalating to human" means returning `status: escalate` in its Output Packet. The orchestrator is the one that surfaces that back to the human. The blocker-specialist itself never converses with the human, so it does not trigger criterion 1.

## Why this and not the alternatives

Two simpler criteria were considered and rejected:

- **Pure interactivity criterion** ("Skill iff needs human in-the-loop"): fails for the orchestrator, which has no in-the-loop interaction but cannot be a Subagent because Subagents cannot dispatch other Subagents (platform constraint, see below).
- **Pure dispatch criterion** ("Skill iff dispatches Subagents"): fails for `spec-writer`, `designer`, and `task-builder`, which dispatch no one but cannot be Subagents because Subagents cannot interact with the human (platform constraint).

The combined OR criterion is the smallest rule that covers all 10 Roles without forcing exceptions.

## Platform constraints (non-negotiable)

These come from Claude Code itself, not from ai-squad. They drive the criterion above and cannot be worked around.

| Capability | Skill | Subagent |
|------------|-------|----------|
| Where it runs | Main session (shares context with the human) | Isolated fresh context |
| Sees the human's conversation history? | Yes | No — only receives the parent's prompt |
| Can interact with the human (ask, wait)? | Yes | **No** |
| Can dispatch other Subagents? | **Yes** | **No** |
| Returns to parent | Continues the conversation | Single final summary |
| Invocation surface | Slash command (`/spec-writer`, `/designer`, `/task-builder`, `/orchestrator`) | `Agent` tool with `subagent_type` |
| Filesystem location | `~/.claude/skills/{name}/skill.md` | `~/.claude/agents/{name}.md` |
| Frontmatter accepted | Limited (`name`, `description`, etc.) | Rich: `name`, `description`, `model`, `tools`, `effort`, `permissionMode`, `maxTurns`, `isolation`, `hooks`, etc. |

## Skills are drivers, not doers

A Skill **coordinates**: it converses with the human and/or dispatches Subagents. The heavy lifting — code changes, design analysis, reviews, validation — must live in Subagents, where the context is isolated.

**Anti-pattern:** a Skill that "does the work" inline. For example, a `spec-writer` that drafts implementation hints itself instead of just producing the Spec; a `designer` that writes pseudocode instead of design decisions; an `orchestrator` that writes code instead of dispatching `dev`. When a Skill starts working, it is stealing scope from a Subagent and polluting the main session's context with implementation details that should have stayed isolated.

The rule of thumb: if you find yourself writing implementation logic in a Skill, the work belongs in a Subagent (or in a new Subagent that does not yet exist).

The 3 Phase 1–3 Skills (`spec-writer`, `designer`, `task-builder`) are pure facilitators of human-in-the-loop sessions; their output is an artifact (Spec / Plan / Tasks). The orchestrator is a pure dispatcher; its output is the handoff. None of them produces code.

## Edge case — Skills as capabilities within Subagents

Two distinct things must not be confused:

1. **Dual-materialization** (one Role with both a Skill file *and* a Subagent file, invokable both ways). **Forbidden by the binary criterion.** Causes file duplication and drift. Each Role picks one side.

2. **Skill loaded as a capability inside a Subagent.** The platform allows a `skills: [...]` field in a Subagent's frontmatter, meaning "this Skill is pre-loaded as a tool available inside this Subagent's isolated context". The Skill remains a Skill (defined in `skills/`); the Subagent only *consumes* it as an auxiliary capability.

Case 2 does not violate the binary criterion. The two operations are at different layers:

- *Materialization* of a Role = which file under `skills/` or `agents/` defines it.
- *Capability loading* = what tools/skills a Subagent can use inside its execution context.

The MVP of ai-squad does not use case 2 — none of the 6 Subagents loads any Skill from this repo as a capability. The note above is informational, to prevent future confusion when projects extend the squad.

## Decision flowchart for a new Role

```
Does the Role need to converse with the human across multiple turns?
  ├─ Yes → Skill
  └─ No → Does the Role need to dispatch other Subagents?
            ├─ Yes → Skill
            └─ No → Subagent
```

If you cannot answer either question with a clear "yes", default to Subagent.

## Frontmatter and FS layout — practical reference

**Skill** (`skills/{name}/skill.md`):

```markdown
---
name: designer
description: One-paragraph description used by the human reading slash-command lists.
---

# Designer

[Body — interactive flow with the human, refusal conditions, handoff message instructing next slash command]
```

The Skill's `model` and `effort` are not declared in its frontmatter — they are inherited from the human's main session. See [`effort.md`](effort.md) for how this interacts with Subagent effort selection. See [`phase.md`](phase.md) for the convention that every Skill's body must end with a "guided next step" (the slash command to run next).

**Subagent** (`agents/{name}.md`):

```markdown
---
name: dev
description: One-paragraph description used by the orchestrator to pick this Role for dispatch.
model: sonnet
tools: Read, Edit, Write, Bash, Grep
effort: high
fan_out: true
---

# Dev

[Body — role instructions, contracts consumed/produced, anti-patterns]
```

The Subagent's frontmatter carries the full execution config because the parent (orchestrator) does not get to override it at dispatch time — it is fixed by the Role definition (overridable per-dispatch via Work Packet's `model`/`effort` fields; see [`work-packet.md`](work-packet.md)).
