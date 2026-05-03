# Concept — `Spec`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`skill-vs-subagent.md`](skill-vs-subagent.md), and [`effort.md`](effort.md).

## Definition

A **Spec** is the contract between the human and the squad — a single Markdown file at `.agent-session/<task_id>/spec.md` (gitignored on the consumer project) that answers WHAT must be built and WHY, never HOW. It is produced by the `spec-writer` Skill in Phase 1 and consumed (read-only) by Phases 2–4 (designer, task-builder, orchestrator, all 5 Subagents). Once `status: approved`, it is the source of truth; agents do not deviate from it without escalating.

> *Terms used in this doc:*
> - **EARS** (Easy Approach to Requirements Syntax): a notation invented by Alistair Mavin for unambiguous requirements. Four patterns: `WHEN <trigger> THE SYSTEM SHALL <action>` (event), `WHILE <state> THE SYSTEM SHALL <action>` (state), `IF <unwanted> THEN THE SYSTEM SHALL <mitigation>` (protection), `THE SYSTEM SHALL <continuous behavior>` (ubiquitous). Adopted by Kiro; the emerging standard for Specs consumed by AI agents.
> - **Gherkin** (Given/When/Then): BDD scenario notation. Used in some SDD frameworks for narrative scenarios; not used by ai-squad (EARS subsumes its use case more compactly for our purposes).
> - **Independent Test:** Spec Kit's term — every user story must be shippable and testable in isolation from the others, so the Pipeline can ship a single P1 story without P2/P3 being implemented.
> - **Vagueness amplification:** the documented effect of ambiguous Specs on AI agents — they fill gaps differently than humans intended, and the error compounds across the Pipeline. Tessl: "the cost of ambiguity is measured in thousands of lines of plausible-looking, subtly wrong output."
> - **Traceability matrix:** a mapping `Spec ID → Task → Test → Commit`. ai-squad does not maintain a separate matrix file — IDs in the Spec (`US-XXX`, `AC-XXX`, etc.) are referenced directly by Work Packets and Output Packets, giving forward traceability without a sidecar.

## Why a single file (and what lives next to it)

The Spec is one Markdown file per feature. Not a folder, not multiple files. Justification:

- **Loads as one piece of context** for any consumer (`designer`, `task-builder`, `orchestrator`, any Phase 4 Subagent) — no risk of reading half the contract.
- **Atomic transitions** — a single status change moves one file from `draft` to `approved`.
- **Plan and Tasks are siblings, not children** — Phase 2 produces `.agent-session/<task_id>/plan.md` and Phase 3 produces `tasks.md`. They live in the same directory but each is its own contract for its own Phase. The Spec does not absorb their concerns.

The whole `.agent-session/<task_id>/` directory is gitignored on the consumer project — the Spec, Plan, Tasks and all runtime ephemera are framework-internal contracts, not long-term documentation. Long-term tracking belongs in Jira/ClickUp/GitHub PR descriptions; the orchestrator's handoff is what the human copies into those systems.

## The canonical structure

Every Spec has the same 9 sections in this order. **Sections are never removed; if not applicable, leave the body as `- (none)` or `- n/a`.** Uniformity is what lets the orchestrator and Subagents trust the structure.

1. **Frontmatter** — `id`, `status`, `owner`, `created`, optional `parent_spec`. Nothing else.
2. **Problem** — one paragraph. What is the problem? Who has it? Why now?
3. **Goal** — one sentence. What does success look like?
4. **User Scenarios** — P1/P2/P3 stories. Each with formal user story + Independent Test + Acceptance Criteria in EARS.
5. **Non-functional Requirements** — measurable + verification method per item (latency, security, a11y, etc).
6. **Success Criteria** — outcome metrics measured *post-launch* (distinct from acceptance criteria, which are pre-launch).
7. **Out of Scope** — explicit list of what the Spec deliberately does NOT address. Empty allowed; missing not allowed.
8. **Constraints** — non-negotiable technical or business constraints (stack, external dependencies, deadlines, regulatory).
9. **Assumptions** — things the Spec takes as given about the world. If wrong, the Spec is wrong.
10. **Open Questions** — `[NEEDS CLARIFICATION]` items. **Hard cap: 3.** Must be empty before `status: approved`.
11. **Notes** — optional. Links, prior art, references.

(11 sections counting Frontmatter and Notes; the "spine" is sections 2–10.)

The template lives at [`../../templates/spec.md`](../../templates/spec.md).

