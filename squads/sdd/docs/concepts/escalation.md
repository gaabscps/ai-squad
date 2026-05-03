# Concept — `Escalation`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`pipeline.md`](pipeline.md), [`output-packet.md`](output-packet.md), [`session.md`](session.md).

## Definition

**Escalation** is the deterministic mechanism that returns control to the human when the squad cannot proceed autonomously inside Phase 4. Operates **per-task** (async): one task hitting an escalation trigger does **not** block parallel tasks. Cascade is fixed: trigger → `blocker-specialist` → if unresolved, handoff with `status: escalate`.

> *Terms used in this doc:*
> - **escalation cascade:** the ordered hierarchy of responders. Order is fixed: orchestrator detects trigger → `blocker-specialist` always first → only if specialist returns `status: escalate` does the human receive the case.
> - **decision memo:** the structured artifact `blocker-specialist` produces when it resolves a blocker. Carries the decision taken, rationale, and concrete resume instructions.
> - **resume vs restart:** after a `status: escalate` handoff, the human edits artifacts and chooses to either *resume* (orchestrator continues from where it left off, reusing valid prior dispatches) or *restart* (Phase 4 from scratch).
> - **target escalation rate:** observational health metric — the fraction of tasks that end in `pending_human` instead of `done`. Industry guidance (Galileo): 10–15% sustained.
> - **per-task escalation:** every task in `tasks.md` carries its own counters and state. Escalation of one task is independent of others — parallel tasks continue.
> - **task terminal state:** `done` (Pipeline succeeded for this task) or `pending_human` (this task is blocked awaiting human; Pipeline does not retry it autonomously).

## Why Escalation is its own concept

1. **It is the only valve out of autonomous Phase 4.** Without canonical doc, every "something went wrong" becomes ad-hoc; the human is left guessing about what happened and what to do next.

2. **The cascade order is hard.** "Skip the specialist, go straight to human" is tempting but removes the `blocker-specialist` filter (which often resolves without the human). Doc canonizes the ordering.

3. **Async per-task semantics is non-obvious.** Naive readers assume "one task fails → whole Phase 4 fails". The async model (parallel tasks proceed) is the framework's choice and must be explicit.

4. **Health metric.** Without a documented target rate, the framework can degrade silently — escalations climbing to 60% of runs would mean the framework is not paying off, but no one would notice without a number to measure against.

## The 4 canonical triggers

A task enters the escalation cascade when any of these conditions holds for that task:

| # | Trigger | Detected by | Source |
|---|---------|-------------|--------|
| 1 | `status: blocked` in any Output Packet | Subagent self-declares incapacity | Subagent emits → orchestrator reads |
| 2 | Conflict between `code-reviewer` and `logic-reviewer` | Findings opposing on the same `file:line` | Orchestrator detects in reconciliation |
| 3 | Loop cap exceeded for the task | `review_loops > review_loops_max` OR `qa_loops > qa_loops_max` | Orchestrator increments counter, checks cap |
| 4 | Progress stall (no-progress detection) | `(diff_hash, findings_hash)` identical between two consecutive iterations | Orchestrator hashes per loop iteration |

Other unexpected events (malformed Output Packet, tool timeout, infrastructure error) become **synthetic blockers**: the orchestrator generates an Output Packet with `status: blocked` and dispatches the cascade for that task.

## The cascade — fixed order, per-task

For each task that hits a trigger:

```
1. orchestrator detects trigger for task T-XXX
   ↓
2. orchestrator increments T-XXX.blocker_calls counter
   ↓
3. orchestrator dispatches blocker-specialist with:
     - the failing Output Packet (in input_refs)
     - the task's full context (Spec / Plan / task definition)
     - the prior loop's findings (if loop cap was the trigger)
   ↓
4. blocker-specialist returns:
     ├─ status: done + decision memo → T-XXX resumes from where it left off
     │                                  (next dispatch reads the memo as input_refs)
     │
     └─ status: escalate + structured blockers → T-XXX enters pending_human state
                                                   (orchestrator does not retry T-XXX autonomously)

OTHER TASKS (T-YYY, T-ZZZ, …) PROCEED INDEPENDENTLY.
The Pipeline "ends" only when ALL tasks reach a terminal state
(done | pending_human).
```

If `blocker-specialist` is invoked twice for the same task (two different blockers, or same blocker twice) and the second invocation hits `blocker_calls_max` (default: 2), the orchestrator marks the task `pending_human` immediately on the next blocker — no third specialist invocation.

## Why `blocker-specialist` always first

Every trigger goes through the specialist before reaching the human. Considered alternatives:

- **Some triggers go straight to human (e.g. progress stall).** Rejected. Specialist runs Opus + xhigh; it can sometimes spot what dev/reviewer missed (alternate framing, hidden constraint, tool misuse). Cost of one Opus dispatch < cost of pulling the human in unnecessarily.
- **Configurable bypass.** Rejected for the MVP. Adds knobs that mostly tempt users to skip the specialist, defeating its purpose. Can revisit if data shows specialist is consistently useless on certain triggers.

