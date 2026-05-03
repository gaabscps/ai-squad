# ai-squad

**An opinionated Spec-Driven Development team for [Claude Code](https://www.claude.com/claude-code).**

ai-squad gives you the full SDD pipeline as a set of plug-and-play Claude Code Skills and Subagents: human-in-the-loop spec/plan/tasks drafting, then autonomous implementation with parallel reviewers and QA, with industry-validated loop caps and a clear escalation path. Bring your project — the squad brings the flow.

> **Status:** v0.1 — design-complete, contract-validated end-to-end via [`scripts/smoke-walkthrough.sh`](scripts/smoke-walkthrough.sh), not yet battle-tested in real repos at scale. Feedback welcome via GitHub issues.

---

## Why this exists

Spec-Driven Development gives AI agents the structure they desperately need — clear acceptance criteria, traceable design decisions, granular tasks. But Claude Code ships with primitives (Skills, Subagents, the `Task` tool, `AskUserQuestion`), not an opinionated SDD workflow. You can build one from scratch every project, or you can install ai-squad once and get:

- **9 canonical Roles** with research-backed boundaries — no overlap, no role drift.
- **A 4-Phase pipeline** (Specify → Plan → Tasks → Implementation) with explicit approval gates between phases.
- **Per-task async escalation** with caps borrowed from [Reflexion](https://arxiv.org/abs/2303.11366) — one task escalating doesn't block parallels.
- **Runtime artifacts gitignored** by design — no `.spec/` folder bloating consumer repos. After handoff, `/ship` deletes everything.
- **A worked example + smoke script** so you can verify the contracts hold before betting a real feature on them.

If you've used [GitHub Spec Kit](https://github.com/github/spec-kit) or [AWS Kiro](https://kiro.dev/), the shape will feel familiar — ai-squad is a Claude Code-native synthesis of those plus a few patterns from the broader multi-agent literature ([§ Inspirations](#inspirations) lists everything).

---

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

## Team — 9 canonical Roles

| Role | Phase | Materialization | Responsibility |
|------|-------|-----------------|----------------|
| **spec-writer** | 1 — Specify | Skill | Feature request → approved Spec (interactive). |
| **designer** | 2 — Plan | Skill | Spec → approved Plan: architecture, data model, UX surface, risks (interactive). |
| **task-builder** | 3 — Tasks | Skill | Spec + Plan → approved Tasks: granular work units with file scope and AC coverage (interactive). |
| **orchestrator** | 4 — Implementation | Skill | Reads Spec/Plan/Tasks; dispatches Subagents; enforces caps; emits handoff. |
| **dev** | 4 | Subagent | Implements one task; TDD-leaning; one atomic Conventional Commit per task. |
| **code-reviewer** | 4 | Subagent | Reviews patterns/conventions/architectural fit (Google's Design+Style+Naming buckets). |
| **logic-reviewer** | 4 | Subagent | Reviews behavioral gaps vs Spec: edge cases, missing flows, race conditions, invariants. |
| **qa** | 4 | Subagent | Runs the feature against the Spec's acceptance criteria; reports per-AC pass/fail. |
| **blocker-specialist** | 4 (escalation) | Subagent | Resolves blockers via decision memo, or escalates to human via structured `pending_human` status. |

4 Skills (one per Phase) + 5 Subagents (all Phase 4) = 9 canonical Roles.

---

## Quick start

```bash
git clone https://github.com/<your-handle>/ai-squad.git
cd ai-squad
./tools/deploy.sh
```

The deploy script copies Skills to `~/.claude/skills/` and Subagents to `~/.claude/agents/` — they become available in every Claude Code session, in any project.

Then, in any consumer project (with `.agent-session/` added to `.gitignore`):

```
/spec-writer "Your feature pitch in one paragraph"
```

The Skill creates a Session, asks via interactive checkbox which Phases to run (default: all 4), and starts drafting your Spec. Each Skill tells you the next command on completion.

## Workflow examples

The first Skill (`/spec-writer`) asks via [`AskUserQuestion`](https://docs.claude.com/en/docs/agents-and-tools/tool-use/computer-use-tool) which Phases will run for this Session (default: all 4 checked). The selection is saved to the Session and respected by every subsequent Skill — including skipping Phase 4 itself.

- **Full run** (default): all 4 Phases checked → Spec → Plan → Tasks → Implementation → handoff.
- **Plan now, execute later**: check Specify + Plan + Tasks but uncheck Implementation. Session ends in `paused` after Tasks. Resume any time with `/orchestrator FEAT-XXX --resume`.
- **Spec only**: check only Specify (e.g. for ticketing without ai-squad implementation). Session enters `paused` after Specify; clean up with `/ship` when done.

**Power-user flag override** (skips the interactive prompt): `/spec-writer FEAT-042 --plan="specify,plan,tasks"`.

---

## Worked example

A complete walk-through of `FEAT-001 — Health check endpoint` lives at [`examples/FEAT-001-fake/`](examples/FEAT-001-fake/) — every artifact each Phase produces (Spec, Plan, Tasks, Session), plus a sample Phase 4 dispatch (Work Packet → Output Packet) and the final handoff message.

Validate the contracts hold by running:

```bash
./scripts/smoke-walkthrough.sh
```

The script asserts: each Phase's output file exists and parses, the Plan covers all Spec ACs, every AC is mapped to ≥1 task, Output Packets validate against the canonical schema (via `ajv-cli` if `npx` is available), and cross-references resolve. **24 checks, all PASS** on the shipped example.

## Repo layout

```
skills/                       ← Claude Code Skills (run in main session, slash-invoked)
  spec-writer/skill.md
  designer/skill.md
  task-builder/skill.md
  orchestrator/skill.md
agents/                       ← Claude Code Subagents (isolated context, dispatched by orchestrator)
  dev.md
  code-reviewer.md
  logic-reviewer.md
  qa.md
  blocker-specialist.md
templates/                    ← Spec/Plan/Tasks (Markdown), Work/Output Packets (JSON), Session (YAML)
  spec.md
  plan.md
  tasks.md
  work-packet.json
  output-packet.schema.json   ← canonical JSON Schema (draft-07); both producer and orchestrator validate
  output-packet.example.json  ← worked example referenced from the schema
  session.yml
docs/                         ← Glossary + 11 concept files (start here for the deep-dive)
  glossary.md
  concepts/                   ← role, skill-vs-subagent, effort, spec, evidence, output-packet,
                                work-packet, phase, pipeline, escalation, session
examples/                     ← Worked artifact set + cross-Phase contract validation
  FEAT-001-fake/
scripts/                      ← Smoke walkthrough; deployment helpers
  smoke-walkthrough.sh
tools/
  deploy.sh                   ← Installs to ~/.claude/skills and ~/.claude/agents
```

---

## Recommended runtime model per Phase

Skills inherit the model from the human's main session. Set with `/model` before invoking.

- **Phase 1 (`/spec-writer`):** `/model opus` recommended — Spec drafting benefits from Opus's reasoning.
- **Phase 2 (`/designer`):** `/model opus` recommended — Plan decisions are reasoning-heavy.
- **Phase 3 (`/task-builder`):** `/model sonnet` is sufficient — task decomposition is more procedural.
- **Phase 4 (`/orchestrator`):** `/model sonnet` for sequential dispatch; `/model opus` if the orchestrator needs to decompose for multi-instance fan-out.

Subagent models are fixed in the Role definitions and follow the calibration in [`docs/concepts/effort.md`](docs/concepts/effort.md) — Sonnet for most Roles; Opus for `logic-reviewer` (behavioral reasoning) and `blocker-specialist` (high-stakes arbitration).

## Permissions — Phase 4 runs in bypass mode

All 5 Phase 4 Subagents declare `permissionMode: bypassPermissions` in their frontmatter. Phase 4 is autonomous by design — interrupting for permission prompts on every `Edit`/`Write`/`Bash` call inside `dev`/`qa`/etc. defeats the orchestrator's whole purpose.

The blast radius is bounded by **defense-in-depth**, not by Claude Code's permission prompt:

- Per-Subagent `tools:` allowlist (e.g., reviewers only get `Read, Grep` — no write tools at all).
- Per-task `scope_files` Hard rule (`dev` may only edit files declared in the task's `Files:`).
- Per-Role authority boundary (`blocker-specialist` may not edit Spec/Plan/Tasks; `qa` may not write to source tree).

**Safety expectation for the consumer project:**

- `.agent-session/` MUST be in `.gitignore` (spec-writer refuses to start otherwise).
- Run ai-squad in a project where you trust the work to be done autonomously — e.g., a feature branch you'd review before merging.
- Do NOT run Phase 4 in a directory mixed with secrets, production credentials, or other repos. Subagents see what `Read` can reach.

If you want stricter prompting, remove `permissionMode: bypassPermissions` from any Subagent you want gated — Phase 4 will then prompt the human on each tool use inside that Subagent.

## Persistence model — runtime only

ai-squad treats all Phase artifacts (Spec / Plan / Tasks / Work Packets / Output Packets / logs) as **runtime contracts**, not long-term documentation. They live under `.agent-session/<task_id>/` in the consumer project, which **must be gitignored**.

After the human accepts the handoff, `/ship FEAT-XXX` removes the directory entirely. Long-term tracking (Jira, Linear, ClickUp, GitHub PR descriptions) is the consumer project's responsibility — the orchestrator's handoff message is formatted (Conventional Commits + 4 fixed sections) to be copied directly into those systems.

This avoids duplicating information that already lives in proper tracking tools, and keeps the consumer's repo clean of framework-specific artifacts.

## Project context

The squad is project-agnostic. Each consumer project injects its own context via the Work Packet's `project_context` field (stack info, path to a standards reference like `CLAUDE.md`). The Roles never reference a specific project, language, or framework — that information arrives at dispatch time.

---

## Architecture deep-dive

For the conceptual foundations and the rationale behind every design decision:

- [`docs/glossary.md`](docs/glossary.md) — canonical vocabulary used across docs and Role files. Read this first.
- [`docs/concepts/`](docs/concepts/) — 11 concept files, one per canonical concept:
  - [`role.md`](docs/concepts/role.md) — the 9-Role taxonomy and why it's closed.
  - [`skill-vs-subagent.md`](docs/concepts/skill-vs-subagent.md) — when to use which Claude Code primitive.
  - [`effort.md`](docs/concepts/effort.md) — the 5-level effort calibration per Role.
  - [`spec.md`](docs/concepts/spec.md), [`work-packet.md`](docs/concepts/work-packet.md), [`output-packet.md`](docs/concepts/output-packet.md), [`evidence.md`](docs/concepts/evidence.md) — the artifact contracts.
  - [`phase.md`](docs/concepts/phase.md), [`pipeline.md`](docs/concepts/pipeline.md), [`escalation.md`](docs/concepts/escalation.md), [`session.md`](docs/concepts/session.md) — the workflow and runtime state.

The git history is also intentionally readable — each commit corresponds to a build phase with a research-backed decision trail.

---

## Inspirations

ai-squad is a synthesis, not an invention. The following sources shaped specific decisions (cited inline in commits and concept docs):

- **[GitHub Spec Kit](https://github.com/github/spec-kit)** — the `/specify`, `/clarify`, `/plan`, `/tasks` shape; the `[P]` parallelization marker semantics (file-disjoint AND no incomplete-predecessor); per-User-Story phase decomposition.
- **[AWS Kiro](https://kiro.dev/)** — explicit per-Phase approval gate ("MUST not proceed without explicit affirmative"); per-task forward-traceability to acceptance criteria.
- **[Aider](https://aider.chat/)** — one atomic Conventional Commit per task as the canonical `dev` commit cadence.
- **[Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)** + **[Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)** — orchestrator-workers pattern; 3-5 fan-out as the empirical concurrency sweet spot.
- **[Reflexion (Shinn et al., NeurIPS 2023)](https://arxiv.org/abs/2303.11366)** — retry caps and verbal feedback; ai-squad uses 3/2/2 (review/qa/blocker).
- **[Nygard ADR](https://github.com/joelparkerhenderson/architecture-decision-record)** — 5-field memo schema (Title/Status/Context/Decision/Consequences) for `blocker-specialist` decision memos.
- **[Google Engineering Practices: code review](https://google.github.io/eng-practices/review/reviewer/looking-for.html)** — the dimension split between `code-reviewer` (Design+Style+Naming+Comments+pattern-fit) and `logic-reviewer` (Functionality+edge cases+concurrency+invariants).
- **[STRIDE](https://en.wikipedia.org/wiki/STRIDE_(security))** + **[ATAM](https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/)** — fixed risk-category checklist (Security, Performance, Migration, Backwards compatibility, Regulatory) in the Plan template.
- **[INVEST](https://en.wikipedia.org/wiki/INVEST_(mnemonic))** + **[SPIDR (Mike Cohn)](https://www.mountaingoatsoftware.com/blog/five-simple-but-powerful-ways-to-split-user-stories)** — task-sizing heuristics: smallest independently testable slice, ~1 commit-worth.
- **[Buck2](https://buck2.build/)** — single-coordinator pattern for the `session.yml` sole-writer invariant in Phase 4.

## Contributing

Issues and PRs welcome. Before opening a PR:

1. Run `./scripts/smoke-walkthrough.sh` and confirm 24/24 checks pass.
2. If you change a Role body, run `./tools/deploy.sh` and verify the length budget warnings (Skill ≤ 300 lines, Subagent ≤ 150 lines).
3. If you change an artifact contract, update the corresponding concept doc in `docs/concepts/` to keep the schema and the prose aligned.

## License

[MIT](LICENSE) — © 2026 Gabriel Andrade.