## The frontmatter contract

```yaml
---
id: FEAT-XXX                       # canonical ID; referenced by Plan, Tasks, Work Packets, Output Packets
status: draft                      # enum: draft | approved | in-progress | done
owner: <human handle>              # who approves; only this human can move status to approved
created: YYYY-MM-DD                # date only — Session history captures evolution
parent_spec: FEAT-YYY              # optional; declares an explicit dependency on another Spec
---
```

**No `version` field.** The Session is short-lived and removed by `/ship` after handoff; long-term versioning belongs in the consumer's external tracking (Jira/PR history). Adding `version` invites drift.

**No `tags` / `labels` / `priority`** at the Spec level. Priority lives on user stories (P1/P2/P3) where it actually drives execution decisions.

## EARS notation — cheat sheet

The four patterns cover the full space of acceptance criteria the squad will encounter. Pick the pattern that matches the trigger.

| Pattern | Template | Example |
|---------|----------|---------|
| Event | `WHEN <trigger> THE SYSTEM SHALL <action>` | `WHEN a user submits the login form with valid credentials THE SYSTEM SHALL redirect to the dashboard.` |
| State | `WHILE <state> THE SYSTEM SHALL <continuous behavior>` | `WHILE the user is unauthenticated THE SYSTEM SHALL hide the admin menu.` |
| Protection (unwanted) | `IF <unwanted condition> THEN THE SYSTEM SHALL <mitigation>` | `IF the password reset token has expired THEN THE SYSTEM SHALL display 'token expired' and offer to send a new one.` |
| Ubiquitous | `THE SYSTEM SHALL <continuous behavior>` | `THE SYSTEM SHALL log every authentication attempt with timestamp and source IP.` |

**Why EARS over Gherkin or plain checklists:**