The discipline is uniform: **every trigger gets one specialist round.** If the specialist cannot resolve, escalation proceeds.

## Loop caps (industry-validated)

These live per-task in `session.yml`. They are independent across tasks.

| Cap | Default | Counted | Source |
|-----|---------|---------|--------|
| `review_loops_max` | **3** | Each `dev → reviewers → dev` round | Reflexion (Shinn et al., NeurIPS 2023) — canonical `max_trials=3` |
| `qa_loops_max` | **2** | Each `qa → dev` round (when qa fails and orchestrator loops back) | Conservative — qa is broader scope than review; cheaper to escalate sooner |
| `blocker_calls_max` | **2** | Each `blocker-specialist` dispatch for the same task | Anthropic Claude Code's "3 denials → human" pattern — 2 chances for the specialist before human |

**Total worst-case dispatches of `dev` per task:** 1 (initial) + 3 (review loops) + 2 (qa loops) = **6 dispatches max per task**. Comfortable for Max 5x.

Industry default range across surveyed frameworks (LangGraph, AutoGen, CrewAI, OpenAI Agents SDK, Google ADK, Anthropic, Reflexion paper): **3–5 iterations is the consensus sweet spot**. ai-squad sits at the conservative end of this band, prioritizing quota preservation.

Override per dispatch via Work Packet's `max_loops` field (concept #7). Useful for one-off "give this task an extra round" decisions without raising the global default.

## Per-task escalation (async)

This is the architectural choice that distinguishes ai-squad's escalation from naive "one fails, all fails" models.

### State per task

The Session (`session.yml`) carries a `task_states` map:

```yaml
task_states:
  T-001:
    state: "pending_human"        # see state enum below
    review_loops: 3
    qa_loops: 0
    blocker_calls: 2
    last_dispatch_id: "blocker-specialist-7c2e1a"
    blocker_summary: "Spec FEAT-042/AC-003 contradicts Plan section 'Data model'"
  T-002:
    state: "done"
    review_loops: 1
    qa_loops: 0
    blocker_calls: 0
    last_dispatch_id: "qa-9f4d2b"
  T-003:
    state: "running"
    review_loops: 0
    qa_loops: 0
    blocker_calls: 0
    last_dispatch_id: "dev-3a8c1d"
```

### Task state enum

| State | Meaning | Pipeline action |
|-------|---------|-----------------|
| `pending` | Not yet dispatched (waiting for `Depends on:`) | None |
| `running` | Has at least one in-flight dispatch | Continue |
| `blocked` | Waiting for `blocker-specialist` to return | Continue (other tasks) |
| `resolved` | Specialist returned decision memo; resuming | Re-dispatch with memo as input |
| `done` | Pipeline succeeded; AC coverage validated | Terminal |
| `pending_human` | Specialist escalated; human must intervene | Terminal (until human resolves) |

`done` and `pending_human` are **terminal**. The Pipeline ends when all tasks reach one of the two.

### Dependencies

Tasks with `Depends on: T-XXX` in `tasks.md` inherit dependency. If `T-001` enters `pending_human`, then `T-002` (which depends on `T-001`) pauses in `pending` state and waits for `T-001` to be resolved by the human. Tasks that do **not** depend on `T-001` proceed normally.

### Pipeline termination

The orchestrator considers the Pipeline complete when:

- All tasks are `done` → emit success handoff (`status: done`)
- Any task is `pending_human` → emit mixed-status handoff (`status: escalate`) at the end, after all autonomous tasks reach terminal state
- A combination → handoff is mixed (some `done`, some `pending_human`); the Pipeline status is `escalate` because at least one task needs human attention

## Handle in-flight dispatches

When a trigger fires for a task, the orchestrator does NOT cancel any in-flight dispatch (for any task, including the failing one). Reasons:

- Cancelling wastes partial evidence the Subagent has already produced (some of it may be useful to `blocker-specialist`).
- The platform does not provide a clean "kill subagent" mechanism.
- The cost of waiting for 1–2 in-flight dispatches to finish is trivial.

The orchestrator queues the cascade dispatch and starts it once any required predecessor returns.

## Decision memo structure

When `blocker-specialist` resolves a blocker, it writes a decision memo to:

```
.agent-session/<task_id>/decisions/<topic>-<timestamp>.md
```

(Gitignored on the consumer project; removed by `/ship FEAT-XXX` along with the rest of the Session.)

The Output Packet from `blocker-specialist`:

```json
{
  "spec_id": "FEAT-042",
  "dispatch_id": "blocker-specialist-7c2e1a",
  "role": "blocker-specialist",
  "status": "done",
  "summary": "Decided: implement malformed-token handling as 422 with generic error message. Resume dev with this constraint.",
  "evidence": [
    { "id": "EV-001", "kind": "file", "path": ".agent-session/FEAT-042/decisions/malformed-token-1740832455.md", "reason": "decision memo" }
  ],
  "findings": [],
  "blockers": [],
  "next_role": "dev"
}
```

The decision memo file:

