# Concept — `Role`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md).

## Definition

A **Role** is the unit of *responsibility* in a squad — `dev`, `qa`, `designer`, `task-builder`, `discovery-lead`, `risk-analyst`, etc. It is conceptually distinct from its *materialization* on the platform (Skill or Subagent). One Role = one responsibility = one file.

Roles are **organized per squad** — each squad declares its own closed set. Cross-squad reuse is allowed when the responsibility is genuinely shared (e.g. `blocker-specialist` is defined in SDD but reusable by Discovery's `discovery-orchestrator`).

ai-squad currently ships **15 canonical Roles across 2 squads** (10 SDD + 5 Discovery). The set is closed at the framework level. Projects that need a new responsibility must fork the framework, add it to an existing squad, or define a new squad. Adding extensibility later is easy; closing an open API later is painful — we default closed.

## SDD squad — 10 canonical Roles

| Role | Materializes as | Phase | Responsibility |
|------|-----------------|-------|----------------|
| `spec-writer` | Skill | 1 — Specify | Drives the interactive Phase 1 session that produces an approved Spec. |
| `designer` | Skill | 2 — Plan | Drives the interactive Phase 2 session that produces an approved Plan from the Spec. |
| `task-builder` | Skill | 3 — Tasks | Drives the interactive Phase 3 session that produces an approved Tasks list from Spec + Plan. |
| `orchestrator` | Skill | 4 — Implementation | Reads Spec/Plan/Tasks, dispatches Subagents, enforces caps, surfaces the handoff. |
| `dev` | Subagent | 4 | Implements the feature against Spec + Plan + Tasks. |
| `code-reviewer` | Subagent | 4 | Reviews implementation against codebase patterns and conventions. Read-only. |
| `logic-reviewer` | Subagent | 4 | Reviews implementation against the Spec for behavioral gaps. Read-only. |
| `qa` | Subagent | 4 | Validates the implemented feature against the Spec's acceptance criteria. |
| `blocker-specialist` | Subagent | 4 (escalation) | Escalation handler. Invoked only on `status: blocked` or reviewer disagreement. **Reusable cross-squad** — Discovery's `discovery-orchestrator` invokes it on Phase 2 cascades. |
| `audit-agent` | Subagent | 4 (pre-handoff gate) | Singleton reconciliation gate. Reads dispatch manifest + outputs/ to verify orchestrator did not bypass Subagent dispatch. Read-only. |

## Discovery squad — 5 canonical Roles

| Role | Materializes as | Phase | Responsibility |
|------|-----------------|-------|----------------|
| `discovery-lead` | Skill | 1 — Frame | Drives the interactive Frame session that produces a memo from Cagan's Opportunity Assessment Q1-Q9. |
| `discovery-orchestrator` | Skill | 2 — Investigate | Dispatches `codebase-mapper` (sequential) → 4× `risk-analyst` (parallel, one per Cagan Big Risk); aggregates Output Packets into `## Investigate Findings`. Conditional approval gate. |
| `codebase-mapper` | Subagent | 2 | Read-only "code spelunking" producing C4 Level 1 + Level 2 view (System Context + Containers). Feeds the 4 parallel `risk-analyst` instances. |
| `risk-analyst` | Subagent | 2 | Multi-instance — one dispatch per Cagan Big Risk (value/usability/feasibility/viability). Returns verdict + risk_severity + rationale + structured evidence + assumptions. Timebox > retry — emits `inconclusive` rather than looping. |
| `discovery-synthesizer` | Skill | 3 — Decide | Generates Options table (kill always row 1) + Recommendation (Cagan Q10) via decision rules R1-R5; conducts RAPID-style Show-all + Recommend approval gate; writes Decision + Open Questions for Delivery. |

**Total: 15 canonical Roles** across 2 squads (7 Skills + 8 Subagents). `blocker-specialist` is the only Role formally shared cross-squad — defined under SDD, reusable from Discovery's escalation paths.

## Why a closed set

A closed set is opinionated by design. The trade-off:

- **Gain:** the orchestrator and the Phase Skills always know who to dispatch / hand off to next. The pipeline is guaranteed-runnable. Users do not have to author roles to adopt the framework — they bring their project, the squad brings the flow.
- **Cost:** projects that want a domain-specific Role (e.g. `security-reviewer`, `i18n-checker`) must fork. This is a deliberate friction. Adding extensibility later is easy; closing an open API later is painful. We default closed.

Industry context: CrewAI ships an open Role model and the dominant failure mode reported in practice is prompt sprawl (every project invents its own Roles, defeating reuse). LangGraph and Anthropic's Building Effective Agents both favour fixed, named patterns over open extensibility.

## Anatomy of a Role file

Every Role lives in **exactly one file**. Frontmatter is the contract with the platform; body is the prompt.

**Subagent example** (6 of the 10 SDD Roles — full frontmatter):

```markdown
---
name: dev                                   # kebab-case, matches filename
description: One paragraph the orchestrator…  # used by parent to pick this Role
model: sonnet                                # platform: sonnet | opus | haiku
tools: Read, Edit, Write, Bash, Grep         # platform allowlist
effort: high                                 # platform: low | medium | high | xhigh | max
fan_out: true                                # ai-squad: this Role can be instantiated N times in parallel
---

# Dev

[Body: the role's instructions, contracts it consumes/produces, anti-patterns]
```

**Skill example** (4 of the 10 SDD Roles — slim frontmatter; Skills inherit `model`/`effort` from the human's main session):

```markdown
---
name: designer
description: One-paragraph description used by the human reading slash-command lists.
---

# Designer

[Body: interactive flow with the human, refusal conditions, handoff message]
```

See [`skill-vs-subagent.md`](skill-vs-subagent.md) for why frontmatter differs.

## Naming convention

- **kebab-case**, lowercase, no underscores: `code-reviewer`, not `CodeReviewer` or `code_reviewer`. Matches Claude Code's subagent name convention.
- Filename equals `name` field equals invocation handle. No aliases.
- Role names are nouns describing *what they are* (`designer`, `qa`, `task-builder`), not *what they do* (`design-the-thing`, `run-tests`, `build-tasks`).

## What a Role is NOT

- **Not a personality.** No backstory, no "you are an experienced senior X with 20 years of Y". Anti-CrewAI: backstory rarely pays for the prompt tokens it consumes.
- **Not a runtime instance.** A Role is a *definition*. The orchestrator (or the human, for Skills) instantiates it at invocation time.
- **Not extensible by the host project.** Project-specific rules, naming, and conventions belong in the host project's `CLAUDE.md` — the Role *reads* them via the Work Packet's `project_context` (for Subagents) or the Skill's session context, but the Role itself stays generic.
- **Not free to skip steps in the Pipeline.** The orchestrator decides Pipeline-level skips inside Phase 4. A Role cannot decide to bypass the next Role.

## Multi-instance — first-class capability for Subagents

`fan_out` (the orchestrator instantiating the same Role N times in parallel, each with a write-disjoint scope) applies **only to Subagents**. Skills run in the human's main session — there is one Skill instance at a time by definition.

| Role | Squad | Materialization | `fan_out` | Reason |
|------|-------|-----------------|-----------|--------|
| `dev` | sdd | Subagent | true | Implementation is decomposable by file/module. |
| `code-reviewer` | sdd | Subagent | true | Review of disjoint diffs is independent. |
| `logic-reviewer` | sdd | Subagent | true | Same — disjoint diffs reviewed independently. |
| `qa` | sdd | Subagent | true | Acceptance criteria can be split across independent surfaces. |
| `blocker-specialist` | sdd (cross-squad) | Subagent | false | Singular escalation handler per blocker. |
| `audit-agent` | sdd | Subagent | false | Singleton pre-handoff reconciliation gate. One audit per pipeline run. |
| `codebase-mapper` | discovery | Subagent | false | Sequential bootstrap — feeds risk-analyst fan-out. One mapper per Investigate. |
| `risk-analyst` | discovery | Subagent | true | Multi-instance — one dispatch per Cagan Big Risk (value/usability/feasibility/viability). Always 4 instances per Investigate. |
| `spec-writer` / `designer` / `task-builder` / `orchestrator` (sdd) and `discovery-lead` / `discovery-orchestrator` / `discovery-synthesizer` (discovery) | — | Skill | n/a | Skills run in the main session; fan-out is structurally inapplicable. |

**Why `fan_out` is first-class** (not a future optimization): the primary motivation is **fidelity**, not throughput. A Subagent focused on a small slice has higher assertiveness than a Subagent receiving the full Spec and multiple files at once. Multi-instance amplifies the benefit of the Subagent's natively isolated context by reducing the scope inside each context.

**Decomposition:** the orchestrator evaluates the approved Tasks file (`tasks.md`), identifies groups of write-disjoint files, and emits N Work Packets — one per instance. Mechanics in [`pipeline.md`](pipeline.md).

**Reconciliation:** the orchestrator aggregates N Output Packets before advancing to the next Pipeline step. Mechanics in [`pipeline.md`](pipeline.md).

**Defense against over-spawn:** the orchestrator only fans out when there are ≥2 genuinely write-disjoint scopes. It does not decompose for the sake of decomposing — Anthropic Research documents "spawning 50 subagents for a simple query" as a real failure mode of orchestrator-worker setups, and the squad's heuristic explicitly avoids it.