- EARS is **machine-pattern-matchable** — the `qa` Subagent can recognize the structure and extract trigger/action without natural-language inference.
- EARS handles **negative criteria** natively (the `IF...THEN...` pattern) — Gherkin and checklists do not.
- EARS forces a single subject (`THE SYSTEM`), removing the "who is the actor" ambiguity that Gherkin's `Given a user does X` introduces.
- EARS is the convention adopted by Kiro and requested in Spec Kit (open issue #1356) — picking it aligns with where the SDD industry is converging in 2025–2026.

## IDs as contract

Every numbered item in a Spec is an addressable ID, referenced by Work Packets, Output Packets, qa logs, and (in the future) post-launch dashboards.

| Prefix | Scope | Example |
|--------|-------|---------|
| `FEAT-` | The Spec itself | `FEAT-042` |
| `US-` | User story | `US-001` |
| `AC-` | Acceptance criterion (under a US) | `AC-003` |
| `NFR-` | Non-functional requirement | `NFR-002` |
| `SC-` | Success criterion (post-launch outcome) | `SC-001` |

**Rules:**
- IDs are **monotonic per Spec** (US-001, US-002, …). Never renumber on edit; deprecated items get marked, not removed, for as long as the Session lives (until `/ship FEAT-XXX`).
- IDs are **immutable after `status: approved`**. Renaming an AC after approval breaks Work Packets that reference it — counts as breaking change.
- Cross-Spec references use the full path: `FEAT-042/US-001` is unambiguous; `US-001` alone is not.

## The approval gate

`status: approved` is a hard gate. The next-Phase Skill (`designer` for Phase 2, then `task-builder`, then `orchestrator`) refuses to start against any Spec that:

- Has `status: draft` or `status: in-progress`
- Has any `[NEEDS CLARIFICATION]` items remaining in Open Questions
- Has fewer than 1 user story
- Has any user story without Acceptance Criteria

These rules are mechanical — the next Skill does not subjectively judge "is this a good Spec." It just checks the gate conditions and refuses with a clear message if any fails.

**Status transitions:**

```
draft → approved        (human commits the change explicitly; only the `owner` can do this)
approved → in-progress  (the orchestrator marks at start of Phase 4)
in-progress → done      (the orchestrator marks at handoff, end of Phase 4)
approved → draft        (any material change to acceptance criteria or scope; reopens for human re-approval)
```

After `done`, the entire `.agent-session/<task_id>/` is removed by `/ship FEAT-XXX` — there is no `archived` state. If the human delays `/ship`, the artifacts remain on disk indefinitely (gitignored, no impact on the consumer's git).

A Spec going from `approved` back to `draft` is a signal — forces a fresh round of human attention before subsequent Phases can resume.

## Lifecycle

```
Phase 1 (Specify)        Phase 2 (Plan)         Phase 3 (Tasks)        Phase 4 (Implementation)        Post-LGTM
─────────────────────    ────────────────       ────────────────       ────────────────────────        ──────────
spec-writer drafts   →   designer reads,    →   task-builder reads,  →  orchestrator reads,         →  /ship
human approves           proposes Plan,         decomposes,             dispatches Subagents,           removes
(status: approved)       human approves         human approves          marks in-progress, then         everything
                         plan.md                tasks.md                done at handoff
```

The Spec is **frozen** from Phase 2 onward. The designer, task-builder, orchestrator, and all Subagents read; they never write to it. If any consumer discovers the Spec is wrong (Plan finds the visual surface is impossible; Dev finds the constraints contradict each other; Logic-Reviewer finds an acceptance criterion is unachievable):

- In Phases 2–3: the Skill surfaces it directly to the human (already in-the-loop) and asks to revise.
- In Phase 4: the Subagent returns `status: blocked` in its Output Packet — the orchestrator escalates via `blocker-specialist` and ultimately back to the human, who edits the Spec (status reverts to `draft`).

## What goes elsewhere

A Spec does NOT contain:

- **Architecture or implementation decisions** — those are the Plan's job (Phase 2 output at `.agent-session/<task_id>/plan.md`), produced by the `designer` Skill.
- **Task breakdown or file scope** — that is the Tasks file's job (Phase 3 output at `.agent-session/<task_id>/tasks.md`), produced by the `task-builder` Skill. The `Files:` and `AC covered:` annotations on each task become `scope_files` and `ac_scope` in the orchestrator's Work Packets.
- **File paths or module names from the codebase** — the Spec is implementation-agnostic. Mention "User Service" as an entity if needed; do not mention `src/auth/login.ts`.
- **Test code** — acceptance criteria are *what* must hold. Test code is *how* to verify, owned by the `dev` (writes tests) and `qa` (runs them) Subagents.
- **Status updates from Phase 4** — those go to the Session state file (`.agent-session/<task_id>/session.yml`), not to the Spec.

## Anti-patterns

1. **Vagueness amplification** — vague language like "fast", "user-friendly", "modern". Replace with measurable criteria. If you can't measure it, it isn't a criterion.
2. **Spec inflation** — Specs longer than ~4 pages signal the feature should be broken into multiple Specs with a `parent_spec` link. ThoughtWorks Tech Radar 2025 placed SDD in "Assess" specifically because of this failure mode.
3. **Prose narrative** — dense paragraphs are read poorly by agents (and by humans). Use bullets, numbered lists, structured sections. Prose belongs only in Problem, Goal, and Notes.
4. **Mid-Spec workflow switching** — if the Spec changes substantially after `approved`, revert to `draft` and re-run Phase 1's spec-writer session. Do not patch in place.
5. **More than 3 `[NEEDS CLARIFICATION]` items at approval time** — hard cap (Spec Kit rule). If 4+ open questions remain, the feature is not understood enough; either decompose or send back to discovery.
6. **HOW leaking into the Spec** — implementation hints ("we should use X library", "this should be a microservice") are HOW. They belong in design output, not in the Spec.
7. **Removing sections** — even when empty. Uniform structure is what lets the orchestrator and Subagents parse Specs reliably without per-Spec adaptation.
8. **Reusing IDs across Specs** without the full `FEAT-XXX/` prefix. `AC-001` is ambiguous globally; `FEAT-042/AC-001` is not.

## Why this format and not the alternatives

The structure combines elements from three sources, each chosen because consensus or pattern of success was documented in 2025–2026 SDD literature:

- **Spec Kit's 4-section spine** (Scenarios + Requirements + Success Criteria + Assumptions) — proven canonical structure across multiple high-profile open SDD projects.
- **Kiro's EARS notation** — the most machine-checkable format for acceptance criteria; the SDD industry trajectory points here (Spec Kit issue #1356, Kiro adoption, multiple 2026 InfoQ/blog references).
- **Out of Scope as mandatory** — not standard but consistently recommended in best-practice writeups (Augment Code, Arcturus Labs). ai-squad treats this as differentiating value rather than industry minimum.
- **Single file + IDs as forward traceability** — sidesteps the unresolved bidirectional-traceability debate (Tessl-style code annotations vs. external matrix). Forward references via IDs in Work Packets work today without infrastructure.
