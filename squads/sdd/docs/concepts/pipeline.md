# Concept — `Pipeline`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md), [`phase.md`](phase.md), [`output-packet.md`](output-packet.md), [`work-packet.md`](work-packet.md), [`escalation.md`](escalation.md). Forward to [`session.md`](session.md).

## Definition

The **Pipeline** is the deterministic workflow graph the orchestrator executes inside **Phase 4 (Implementation)**. It is the only Phase with internal multi-Role coordination — Phases 1, 2, 3 are linear human↔Skill interactions and have no Pipeline.

**Operates per-task.** Each task in `tasks.md` flows through the Pipeline independently; the orchestrator tracks per-task state in `session.yml`. One task escalating does not block parallel tasks (see [`escalation.md`](escalation.md) for full per-task semantics).

Pipeline routes purely on the `status` enum + `findings[]` of received Output Packets. There is no improvisation, no prose interpretation, no model judgment in the routing layer.

> *Terms used in this doc:*
> - **workflow graph:** the set of valid transitions inside Phase 4. Nodes = dispatched Roles; edges = routing decisions based on the Output Packet's `status` and `findings[]`. Not strictly acyclic (loops dev↔reviewer exist), but always deterministic.
> - **per-task reconciliation:** the orchestrator's act of merging N parallel Output Packets *for the same task* (from a fan-out within that task) into a single decision before advancing to that task's next stage. Distinct from cross-task gating, which does not exist (tasks are independent).
> - **progress detection:** heuristic to detect dev↔reviewer loops that are not advancing for a given task. Compares hash of the diff and hash of the findings between iterations of that task; identical pair = no progress = early escalation.
> - **handoff:** the one-shot Markdown message the orchestrator emits to the human at the end of Phase 4. Reflects the per-task outcomes (mixed status if some tasks escalated while others completed).
> - **pipeline_stage:** the current stage tag for a given task inside Phase 4 (`dev | review | qa | escalation`). Carried in `session.yml`'s per-task state and optionally in Work Packets. Distinct from the framework's 4 `Phase`s.

## The canonical workflow graph (per-task view)

The orchestrator is the only dispatcher (Subagents cannot dispatch other Subagents — platform constraint). For each task in `tasks.md`, this graph runs independently:

```
                       ┌──────────────┐
                       │ orchestrator │ ← reads Spec + Plan + Tasks; manages session.yml
                       └──┬───────────┘
                          │
                          │ for each ready task T-XXX:
                          │   dispatch dev (single instance per task; fan-out is across tasks)
                          ▼
                     ┌─────────┐
                     │   dev   │
                     └────┬────┘
                          │ Output Packet
                          ▼
              ┌───────────┴───────────┐
              │ status: done          │ status: needs_review/blocked/escalate
              ▼                       ▼
   ┌────────────────────┐    [cascade via blocker-specialist
   │ code-reviewer ‖    │     for THIS task only;
   │ logic-reviewer     │     other tasks continue]
   └─────────┬──────────┘
             │ Output Packets (one per reviewer)
             ▼
     [per-task reconciliation: all-must-pass]
             │
   ┌─────────┴──────────────────┐
   │ both done                   │ ≥1 needs_review (no conflict)    OR    conflict
   │ (no critical findings)      │
   ▼                             ▼                                          ▼
┌──────┐                   [loop back to dev for THIS task,           [dispatch
│  qa  │                    increment review_loops,                    blocker-specialist
└──┬───┘                    progress detection,                        for THIS task]
   │                        max 3 rounds]
   │ Output Packet
   ▼
   ├─ all AC pass     → mark task T-XXX as `done`
   ├─ any AC fails    → loop back to dev (skip reviewers — code already approved)
   └─ any AC blocked  → cascade via blocker-specialist for THIS task

When all tasks are in terminal state (done | pending_human),
emit final handoff (mixed status if any pending_human).
```

Cross-task: tasks marked `[P]` in `tasks.md` whose `Files:` are write-disjoint can have their dev dispatches run in parallel. The orchestrator maintains the per-task graph independently for each. See "Fan-out across tasks" below.

## Fan-out across tasks (orchestrator's parallel dispatch decision)

The orchestrator parses the approved `tasks.md` and constructs an internal task graph:

