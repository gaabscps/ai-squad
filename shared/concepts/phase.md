# Concept — `Phase`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`skill-vs-subagent.md`](skill-vs-subagent.md), [`spec.md`](spec.md), [`session.md`](session.md).

## Definition

A **Phase** is a discrete unit of work in a squad's flow, conducted by exactly one Skill, ending with an explicit human-approved gate (or, in fully autonomous Phases, with a one-shot handoff to the human). Each Phase produces one persistent runtime artifact under `.agent-session/<task_id>/`.

**Phases are squad-scoped — each squad declares its own Phase enum:**

| Squad | Phases | Phase that is fully autonomous (human absent) |
|-------|--------|----------------------------------------------|
| `sdd` | 4: **Specify → Plan → Tasks → Implementation** | Phase 4 (Implementation) |
| `discovery` | 3: **Frame → Investigate → Decide** | None — all 3 have human-in-the-loop gates |

The squad-specific Phase enum lives in `session.yml.current_phase` and is interpreted in the context of `session.yml.squad`. See [`session.md`](session.md).

**Which Phases run is selected by the human at Session entry**, via an interactive checkbox (default: all of the squad's Phases). See `planned_phases` in [`session.md`](session.md). Skipping any Phase ends the Session in a `paused` terminal-but-resumable state after the last planned Phase. This enables "plan now, execute later" workflows in the SDD squad and "Frame-only / no Decide" workflows in the Discovery squad.

> *Terms used in this doc:*
> - **phase boundary:** the point where the framework moves from "human in-the-loop with the current Skill" to the next Phase. Always a deliberate human action (no auto-transition).
> - **transition gate:** the explicit pair of actions required to move from one Phase to the next — (1) human marks the current Phase's artifact as `status: approved`, (2) human invokes the next Phase's Skill via slash command.
> - **guided next step:** the convention that every Skill, on completion of its Phase, instructs the human exactly what to do next. The framework never assumes the human memorizes the flow.
> - **planned_phases:** the array of Phases the human selected at Session entry. Each Skill verifies its own Phase is in the array before proceeding; otherwise refuses.
> - **paused state:** Session is in a terminal-but-resumable state when the last planned Phase has completed but later Phases were not planned. Human can resume by invoking the next Phase's Skill with `--resume`.

## SDD squad — 4 Phases

| # | Phase | Conducting Skill | Persistent artifact | Human role | Transition gate |
|---|-------|------------------|---------------------|------------|-----------------|
| 1 | **Specify** | `spec-writer` | `.agent-session/FEAT-NNN/spec.md` | In-the-loop (refines Spec interactively) | `status: approved` on `spec.md` + next Skill invocation |
| 2 | **Plan** | `designer` | `.agent-session/FEAT-NNN/plan.md` | In-the-loop (validates design decisions) | `status: approved` on `plan.md` + next Skill invocation |
| 3 | **Tasks** | `task-builder` | `.agent-session/FEAT-NNN/tasks.md` | In-the-loop (reviews task decomposition) | `status: approved` on `tasks.md` + next Skill invocation |
| 4 | **Implementation** | `orchestrator` (dispatches 6 Subagents) | Repo files + Output Packets + handoff | **Absent** until handoff | (orchestrator emits handoff after audit-agent reconciliation passes; pipeline ends) |
| post | (cleanup) | `/ship FEAT-XXX` | — | Confirms acceptance, runs cleanup | Removes `.agent-session/<task_id>/` |

## Discovery squad — 3 Phases

| # | Phase | Conducting Skill | Persistent artifact | Human role | Transition gate |
|---|-------|------------------|---------------------|------------|-----------------|
| 1 | **Frame** | `discovery-lead` | `.agent-session/DISC-NNN/memo.md` (Q1-Q9 of Cagan's Opportunity Assessment) | In-the-loop (refines Frame interactively) | `status: approved` on `memo.md` + next Skill invocation |
| 2 | **Investigate** | `discovery-orchestrator` (dispatches `codebase-mapper` sequentially → 4× `risk-analyst` in parallel, one per Cagan Big Risk) | `## Investigate Findings` block in `memo.md` | **Conditional** — auto-advance if all risks validated/refuted/N/A and severities low/medium; gate if any inconclusive or any high-severity | Auto-advance OR explicit human approval per gate policy |
| 3 | **Decide** | `discovery-synthesizer` | `## Decide` block in `memo.md` (Options table + Recommendation + Decision + Open Questions for Delivery) | In-the-loop as RAPID Decider (synthesizer is Recommender) | Human chooses option via `AskUserQuestion`; `phase_completed: decide` |
| post | (cleanup) | `/ship DISC-XXX` | — | Confirms acceptance, runs cleanup | Removes `.agent-session/<task_id>/` |

The Discovery squad's output (memo) is **handed off purely** to the SDD squad — not auto-fed (per industry-validated Path A: Discovery → Delivery batch handoff requires human re-validation of Open Questions for Delivery before scoping the Spec).

## Why these Phase counts (per squad)

**SDD = 4 Phases.** The number comes from the SDD industry consensus (GitHub Spec Kit, Kiro, BMAD all converge on Specify → Plan → Tasks → Implementation). ai-squad adopts this division for two reasons:

1. **Well-defined tasks serve humans and AI alike.** Both perform better when the work is sliced into discrete units before execution starts. A Spec answers WHAT/WHY; a Plan answers structural HOW; Tasks answer the work breakdown; Implementation does the work. Conflating these into fewer Phases creates ambiguity at exactly the point where ambiguity costs most.

2. **Granular gates give the human meaningful control.** The human can reject/refine at three checkpoints before the autonomous Phase 4 starts. The cost of getting Phase 4 wrong (modified code, wrong direction) is high; three opportunities to course-correct upstream is cheap insurance.

**Discovery = 3 Phases.** The number comes from Marty Cagan's discovery framing (SVPG): Frame the opportunity → Investigate the Four Big Risks → Decide. Adopting this division for two reasons:

1. **Each Phase produces an industry-canonical artifact.** Frame = Cagan Opportunity Assessment Q1-Q9 (Inspired Ch. 35). Investigate = synthesis of Cagan's Four Big Risks (value/usability/feasibility/viability), one analyst per risk in parallel. Decide = Q10 of the Opportunity Assessment + RAPID Recommender pattern (Bain).

2. **The squad is time-decoupled by design.** Discovery may run months before Delivery (the SDD squad). Path A — deliberate batch handoff — requires the Decide Phase to surface freshness signals (Open Questions for Delivery) so the SDD squad knows what may have decayed.

**No "Pre-Phase 0" inside any squad.** Cross-squad chaining (Discovery's output feeding into SDD's input) is handled at the **squad boundary**, not as a Phase. The human reads the Discovery memo and recomposes the SDD pitch — explicit handoff, not auto-feed.

**No "Post-Phase N" (Deploy / Review)** inside any squad. The host project's CI/CD owns deployment; the handoff is the squad's exit.

## The boundary criterion

The defining boundary of the framework is **between Phase 3 and Phase 4** — it is the only place where "human in-the-loop" flips to "human absent". Phases 1, 2, 3 share the property of being interactive (human + Skill iterating); Phase 4 is autonomous (orchestrator + Subagents).

This is the same `human-in-the-loop` criterion that defines [Skill vs Subagent](skill-vs-subagent.md) — applied at a different layer:

- **Materialization layer** (Skill vs Subagent): "*This Role* needs the human in-the-loop?"
- **Flow layer** (which Phase): "*This stage of work* needs the human in-the-loop?"

It is not coincidence that the 4 Skills (`spec-writer`, `designer`, `task-builder`, `orchestrator`) span the 4 Phases (one per Phase) and that the 6 Subagents all live in Phase 4 — they are consequences of the same principle.

## Roles per Phase, per squad

**SDD squad** (4 Skills + 6 Subagents = 10 Roles):

| Role | Materialization | Phase | Why this materialization |
|------|-----------------|-------|--------------------------|
| `spec-writer` | Skill | 1 | Human in-the-loop |
| `designer` | Skill | 2 | Human in-the-loop |
| `task-builder` | Skill | 3 | Human in-the-loop |
| `orchestrator` | Skill | 4 | Dispatches Subagents |
| `dev` | Subagent | 4 | Neither in-the-loop nor dispatcher |
| `code-reviewer` | Subagent | 4 | Neither |
| `logic-reviewer` | Subagent | 4 | Neither |
| `qa` | Subagent | 4 | Neither |
| `blocker-specialist` | Subagent | 4 (escalation) | Neither — reused cross-squad on `status: blocked` |
| `audit-agent` | Subagent | 4 (pre-handoff gate) | Neither — singleton reconciliation of dispatch manifest vs. actual outputs |

**Discovery squad** (3 Skills + 2 Subagents = 5 Roles):

| Role | Materialization | Phase | Why this materialization |
|------|-----------------|-------|--------------------------|
| `discovery-lead` | Skill | 1 (Frame) | Human in-the-loop |
| `discovery-orchestrator` | Skill | 2 (Investigate) | Dispatches Subagents (sequential mapper → parallel risk-analyst fan-out) |
| `codebase-mapper` | Subagent | 2 | Neither in-the-loop nor dispatcher |
| `risk-analyst` | Subagent | 2 | Neither — multi-instance fan-out (1 per Cagan Big Risk) |
| `discovery-synthesizer` | Skill | 3 (Decide) | Human in-the-loop as RAPID Decider |

Total across both squads: **15 canonical Roles** (7 Skills + 8 Subagents). `blocker-specialist` is shared cross-squad (defined under SDD, reusable by Discovery's `discovery-orchestrator`).

## Artifacts per Phase — runtime, gitignored

All artifacts live in `.agent-session/<task_id>/` on the consumer project. The framework expects this directory to be **gitignored** by the consumer project.

```
<consumer-project>/
  .agent-session/                        ← gitignored
    FEAT-042/
      spec.md                            ← Phase 1
      plan.md                            ← Phase 2 (absent if not planned)
      tasks.md                           ← Phase 3 (absent if not planned)
      session.yml                        ← state (concept #11)
      inputs/<dispatch_id>.json          ← Work Packets (Phase 4)
      outputs/<dispatch_id>.json         ← Output Packets (Phase 4)
      decisions/<topic>.md               ← decision memos from blocker-specialist
      logs/...
```

After the human accepts the handoff and runs `/ship FEAT-042`, the entire `.agent-session/FEAT-042/` directory is removed. The "permanent record" of the feature lives in the host project's Jira/ClickUp/PR description — wherever the human chose to capture the handoff content.

## Selecting which Phases will run — `planned_phases` at entry

The `spec-writer` Skill, **before** starting the Spec conversation, asks the human via Claude Code's `AskUserQuestion` UI which Phases will run for this Session:

```
Which Phases will this Session run?
[x] Specify (always; you are here)
[x] Plan
[x] Tasks
[x] Implementation
```

Default: all 4 checked. The human can uncheck any non-Specify Phase to skip it. The selection is saved as `planned_phases` in `session.yml`. Subsequent Skills verify their own Phase is in the list before proceeding.

**Use cases this enables:**

- **Full run** (all 4 checked): default flow — Spec → Plan → Tasks → Implementation → handoff.
- **Plan-only mode** (Specify + Plan + Tasks, no Implementation): "I want to plan this feature now, execute next week" — Session ends in `paused` after Tasks; human runs `/orchestrator FEAT-XXX --resume` later.
- **Spec-only mode** (only Specify): humans planning to use the Spec for ticketing without ai-squad implementation. Session ends in `paused` after Specify.
- **Resume after pause**: invoking the next planned Phase's Skill resumes from the paused state.

**Flag override** for power users: `/spec-writer FEAT-042 --plan="specify,plan,tasks"` skips the interactive prompt.

**Modifying mid-Session:** if plans change, the human edits `planned_phases` in `session.yml` directly. The framework respects the new selection on the next Skill invocation. See [`session.md`](session.md) for full details.

## Transition gates — approval auto-advances

Each gate is **one human act**: approve the Phase's artifact. The Skill then **auto-invokes the next planned Phase** — the approval IS the gate; a second manual invocation is unnecessary friction.

When the next Phase is NOT in `planned_phases`, the Skill signals `paused` instead of auto-advancing.

| Transition | If next Phase is planned | If next Phase is NOT planned |
|------------|---------------------------|-------------------------------|
| Phase 1 → 2 | `"Spec approved. Advancing to Phase 2 (Plan)..."` → auto-invoke `/designer` | Skip to next planned Phase, or pause if none |
| Phase 2 → 3 | `"Plan approved. Advancing to Phase 3 (Tasks)..."` → auto-invoke `/task-builder` | Skip to next planned Phase, or pause if none |
| Phase 3 → 4 | `"Tasks approved. Advancing to Phase 4 (Implementation)..."` → auto-invoke `/orchestrator` | `"Session paused. To execute later: /orchestrator FEAT-XXX --resume."` |
| Phase 4 → end | (orchestrator internal) | `"Implementation done. Review changes, commit when ready. /ship FEAT-XXX to clean up."` |
| Post-LGTM | `/ship FEAT-XXX` | `"Session cleaned. To start a new feature: /spec-writer."` |

Each Skill's body contains the exact auto-advance logic — see the Skill's own `skill.md`.

## State machine

```
                ┌───────────────┐
                │   (start)     │
                └───────┬───────┘
                        │ /spec-writer FEAT-XXX
                        │   ↓ AskUserQuestion: planned_phases
                        ▼
   ┌────────────────────────────────────┐
   │ Phase 1: specify                    │
   │ artifact: spec.md (draft → approved)│
   └────────────────────┬───────────────┘
                        │ status:approved + (next planned Skill OR pause)
                        ▼
   ┌────────────────────────────────────┐
   │ Phase 2: plan        (if planned)   │
   │ artifact: plan.md                   │
   └────────────────────┬───────────────┘
                        │ status:approved + (next planned OR pause)
                        ▼
   ┌────────────────────────────────────┐
   │ Phase 3: tasks       (if planned)   │
   │ artifact: tasks.md                  │
   └────────────────────┬───────────────┘
                        │ status:approved + (next planned OR pause)
                        ▼
   ┌────────────────────────────────────┐
   │ Phase 4: implementation (if planned)│
   │ orchestrator dispatches Subagents   │
   └────────────────────┬───────────────┘
                        │ orchestrator emits handoff
                        ▼
                 (awaiting LGTM)
                        │ /ship FEAT-XXX
                        ▼
                  ┌─────────────┐
                  │ done + clean │
                  └─────────────┘

Alternative terminal: paused
   At any Phase boundary where the next Phase is NOT in planned_phases,
   the Session enters `paused` state and waits for human to either
   /orchestrator FEAT-XXX --resume (next Phase) or /ship FEAT-XXX (cleanup).

Alternative terminal: escalated
   Phase 4 can end with status: escalate (any task entered pending_human).
   Final handoff includes mixed status; human resumes/restarts via concept #10.
```

## Phase as Session state

The current Phase is a field in the Session state file (`.agent-session/<task_id>/session.yml`):

```yaml
current_phase: implementation   # specify | plan | tasks | implementation | paused | done | escalated
planned_phases: [specify, plan, tasks, implementation]
phase_history:
  - phase: specify
    started_at: ...
    completed_at: ...
    skipped: false
  # ...
```

Detailed schema in [`session.md`](session.md).

## Cleanup with `/ship`

`/ship FEAT-XXX` is a small auxiliary Skill (not one of the 4 Phase-conducting Skills) that:

1. Verifies the Session is in a terminal state (`done`, `paused`, or `escalated`).
2. Confirms with the human (`"This will permanently remove .agent-session/FEAT-XXX/. Confirm?"`).
3. Removes the directory.
4. Suggests next: `"Session FEAT-XXX cleaned. To start a new feature: /spec-writer."`

Cleanup is not automatic. The human controls when to discard the runtime trace.

## Anti-patterns

1. **Inventing "Phase 1.5" for Spec refinement.** Refinement is a *loop within Phase 1* (human + spec-writer iterating until the Spec is approved). It is not a new Phase.
2. **Inventing "Pre-Phase 1" Discovery inside the SDD squad.** Discovery is a *separate squad* (`discovery`) with its own 3 Phases — not a Phase 0 of SDD. Cross-squad handoff is explicit (human reads Discovery memo, recomposes SDD pitch), not auto-feed. **"Post-Phase N" (Deploy)** is the host project's CI/CD, not a Phase of any squad.
3. **Calling Phase 4 sub-stages "phases".** Inside Phase 4 the orchestrator runs a Pipeline (concept #9) with stages like `dev`, `review`, `qa`. Those are *Pipeline stages*, not Phases.
4. **Auto-transitioning between Phases WITHOUT approval.** Every transition needs explicit human approval via `AskUserQuestion`. After approval, auto-advance is expected — do not require a second manual invocation.
5. **Skipping Phases silently.** When `planned_phases` excludes a Phase, the next Skill explicitly says so in its guided next-step message. The decision to skip must be visible.
6. **Modifying an `approved` artifact without reverting status to `draft`.** Subsequent Phases consume the obsolete version.
7. **Not auto-advancing after approval.** Each Skill must auto-invoke the next planned Phase after approval OR signal `paused` if no further Phases are planned.
8. **Human interfering in Phase 4.** The autonomous Phase assumes "human absent". Editing code that `dev` is modifying mid-Pipeline causes write conflicts.
9. **Running a Skill for a Phase not in `planned_phases`.** Each Skill verifies on entry; bypassing this defeats the planning UI.
10. **Hard-coding `planned_phases` defaults to less than all 4.** The default is full discipline; humans opt-out per-Session, not at the framework level.

## Why this design and not alternatives

- **4 Phases over 2:** the original ai-squad design had 2 Phases (interactive vs autonomous). Three Phases of work were collapsed into "Implementation". The 4-Phase model came from explicit user feedback that *human-validated tasks* are useful for both AI and humans, and that the industry has converged on this division.
- **Runtime artifacts gitignored over versioned:** versioning Spec/Plan/Tasks in the consumer's git would duplicate information the consumer already tracks in Jira/ClickUp/GitHub PR descriptions.
- **Approval-triggered auto-advance over two-act gates:** originally the framework required two manual acts (approve + invoke). In practice this was unnecessary friction — the approval IS the decision to proceed. Auto-advance after approval; pause only when the next Phase is not in `planned_phases`.
- **Planned_phases at entry over per-Phase opt-out:** asking once upfront is less friction; one decision, the human knows the whole plan. Asking at every boundary becomes nagging. Editing the array mid-Session covers cases where plans change.
- **Interactive checkbox + flag override:** UI for first-time clarity, flags for repeat / scripted use.
- **Paused as terminal-but-resumable:** matches real workflows ("plan now, execute later"). Without it, half-runs would have no clean state.
- **`/ship` as separate cleanup over auto-cleanup:** auto-cleanup risks deleting information the human still needs to extract. Manual `/ship` keeps the human in control.
