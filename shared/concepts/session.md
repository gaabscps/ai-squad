# Concept — `Session`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`phase.md`](phase.md), [`pipeline.md`](pipeline.md), [`escalation.md`](escalation.md), [`work-packet.md`](work-packet.md), [`output-packet.md`](output-packet.md).

## Definition

The **Session** is the runtime persistent state of one feature in flight, living in a single YAML file at `.agent-session/<task_id>/session.yml` on the consumer project (gitignored). It is the framework's only persistent state — everything else is either runtime ephemera (Work Packets, Output Packets, logs in `.agent-session/<task_id>/`) or human input (Spec/Plan/Tasks).

Single source of truth for: current Phase, planned Phases, per-task state in Phase 4, loop counters, hashes for progress detection, escalation metrics. Owned by exactly one Role at a time (the Phase's conducting Skill, or the orchestrator in Phase 4).

> *Terms used in this doc:*
> - **session ownership:** convention of which Role has write authority over `session.yml` during each Phase (Phase 1: spec-writer; Phase 2: designer; Phase 3: task-builder; Phase 4: orchestrator). Other Roles read for context but never write.
> - **atomic write (tmp + rename):** file write pattern where new content is first written to a temporary file (`.session.yml.tmp`), then renamed to the destination (`session.yml`). Renames are atomic on POSIX filesystems — readers never see a partially written file.
> - **recovery flow:** the interactive behavior any Skill follows when invoked and detects that `.agent-session/<task_id>/` already exists (a prior Session was abandoned, interrupted, or paused). Always asks the human: resume / restart / cancel.
> - **multi-session:** multiple features being worked in parallel (e.g. `FEAT-042` and `FEAT-043` in different Claude Code sessions), each with its own `.agent-session/<task_id>/`. Permitted; conflict management between parallel sessions is the human's responsibility.
> - **planned_phases:** array of Phases the human selected to run for this Session at entry time (via `AskUserQuestion` in the spec-writer Skill). Allows skipping any Phase, including Implementation ("plan now, execute later" workflow).
> - **paused state:** Session is in a terminal-but-resumable state when all planned Phases have completed but `planned_phases` did not include all 4. The human can resume later by re-invoking the next Skill with `--resume`.

## Why Session is its own concept

1. **It is the only persistent state.** Without canonical Session, the framework has no memory across dispatches — orchestrator's loop counters, task states, and progress hashes would have nowhere to live (Subagents are stateless).

2. **It is what makes recovery possible.** Without persisted Session, abandonment in mid-Phase 4 = lose everything. With Session, retomar is trivial (the next invocation reads and continues).

3. **Atomicity is non-negotiable.** Concurrent writes or interrupted mid-write would corrupt the YAML and kill the entire Pipeline. The atomic write pattern prevents this.

4. **Ownership rules prevent silent bugs.** Without explicit "who writes when", a Subagent could overwrite the orchestrator's state (or vice versa) — silent corruption that surfaces only later. Ownership table is the contract.

## Multi-session policy

Multiple Sessions are permitted. The human can have `FEAT-042` and `FEAT-043` open in different Claude Code sessions, each with its own `.agent-session/<task_id>/`. The framework does not enforce serialization.

**Conflict management is the human's responsibility.** Two parallel Sessions might dispatch `dev` Subagents that touch the same files (rare but possible if `scope_files` overlap across features). The framework cannot detect this globally — same as git: humans manage merge conflicts, framework manages the agent flow.

When a problem surfaces in practice (overlapping `scope_files` across active Sessions), a future enhancement could add a registry warning. Not in MVP.

## Atomicity — tmp + rename

Every write to `session.yml` follows this pattern:

```bash
# Pseudo-code (the orchestrator and Phase Skills implement this internally)
write(".agent-session/FEAT-042/.session.yml.tmp", new_content)
rename(".agent-session/FEAT-042/.session.yml.tmp",
       ".agent-session/FEAT-042/session.yml")
```

Why: `rename(2)` is atomic on POSIX (macOS, Linux, WSL). A reader concurrent with a writer either sees the old file (rename not yet applied) or the new file (rename applied) — never an intermediate state. Interruption between `write` and `rename` leaves `session.yml` intact (the `.tmp` is the casualty).

Append-only logs were considered and rejected: over-engineering for the actual concurrency model (one writer per Phase by ownership; no real race).

Direct writes (no tmp) were considered and rejected: an interrupted `kill -9` mid-write corrupts the YAML and kills the next Pipeline run.

## Session ownership

Exactly one Role has write authority at any time. Others read for context but never write.

| Phase | Owner (writes) | Read access |
|-------|----------------|-------------|
| Phase 1 (specify) | `spec-writer` Skill | n/a (just-created) |
| Phase 2 (plan) | `designer` Skill | spec-writer's content carried over |
| Phase 3 (tasks) | `task-builder` Skill | spec-writer + designer content |
| Phase 4 (implementation) | `orchestrator` Skill | All 6 Subagents read; **none writes** |
| Cleanup | `/ship` Skill | Final read before `rm -rf` |

**Hard rule:** Subagents (`dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`, `audit-agent`) **never** write to `session.yml`. They emit Output Packets; the orchestrator reads those packets and updates the Session accordingly. This preserves Subagent isolation and concentrates state mutation in one place per Phase.

## Recovery flow

Any Skill (`/spec-writer`, `/designer`, `/task-builder`, `/orchestrator`, `/ship`) follows this behavior on invocation:

```
1. Determine task_id (from argument: /spec-writer FEAT-042; or default: derive from current state)
2. Check if .agent-session/<task_id>/session.yml exists.

3a. If NOT exists:
    - This Skill must be the entry point for the planned phase
      (otherwise refuse: "no Session for FEAT-042; start with /spec-writer FEAT-042")
    - Create directory + initial session.yml; proceed normally

3b. If exists:
    - Read current_phase, last_activity_at, planned_phases
    - Show summary to human:
        Session FEAT-042 found.
          Current phase: implementation (Pipeline running)
          Last activity: 2026-05-02 11:23 UTC (47 minutes ago)
          Planned phases: specify, plan, tasks, implementation
          Tasks: 5 total, 3 done, 1 running, 1 pending_human

        Choose:
          [r] Resume — continue from current state
          [R] Restart — DELETE all session state and start over
          [c] Cancel — exit without changes

    - On Resume: verify Skill is appropriate for current_phase (e.g. /designer recused if current_phase = implementation)
    - On Restart: hard confirm ("Type 'DELETE' to confirm"), then rm -rf and re-create
    - On Cancel: exit, no changes
```

**Edge case:** Skill invoked for a Phase different from `current_phase`:

- `/designer FEAT-042` but current_phase is `tasks` → refuse: "Session is in tasks phase. Run /task-builder to continue, or restart."
- `/orchestrator FEAT-042` but current_phase is `paused` AND `planned_phases` includes `implementation` → resume Phase 4 normally (this is the "plan now, execute later" flow).
- `/orchestrator FEAT-042` but Phase 4 is not in `planned_phases` → refuse: "Phase 4 was not planned for this Session. Edit planned_phases in session.yml or restart."

## Planned Phases — selected at Session entry

The `spec-writer` Skill, **before** starting the Spec conversation, asks the human to choose which Phases will run for this Session. Uses `AskUserQuestion` (Claude Code's native UI) with all 4 Phases as a checkbox list, default all-checked:

```
Which Phases will this Session run?
[x] Specify (always; you are here)
[x] Plan
[x] Tasks
[x] Implementation
```

The selection is saved to `session.yml` as `planned_phases`. Every subsequent Skill verifies its own Phase is in the list before proceeding.

**Use cases this enables:**

- **Full run** (all 4 checked): default flow — Spec → Plan → Tasks → Implementation → handoff.
- **Plan-only mode** (Specify + Plan + Tasks, no Implementation): "I want to plan this feature now, execute next week" — Session ends in `paused` after Tasks; human runs `/orchestrator FEAT-XXX --resume` later.
- **Spec-only mode** (only Specify): humans planning to use the Spec for ticketing without ai-squad implementation. Session ends in `paused` after Specify; can be discarded with `/ship FEAT-XXX` if not coming back.
- **Resume after pause**: invoking the Skill of the next planned Phase resumes from the paused state without re-asking the checkbox.

**Flag-based override** for power users: `/spec-writer FEAT-042 --plan="specify,plan,tasks"` skips the interactive prompt and sets `planned_phases` directly.

**Modifying mid-Session:** if the human wants to change `planned_phases` after the Session started (e.g. originally planned all 4, now wants to stop after Plan), the documented path is to edit `session.yml`'s `planned_phases` array directly. The framework respects the new selection on the next Skill invocation.

## The `paused` state

Added to the `current_phase` enum to support "plan now, execute later":

```
specify | plan | tasks | implementation | paused | done | escalated
```

Transitions to `paused`:
- Last Phase in `planned_phases` completes successfully → `current_phase: paused`
- Example: `planned_phases = [specify, plan, tasks]`. After Tasks approved, no `implementation` planned → `paused`.

From `paused`:
- Human invokes the Skill of any subsequent Phase with `--resume` → unpause, run that Phase.
- Human invokes `/ship FEAT-XXX` → terminal, removes Session.
- Session can stay `paused` indefinitely (gitignored, no impact on consumer's git).

## Skip persistence in phase_history

When a Phase is skipped (because it is not in `planned_phases`), it still appears in `phase_history` for auditability:

```yaml
phase_history:
  - phase: "specify"
    started_at: "..."
    completed_at: "..."
    artifact_status: "approved"
    skipped: false
  - phase: "plan"
    started_at: ""
    completed_at: ""
    artifact_status: ""
    skipped: true
    skip_reason: "not in planned_phases (user selection at /spec-writer entry)"
```

Skipped Phases are visible in the final handoff so the human (and any future review) sees what was deliberately skipped, not silently absent.

## Complete schema

```yaml
# Identification
task_id: "FEAT-042"                             # required, must match folder name; sequential FEAT-NNN scoped per project
feature_name: "User-authenticated photo uploads" # human-readable Spec title; populated by spec-writer at first draft
schema_version: 1                                # for future migration; see "Schema versioning" below

# Artifact references
spec_ref: "./.agent-session/FEAT-042/spec.md"
plan_ref: "./.agent-session/FEAT-042/plan.md"   # may be absent if Phase 2 not planned
tasks_ref: "./.agent-session/FEAT-042/tasks.md" # may be absent if Phase 3 not planned

# Time tracking
started_at: "2026-05-02T10:00:00Z"
last_activity_at: "2026-05-02T11:23:45Z"        # updated on every write
completed_at: ""                                 # set on Phase 4 done OR escalated OR paused

# Current state
current_phase: "implementation"                  # specify | plan | tasks | implementation | paused | done | escalated
current_owner: "orchestrator"                    # which Role currently has write authority

# Planned phases (set at /spec-writer entry; consumed by every subsequent Skill)
planned_phases:
  - "specify"
  - "plan"
  - "tasks"
  - "implementation"

# Phase 4 only — Pipeline state
pipeline_started_at: ""
pipeline_completed_at: ""

# Per-task state (Phase 4 only — populated when Pipeline starts)
task_states:
  T-001:
    state: "pending_human"                       # pending | running | blocked | resolved | done | pending_human | failed
    review_loops: 3
    qa_loops: 0
    blocker_calls: 2
    last_dispatch_id: "blocker-specialist-7c2e1a"
    last_diff_hash: ""                             # progress detection: files_changed + line ranges
    last_findings_hash: ""                         # progress detection: findings count
    last_finding_set_hash: ""                      # progress detection: sorted (file,line,ac_ref) tuples
    blocker_summary: "Spec FEAT-042/AC-003 contradicts Plan section X"
    started_at: "2026-05-02T11:00:00Z"
    completed_at: ""
  # T-002, T-003, … each with same structure

# Per-task budget caps (defaults per concept #10; override per dispatch via Work Packet's max_loops)
budget_defaults:
  review_loops_max: 3
  qa_loops_max: 2
  blocker_calls_max: 2

# Escalation metrics for THIS run
escalation_metrics:
  total_tasks: 5
  done_tasks: 4
  pending_human_tasks: 1
  escalation_rate: 0.20

# Phase history (one entry per Phase, populated as Phases complete or skipped)
phase_history:
  - phase: "specify"
    started_at: "2026-05-02T10:00:00Z"
    completed_at: "2026-05-02T10:42:00Z"
    artifact_status: "approved"
    skipped: false
  - phase: "plan"
    started_at: "2026-05-02T10:42:00Z"
    completed_at: "2026-05-02T11:00:00Z"
    artifact_status: "approved"
    skipped: false
  - phase: "tasks"
    started_at: "2026-05-02T11:00:00Z"
    completed_at: "2026-05-02T11:00:30Z"
    artifact_status: "approved"
    skipped: false
  - phase: "implementation"
    started_at: "2026-05-02T11:00:30Z"
    completed_at: ""                             # Pipeline still running OR escalated
    pipeline_summary: ""
    skipped: false
```

## Schema versioning

`schema_version: 1` is present from the MVP. Currently unused — there is no migration logic. Its presence is the anchor for future migrations:

- Schema evolves (add field, rename field, change semantics) → bump to `schema_version: 2`
- A new framework version reading an older Session can detect the mismatch (`if version < current: migrate or refuse`)
- For the MVP: framework upgrades that change the schema are breaking; humans run `/ship FEAT-XXX` to clean up old Sessions before upgrading. Documented as known limitation.

Hard semver versioning (semver fields, registered migration scripts) is over-engineering for a single-user framework. The `schema_version: 1` placeholder costs one line and preserves the option.

## Anti-patterns

1. **Subagents writing to `session.yml`.** Subagents emit Output Packets; orchestrator updates Session based on those packets. Direct writes from Subagents break isolation and ownership.
2. **Multiple Skills writing in the same Phase.** Only the `current_owner` writes. The orchestrator is the sole writer in Phase 4 (no Subagent direct write, no blocker-specialist direct write).
3. **Session inflating into a log.** Session is *state*, not history. The full trail (every Output Packet) lives in `outputs/` separately. Session caps near 100 KB even for large features; passing it suggests log accumulation.
4. **Humans editing `session.yml` manually for non-trivial changes.** Some edits are documented as supported (changing `planned_phases` mid-Session). Manipulating counters or task states risks invariant violations. When in doubt: `/ship` + restart.
5. **Skipping the recovery flow on Skill invocation.** Every entry into a Skill checks for an existing Session. Bypassing this risks overwriting state from a prior Session.
6. **Direct writes (no tmp + rename).** Even small writes deserve atomicity — interruption at any moment must leave the Session in a consistent state.
7. **`paused` Sessions accumulating.** Sessions in `paused` state stay on disk indefinitely (gitignored). Periodic cleanup is the human's responsibility — they decide whether `paused` for 6 months is "still relevant" or `/ship` material.
8. **Schema migration without bumping `schema_version`.** Breaking schema changes without version bump corrupts older Sessions silently. Always bump.

## Why this design and not alternatives

- **Single YAML file vs. multiple files (state + log + history split):** YAML loads in one read; orchestrator does not need cross-file coordination. Splitting buys nothing for a single-writer model.
- **YAML over JSON for Session:** humans occasionally read it (debugging, recovery decisions); YAML is more readable. Work Packets and Output Packets are JSON because they are machine-to-machine; Session is occasionally human-touched.
- **Tmp + rename over fsync + lock:** atomicity without concurrency machinery. The single-writer-per-Phase model means locks are unnecessary.
- **Multi-session permitted vs. serialized:** practical use needs parallelism (multiple features in flight); serializing would force the human to wait artificially.
- **`planned_phases` at entry time vs. at each Phase boundary:** asking once upfront is less friction; the human can edit the array if plans change. Asking at every boundary becomes nagging.
- **Interactive checkbox + flag-based override:** UI for first-time clarity, flags for repeat / scripted use.
- **`paused` as terminal-but-resumable:** matches real human workflows ("plan now, execute later"). Without it, half-runs would have no clean state.
- **`schema_version` placeholder vs. nothing:** trivial cost (one line) preserves the option to migrate later. Leaving it out makes future migration require touching every existing Session.