- Tasks marked `[P]` and without unresolved `Depends on:` references → **eligible for parallel dispatch**.
- Tasks with `Depends on: T-XXX` → **wait** until `T-XXX` reaches a terminal state (`done` or `pending_human`).
- Tasks without `[P]` → treated as sequential by default (conservative).

### Write-disjoint check

The orchestrator computes the intersection of `Files:` across the candidate parallel set. If the intersection is **non-empty** for any pair, parallel dispatch is rejected for that pair (potential write conflict) — those tasks fall back to sequential dispatch.

Parallel dispatch happens only when:

1. ≥2 candidate tasks marked `[P]` and ready (no pending dependencies), AND
2. Their `Files:` are pairwise write-disjoint, AND
3. Per-task quota (`dev` instance budget) allows.

Otherwise: dispatch the next single task sequentially. Defense against the "50 subagents for a simple query" anti-pattern documented by Anthropic Research — when in doubt, single-instance.

### Per-instance Work Packet

Each parallel-dispatched task gets its own Work Packet with:
- `dispatch_id` unique per dispatch
- `task_id` = the task's ID from `tasks.md` (e.g. `T-001`)
- `scope_files` = the task's `Files:` (write-disjoint enforced)
- `ac_scope` = the task's `AC covered:`
- `objective` = the task's title and description
- `previous_findings` = empty on first dispatch; populated on loop iterations

See [`work-packet.md`](work-packet.md) for the full schema.

## Per-task reconciliation — all-must-pass

When N Output Packets return *for the same task* (e.g. both reviewers in parallel), the orchestrator applies **all-must-pass for that task only**:

| All N return `status: done` | → Advance that task to next stage |
| Any returns `needs_review`/`blocked`/`escalate` | → That task's stage fails; loop back or cascade per the failed status. **Other tasks unaffected.** |

**Why all-must-pass per-task and not the alternatives:**