```markdown
# Decision: <topic>

## Blocker context
[which Output Packet triggered this; what was blocked, for which task T-XXX]

## Decision
[one sentence: the decision taken]

## Rationale
[why; references to Spec sections, Plan, prior findings]

## Resume instructions
[concrete next steps for the Role that was blocked]
```

The next dispatch for the affected task includes this file's path in `input_refs` so the resuming Subagent knows the decision and can proceed.

## Resume vs Restart

After a `status: escalate` handoff, the human edits whatever needs editing in Spec/Plan/Tasks (each artifact's `status` reverts to `draft`, then back to `approved` after edits). Then the human chooses:

| Command | Behavior | When to use |
|---------|----------|-------------|
| `/orchestrator --resume FEAT-XXX` | Continues from current Session state. Reuses prior valid dispatches (other tasks already `done` stay `done`). Only `pending_human` tasks restart from their last known state with the human's edits as new input. | **Default.** Preserves the work already validated. |
| `/orchestrator --restart FEAT-XXX` | Wipes `.agent-session/<task_id>/inputs/` and `outputs/` (preserves spec/plan/tasks). Starts Phase 4 from scratch. | When the human's edit invalidates earlier work (e.g. `AC-003` changed semantically; everything `dev` did against it is no longer valid). |

The decision is the human's. The framework does not auto-decide.

## Target escalation rate — observational health metric

The fraction of tasks that end in `pending_human` instead of `done`, observed across runs.

| Range | What it suggests |
|-------|------------------|
| 0–5% | Likely under-escalating. Issues are slipping through (handoff says `done` but bugs exist). Caps may be too permissive or triggers too weak. |
| **10–15%** | **Healthy.** Phase 4 succeeds autonomously most of the time; escalates when it should. (Galileo industry guidance.) |
| 15–25% | Acceptable but worth diagnosing. Often: Specs entering Phase 4 are still ambiguous. |
| 25%+ | Framework is being misused. Root cause is almost always vagueness amplification in Specs (concept #4). Refine Phase 1 before increasing caps. |

**Surfaced in handoffs:**

- **Mid-Pipeline blocker handoffs** (when one task escalates while others continue): show running rate for *this run* (`escalated so far: 1/3 tasks = 33%`).
- **Final handoffs** (Pipeline complete): show this run's final rate (`done: 4 / escalated: 1 / total: 5 = 20% escalation rate this run`).

**Cumulative cross-session rate:** *future capability.* Would live at `.ai-squad/history.log` (also gitignored on consumer; opt-in). A helper command `/squad-stats` would read the log and show observed rate over the last N runs. Not part of the MVP.

The framework does not enforce anything based on rate. It is a number for the human to interpret.

## Anti-patterns

1. **Skipping `blocker-specialist` for "obvious" triggers.** Every trigger goes through the specialist. Specialist sometimes resolves what looked obvious to escalate.
2. **Cancelling in-flight dispatches when one task escalates.** Wastes partial evidence; in-flight dispatches finish; only the affected task's flow is paused for the cascade.
3. **Treating Pipeline as "all-or-nothing" instead of per-task.** One task escalating does not block parallel tasks. Reconciliation is per-stage per-task, not pipeline-wide.
4. **Editing artifacts during escalation handoff without reverting status to `draft`.** Subsequent `--resume` would consume artifacts in inconsistent state. Material edits ⇒ `draft` ⇒ re-approve.
5. **`blocker-specialist` rewriting the Spec.** The specialist decides HOW (implementation choices), never WHAT (Spec content). Spec ambiguity is a Spec problem; specialist escalates with structured blockers, not Spec edits.
6. **Restart by default.** Preserve as much valid work as possible — `--resume` is the default. `--restart` only when prior work is genuinely invalidated.
7. **Tracking blocker_calls without per-task scope.** `blocker_calls_max: 2` means 2 calls **per task**. A second task hitting a blocker has its own counter starting at zero.
8. **Ignoring the escalation rate.** When the rate climbs above 25% for a sustained period, the right action is to fix Phase 1 (Spec quality), not to raise the loop caps.

## Why this design and not alternatives

- **Per-task async over pipeline-wide gating:** the typical Phase 4 has 5–10 tasks; gating the whole Pipeline on the slowest one (or the one that escalates) wastes the autonomous capacity for everything else. Per-task is more work to implement (state map, mixed handoff) but pays off in throughput.
- **Cascade with specialist always first vs. configurable bypass:** the specialist is the cheap filter; the human is the expensive one. Always-on specialist trades 1 Opus dispatch for the chance to avoid pulling the human in.
- **Industry-conservative caps (3/2/2) over generous (LangGraph 25, CrewAI 25):** Max 5x quota concerns + Reflexion paper's empirical "3 trials covers most refinement value" justify the conservative end of the band.
- **Observational rate over enforced rate:** enforcing (e.g. "if rate > X, framework refuses to start") would block legitimate edge cases. Observational + visible-in-handoff lets the human course-correct on their own.
- **Decision memo as separate file vs. inline in Output Packet:** keeps the Output Packet small; the memo is the durable artifact and gets cited by future dispatches via `input_refs` (consistent with the framework-wide pointer-not-content rule).
