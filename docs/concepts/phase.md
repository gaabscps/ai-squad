# Concept — `Phase`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`skill-vs-subagent.md`](skill-vs-subagent.md), [`spec.md`](spec.md), [`session.md`](session.md).

## Definition

ai-squad has **4 Phases**: **Specify → Plan → Tasks → Implementation**. Each Phase has one Skill that conducts it (4 Skills total) and produces one persistent runtime artifact under `.agent-session/<task_id>/`. The first 3 Phases are **AI-driven with the human in-the-loop** (each ends with an explicit human-approved gate). The 4th (Implementation) is **fully autonomous** — the orchestrator dispatches Subagents, the human is absent until handoff.

**Which Phases run is selected by the human at Session entry**, via an interactive checkbox (default: all 4). See `planned_phases` in [`session.md`](session.md). Skipping any Phase (including Implementation, for "plan now, execute later" workflows) ends the Session in a `paused` terminal-but-resumable state after the last planned Phase.

> *Terms used in this doc:*
> - **phase boundary:** the point where the framework moves from "human in-the-loop with the current Skill" to the next Phase. Always a deliberate human action (no auto-transition).
> - **transition gate:** the explicit pair of actions required to move from one Phase to the next — (1) human marks the current Phase's artifact as `status: approved`, (2) human invokes the next Phase's Skill via slash command.
> - **guided next step:** the convention that every Skill, on completion of its Phase, instructs the human exactly what to do next. The framework never assumes the human memorizes the flow.
> - **planned_phases:** the array of Phases the human selected at Session entry. Each Skill verifies its own Phase is in the array before proceeding; otherwise refuses.
> - **paused state:** Session is in a terminal-but-resumable state when the last planned Phase has completed but later Phases were not planned. Human can resume by invoking the next Phase's Skill with `--resume`.

## The 4 Phases

| # | Phase | Conducting Skill | Persistent artifact | Human role | Transition gate |
|---|-------|------------------|---------------------|------------|-----------------|
| 1 | **Specify** | `spec-writer` | `.agent-session/<task_id>/spec.md` | In-the-loop (refines Spec interactively) | `status: approved` on `spec.md` + next Skill invocation |
| 2 | **Plan** | `designer` | `.agent-session/<task_id>/plan.md` | In-the-loop (validates design decisions) | `status: approved` on `plan.md` + next Skill invocation |
| 3 | **Tasks** | `task-builder` | `.agent-session/<task_id>/tasks.md` | In-the-loop (reviews task decomposition) | `status: approved` on `tasks.md` + next Skill invocation |
| 4 | **Implementation** | `orchestrator` (dispatches 5 Subagents) | Repo files + Output Packets + handoff | **Absent** until handoff | (orchestrator emits handoff; pipeline ends) |
| post | (cleanup) | `/ship FEAT-XXX` | — | Confirms acceptance, runs cleanup | Removes `.agent-session/<task_id>/` |

## Why 4 Phases (not 2, not more)

The number 4 comes from the SDD industry consensus (GitHub Spec Kit, Kiro, BMAD all converge on Specify → Plan → Tasks → Implementation). ai-squad adopts this division for two reasons:

1. **Well-defined tasks serve humans and AI alike.** Both perform better when the work is sliced into discrete units before execution starts. A Spec answers WHAT/WHY; a Plan answers structural HOW; Tasks answer the work breakdown; Implementation does the work. Conflating these into fewer Phases creates ambiguity at exactly the point where ambiguity costs most.

2. **Granular gates give the human meaningful control.** The human can reject/refine at three checkpoints before the autonomous Phase 4 starts. The cost of getting Phase 4 wrong (modified code, wrong direction) is high; three opportunities to course-correct upstream is cheap insurance.

Going beyond 4 (e.g. adding a "Discovery" Phase 0 or a "Review" Phase 5) is rejected:

- **Pre-Phase 1 (Discovery)** is responsibility of the human *before* invoking ai-squad. The framework assumes the human arrives at Phase 1 with a problem worth specifying.
- **Post-Phase 4 (Review/Deploy)** is responsibility of the host project's own processes (CI, code review, deployment pipelines). The handoff is the framework's exit; what the human does next is theirs.

## The boundary criterion

The defining boundary of the framework is **between Phase 3 and Phase 4** — it is the only place where "human in-the-loop" flips to "human absent". Phases 1, 2, 3 share the property of being interactive (human + Skill iterating); Phase 4 is autonomous (orchestrator + Subagents).

This is the same `human-in-the-loop` criterion that defines [Skill vs Subagent](skill-vs-subagent.md) — applied at a different layer:

- **Materialization layer** (Skill vs Subagent): "*This Role* needs the human in-the-loop?"
- **Flow layer** (which Phase): "*This stage of work* needs the human in-the-loop?"

It is not coincidence that the 4 Skills (`spec-writer`, `designer`, `task-builder`, `orchestrator`) span the 4 Phases (one per Phase) and that the 5 Subagents all live in Phase 4 — they are consequences of the same principle.

## Skills per Phase

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
| `blocker-specialist` | Subagent | 4 (escalation) | Neither |

4 Skills (one per Phase) + 5 Subagents (all in Phase 4 / escalation). Total: 9 canonical Roles.

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

## Transition gates — two acts each, with guided next step

Each gate is **two human acts**: (1) approve the Phase's artifact by changing its `status` to `approved`, (2) invoke the next Phase's Skill via slash command. The framework does not auto-transition.

The "guided next step" message at the end of each Phase **depends on `planned_phases`** — the Skill suggests only the next *planned* Phase, or signals that the Session will pause:

| Transition | If next Phase is planned | If next Phase is NOT planned |
|------------|---------------------------|-------------------------------|
| Phase 1 → 2 | `"Spec approved. Next: run /designer to start Phase 2 (Plan)."` | `"Spec approved. Plan was not planned for this Session. Next: /task-builder OR /orchestrator (whichever was planned)."` |
| Phase 2 → 3 | `"Plan approved. Next: run /task-builder to start Phase 3 (Tasks)."` | `"Plan approved. Tasks not planned. Next: /orchestrator (if planned) OR Session paused."` |
| Phase 3 → 4 | `"Tasks approved. Next: run /orchestrator to start Phase 4 (Implementation)."` | `"Tasks approved. Implementation was not planned. Session is now paused. To execute later: /orchestrator FEAT-XXX --resume."` |
| Phase 4 → end | (orchestrator internal) | `"Implementation done. When ready, run /ship FEAT-042 to clean up the session."` |
| Post-LGTM | `/ship FEAT-XXX` | `"Session FEAT-042 cleaned. To start a new feature: /spec-writer."` |

Each Skill's body must surface the appropriate guided message — see the Skill's own `skill.md` for exact wording.

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
2. **Inventing "Pre-Phase 1" (Discovery) or "Post-Phase 4" (Deploy).** Discovery is the human's job before invoking ai-squad; deployment is the host project's CI/CD.
3. **Calling Phase 4 sub-stages "phases".** Inside Phase 4 the orchestrator runs a Pipeline (concept #9) with stages like `dev`, `review`, `qa`. Those are *Pipeline stages*, not Phases.
4. **Auto-transitioning between Phases.** Every transition needs explicit human action.
5. **Skipping Phases silently.** When `planned_phases` excludes a Phase, the next Skill explicitly says so in its guided next-step message. The decision to skip must be visible.
6. **Modifying an `approved` artifact without reverting status to `draft`.** Subsequent Phases consume the obsolete version.
7. **Not surfacing the guided next step at end of Phase.** Each Skill must instruct the human what to run next OR signal `paused`.
8. **Human interfering in Phase 4.** The autonomous Phase assumes "human absent". Editing code that `dev` is modifying mid-Pipeline causes write conflicts.
9. **Running a Skill for a Phase not in `planned_phases`.** Each Skill verifies on entry; bypassing this defeats the planning UI.
10. **Hard-coding `planned_phases` defaults to less than all 4.** The default is full discipline; humans opt-out per-Session, not at the framework level.

## Why this design and not alternatives

- **4 Phases over 2:** the original ai-squad design had 2 Phases (interactive vs autonomous). Three Phases of work were collapsed into "Implementation". The 4-Phase model came from explicit user feedback that *human-validated tasks* are useful for both AI and humans, and that the industry has converged on this division.
- **Runtime artifacts gitignored over versioned:** versioning Spec/Plan/Tasks in the consumer's git would duplicate information the consumer already tracks in Jira/ClickUp/GitHub PR descriptions.
- **Two-act gates over single-act:** approving an artifact and starting the next Phase are different decisions.
- **Planned_phases at entry over per-Phase opt-out:** asking once upfront is less friction; one decision, the human knows the whole plan. Asking at every boundary becomes nagging. Editing the array mid-Session covers cases where plans change.
- **Interactive checkbox + flag override:** UI for first-time clarity, flags for repeat / scripted use.
- **Paused as terminal-but-resumable:** matches real workflows ("plan now, execute later"). Without it, half-runs would have no clean state.
- **`/ship` as separate cleanup over auto-cleanup:** auto-cleanup risks deleting information the human still needs to extract. Manual `/ship` keeps the human in control.