- **Best-effort (advance with partial failure):** rejected. Would push downstream Roles (qa) to validate against partially-passed code, generating noise.
- **Quorum (N of M must pass):** rejected. Adds complexity without solving a documented failure mode in this context.
- **Pipeline-wide gating (one task fails → all stop):** rejected (concept #10's per-task escalation). Wastes autonomous throughput.

## Loop control — caps + progress detection

### Hard caps (per-task)

Counted in `session.yml`'s `task_states[T-XXX]`:

| Cap | Default | Counts |
|-----|---------|--------|
| `review_loops_max` | **3** | Each `dev → reviewers → dev` round for this task |
| `qa_loops_max` | **2** | Each `qa → dev` round for this task |
| `blocker_calls_max` | **2** | Each `blocker-specialist` dispatch for this task |

Defaults backed by industry research (Reflexion `max_trials=3`; Anthropic Claude Code "3 denials → human"). See [`escalation.md`](escalation.md) for sources.

### Progress detection (early escalation, per-task)

For each task, the orchestrator stores in `session.yml` the **hash of two artifacts** between consecutive loop iterations:

- `diff_hash` — hash of the (file path, line range) tuples produced by `dev`'s Output Packet evidence
- `findings_hash` — hash of the `(ac_ref, message, evidence_ref)` tuples in the reviewers' findings

If `(diff_hash, findings_hash)` is identical between two consecutive iterations for the same task → **no progress detected** → cascade via `blocker-specialist` immediately, even if the loop cap is not reached.

The implementation is mechanical: the orchestrator does not interpret what changed; it just compares hashes.

## Reviewer parallelism + conflict arbitration

### Parallel dispatch (within a single task)

For each task that completed dev, the orchestrator dispatches `code-reviewer` and `logic-reviewer` **simultaneously** via two parallel `Agent` tool calls. Both consume the same diff (read-only); there is no write conflict.

### Reconciliation of the two

The orchestrator merges both Output Packets:

| Both `status: done` (no critical findings) | → Advance task to qa |
| ≥1 `status: needs_review` (no conflict) | → Loop back to dev for this task with merged `previous_findings`; increment `review_loops` |
| Conflict detected | → Cascade via `blocker-specialist` for this task |

### Conflict detection

A **conflict** is two findings (one from each reviewer) that:
- Reference the same `file:line` (same `evidence_ref` target), AND
- Have opposing semantics (one says "this is correct", the other says "this is broken"; or `suggested_fix`es that contradict)

Detection is heuristic. The blocker-specialist receives both reviewers' Output Packets as Work Packet `input_refs` and arbitrates with a decision memo. See [`escalation.md`](escalation.md).

## `qa` sequencing rules

### Sequential after reviewers (within a task)

`qa` does **not** run in parallel with reviewers for the same task. Reasons:

1. Reviewers may demand changes that change the code qa would test → wasted dispatch.
2. qa's evidence (test results) reflects current code; running before reviewers approve risks publishing evidence about code that will be rewritten.

### qa fan-out (across ACs of the same task or across tasks)

qa can fan-out **if** the task's `AC covered:` lists multiple ACs that are independently validatable, OR if multiple tasks have reached qa stage simultaneously and their ACs are disjoint. Reconciliation: per-task all-must-pass on the merged `ac_coverage` map (every AC the task covers must have ≥1 evidence; concept #5/#6).

### qa routing decisions (per-task)

| qa Output Packet for task T-XXX | Orchestrator action |
|---------------------------------|---------------------|
| `status: done` (all task's ACs pass) | Mark T-XXX as `done` |
| `status: needs_review` (some AC fails) | Loop back to dev for T-XXX, **skip reviewers** (reviewers already approved code; problem is behavior, not pattern). Increment `qa_loops`. |
| `status: blocked` (AC cannot be validated) | Cascade via `blocker-specialist` for T-XXX |

## Routing truth-table (compact, per-task)

| Stage | Output Packet `status` | Orchestrator's next action for THIS task | Other tasks |
|-------|------------------------|------------------------------------------|-------------|
| dev | `done` | Dispatch reviewers (parallel) | Unaffected |
| dev | `needs_review` | Treat as malformed → cascade | Unaffected |
| dev | `blocked` | Cascade via blocker-specialist | Unaffected |
| dev | `escalate` | Treat as malformed → cascade | Unaffected |
| reviewers | both `done`, no critical findings | Dispatch qa | Unaffected |
| reviewers | ≥1 `needs_review`, no conflict | Loop back to dev (merged findings); increment `review_loops` | Unaffected |
| reviewers | conflict detected | Cascade via blocker-specialist | Unaffected |
| reviewers | ≥1 `blocked` | Cascade via blocker-specialist | Unaffected |
| qa | `done` | Mark task `done` | Unaffected |
| qa | `needs_review` | Loop back to dev (skip reviewers); increment `qa_loops` | Unaffected |
| qa | `blocked` | Cascade via blocker-specialist | Unaffected |
| blocker-specialist | `done` (decision memo) | Resume task at the stage that originally cascaded, with memo as `input_refs` | Unaffected |
| blocker-specialist | `escalate` | Mark task `pending_human` | Unaffected |

When **all tasks** reach a terminal state (`done` or `pending_human`), emit the final handoff.

## Handoff format

The orchestrator emits a single human-readable Markdown message at end of Phase 4. The format reflects per-task outcomes — handoffs can be uniform (all done), uniform (all escalated), or mixed.

### Final handoff — uniform success (all tasks done)

```markdown
# Handoff — FEAT-042 implementation done

**Status:** done
**Spec:** FEAT-042 — <one-line title from spec.md>
**Duration:** <wall time of Phase 4>
**Tasks:** 5/5 done — T-001, T-002, T-003, T-004, T-005
**Pipeline rounds:** dev × <N>, reviewers × <N>, qa × <N>, blocker-specialist × <N>
**Escalation rate (this run):** 0/5 = 0%

## Summary
[2-3 lines machine-readable summary]

## Changes
[paths created/modified, grouped by area]

## Commits
- <sha> — <short message>

## Acceptance criteria coverage
- ✅ FEAT-042/AC-001: validated by <evidence pointer>
- ✅ FEAT-042/AC-002: validated by <evidence pointer>
[...]
(full coverage in qa Output Packets at .agent-session/FEAT-042/outputs/qa-*.json)

## Important paths
- .agent-session/FEAT-042/ — full session trace

## Next step
Run `/ship FEAT-042` to remove the session and free disk. Then capture this summary in your tracking tool (Jira ticket / GitHub PR description / ClickUp card).
```

### Final handoff — mixed status (some tasks escalated)

```markdown
# Handoff — FEAT-042 partial completion

**Status:** escalate (mixed)
**Spec:** FEAT-042
**Tasks:** 4/5 done — T-002, T-003, T-004, T-005
**Awaiting human:** 1/5 — T-001
**Escalation rate (this run):** 1/5 = 20% (within healthy range 10-15% target)

## Done
[...same structure as success handoff for the done tasks...]

## Awaiting human decision

### T-001
**Blocker (from blocker-specialist):**
[the blocker's `reason`, `what_was_attempted`, `what_is_needed` — copied from the specialist's Output Packet]

**Memo location:** .agent-session/FEAT-042/decisions/<topic>-<timestamp>.md

## Next step
1. Read the blocker context for T-001 above (and the linked memo).
2. Edit Spec / Plan / Tasks as needed. Status of edited artifact reverts to `draft`; re-approve once fixed.
3. Then choose:
   - `/orchestrator --resume FEAT-042` (default) — picks up T-001 with your edits, keeps T-002..T-005 as done.
   - `/orchestrator --restart FEAT-042` — starts Phase 4 from scratch (only when prior work is invalidated).
```

### Mid-Pipeline blocker handoff (intermediate)

When a task escalates to `pending_human` while others are still running, the orchestrator does NOT emit a handoff yet — it waits for all tasks to reach terminal state. The mid-Pipeline notification is captured only in `session.yml` and surfaces in the final handoff. This avoids spamming the human with multiple intermediate messages.

(Future: optional `--notify-on-escalation` flag for streaming notifications. Not in MVP.)

## Anti-patterns

1. **Pipeline customized per feature.** The Pipeline is fixed across all features. Customization happens via `tasks.md` (different decomposition) or via Work Packet overrides (`model`/`effort`), never by adding/removing Pipeline stages.
2. **Skipping reviewers or qa for "small" tasks.** Cap minimum: dev → reviewers → qa always run for every task, regardless of task size. The cost is low; the regression-defense value is high.
3. **Loops without progress detection.** Allowing 3 identical iterations is wasted budget. Hash-based detection cuts the dead loop early.
4. **`qa` running in parallel with reviewers for the same task.** Subverts the ordering; risks publishing AC evidence against code that will be rewritten.
5. **Best-effort reconciliation.** "Most reviewers returned done so let's continue" silently advances against partial work. All-must-pass per-task is the safer default.
6. **Treating fan-out as the default within a single task.** Default is single-instance per task; fan-out is across-tasks based on `tasks.md` `[P]` markers + write-disjoint check.
7. **`status: escalate` from non-`blocker-specialist` Roles.** Reserved for `blocker-specialist`. Other Roles use `blocked` and let the cascade decide.
8. **Improvising routing on prose.** The orchestrator must route on `status` enum + `findings[]` only. Reading the `summary` to decide "this looks important" is forbidden.
9. **Pipeline-wide gating (cancelling all tasks when one escalates).** Per-task autonomy is the explicit design. Other tasks proceed; only the affected task pauses.
10. **Emitting intermediate handoffs every time a task escalates.** Only emit at end of Pipeline (when all tasks are terminal). Intermediate notifications spam the human.

## Why this design and not alternatives

- **Workflow graph over rigid linear pipeline:** loops dev↔reviewer and the parallel reviewers are first-class needs. Linear pipeline cannot represent them without inventing pseudo-stages.
- **Per-task autonomy over pipeline-wide gating:** typical Phase 4 has 5–10 tasks; gating the whole Pipeline on the slowest or failing one wastes the autonomous capacity for the rest. Per-task is more state to manage but pays off in throughput.
- **Orchestrator as central dispatcher:** mandated by the platform (Subagents cannot dispatch). What looks like overhead (everything routes back through orchestrator) is actually the source of the framework's auditability — every transition is observable in `session.yml`.
- **`status` enum as routing input:** finite enum + truth-table is the smallest deterministic routing function. Anything richer would require interpretation, which is what the framework is designed to avoid.
- **All-must-pass reconciliation per-task:** SDD discipline; alternatives optimize wrong axes (cost vs correctness).
- **Hash-based progress detection over LLM-judged progress:** mechanical, fast, deterministic. LLM-judged "is this making progress?" is exactly the kind of fuzzy signal the framework refuses to depend on.
- **Sequential qa over parallel-with-reviewers:** small wall-time cost, large savings in wasted dispatches when reviewers loop back.
- **Single end-of-Pipeline handoff over streaming notifications:** humans want one summary at the end, not 5 mid-Pipeline pings. Defer streaming to optional flag.
