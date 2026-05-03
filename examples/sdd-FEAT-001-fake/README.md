# FEAT-001-fake — Worked Example

This folder shows what `.agent-session/<task_id>/` looks like in a consumer project after a complete SDD squad run for a small but real-feeling feature: **"/health endpoint"**.

**Purpose:** demonstrate the full SDD flow end-to-end (Specify → Plan → Tasks → Implementation), highlight where the human is in-the-loop vs. where the pipeline runs autonomously, and show concretely what the orchestrator's handoff message to the human looks like at the end of Phase 4.

**This is the ONLY copy of these artifacts in the ai-squad repo.** In a real consumer project they'd live at `<project>/.agent-session/FEAT-001/` and be gitignored — `/ship FEAT-001` would delete them after the human accepts the handoff.

## Files

- `session.yml` — created by `spec-writer` at Phase 1 entry; updated by every subsequent Phase; in Phase 4 the orchestrator becomes the **sole writer** (atomic tmp+rename, no race). Ends in `current_phase: done`.
- `spec.md` — Phase 1 (Specify) output. Frontmatter `status: approved` is the gate Phase 2 reads.
- `plan.md` — Phase 2 (Plan) output. Architecture + AC Coverage Map. `status: approved` gates Phase 3.
- `tasks.md` — Phase 3 (Tasks) output. Granular `T-XXX` units with `Files:`, `AC covered:`, `[P]` parallelization markers. `status: approved` gates Phase 4.
- `inputs/<dispatch_id>.json` — Work Packets (orchestrator → Subagent). Phase 4 only.
- `outputs/<dispatch_id>.json` — Output Packets (Subagent → orchestrator). Phase 4 only. Mirror layout of `inputs/`.
- `handoff.md` — Phase 4 handoff message (Conventional Commits title + 4 fixed sections). The orchestrator's only direct communication to the human after Phase 4 starts.

> **Note on dispatch coverage:** Phase 4 produced many dispatches in this run (dev → reviewers ‖ → qa, per task, per loop). The `inputs/` and `outputs/` folders ship a **single representative dispatch** (`dev-T-001-abc123`) so the canonical Work Packet / Output Packet shape is testable end-to-end without cluttering the example. The full dispatch trail is summarized in `session.yml.task_states` (loop counters + `last_dispatch_id`).

---

## Walkthrough

### Phase 1 — Specify (`spec-writer`)

**Two entry shapes for Phase 1.** `/spec-writer` accepts a pitch from either origin:

- **(a) Fresh start (this example)** — the team perceived the gap directly; no upstream Discovery memo. The pitch is a one-paragraph problem statement written by the human.
- **(b) Discovery handoff** — pitch derived from an approved Discovery memo (Cagan Frame Q1-Q9 + Decide). The human reads the memo, distills the relevant context, and recomposes the pitch with `Source: DISC-NNN` plus the `Open Questions for Delivery` carried forward as freshness signals. See `examples/discovery-DISC-001-fake/README.md` → "Handoff to SDD" for what shape (b) looks like concretely.

The two shapes converge inside `spec-writer` — there is **no auto-feed from Discovery to SDD**; the human is always the bridge, deciding what context to carry over and what to drop. This example demonstrates shape (a).

The human ran:

```
/spec-writer "Operators have no programmatic way to verify the API is up. Need a /health endpoint."
```

`spec-writer` walked them through Phase 1 interactively:

1. **Asked which Phases this Session would run** via `AskUserQuestion` (checkbox UI). The human checked all 4 — `Specify`, `Plan`, `Tasks`, `Implementation` — written to `session.yml.planned_phases`. Skipping any Phase (including Phase 4) is supported; `--plan="specify,tasks"` is the power-user flag equivalent.
2. **Generated a first draft** of `spec.md` from `squads/sdd/templates/spec.md`, populated from the pitch — Problem, Goal, one User Story (`US-001 [P1]`), three EARS-format ACs (`AC-001`, `AC-002`, `AC-003`), Constraints (Express stack, no new dependencies), Out of Scope (auth, dependency health).
3. **Clarification pass** — no `[NEEDS CLARIFICATION]` markers were needed for this small feature; the pitch was unambiguous enough.
4. **Final approval gate** (Hybrid: checklist + `AskUserQuestion` binary) — printed a visual checklist of completed sections, then asked `"Approve this Spec? [Yes / No]"`. Human approved → `status: approved` written to `spec.md` frontmatter (atomic write).

The `spec-writer` then surfaced the next step: *"Spec approved. Next: run `/designer` to start Phase 2 (Plan)."*

### Phase 2 — Plan (`designer`)

The human ran:

```
/designer
```

`designer` read the approved Spec and worked interactively to produce `plan.md`:

1. **Generated a first draft** populated from the Spec — single architecture decision (`/health` route at `src/routes/health.ts`), API surface (`GET /health` returning `{status, timestamp}`), no data model, no UX surface (backend-only feature). Every decision tagged inline with the AC IDs it covers (Kiro forward-traceability).
2. **Auto-populated 5 Risk categories** (STRIDE + ATAM lineage): Security, Performance, Migration/data, Backwards compatibility, Regulatory/compliance. Categories with no real risk for this feature got an explicit `(none — <one-line reason>)` rather than being silently omitted — making the consideration explicit.
3. **Recorded alternatives in `## Notes`** (MADR-style, post-hoc): considered `express-healthcheck` library; rejected because it adds a dependency and the Spec constrains "must not require any new dependencies."
4. **AC coverage gate** — every AC in the Spec must be covered by at least one Plan section before approval. This run: 3/3 ACs covered, zero gaps.
5. **Final approval gate** — visual checklist (5/5 risk categories addressed, 3/3 AC coverage, alternatives recorded) + `AskUserQuestion` binary. Human approved → `status: approved` written to `plan.md`.

The `designer` then surfaced: *"Plan approved. Next: run `/task-builder` to start Phase 3 (Tasks)."*

### Phase 3 — Tasks (`task-builder`)

The human ran:

```
/task-builder
```

`task-builder` decomposed the Spec + Plan into granular work units:

1. **Vertical-slice decomposition** — 2 tasks for this feature:
   - `T-001 [P] [US-001]` — Implement `/health` route handler with tests (covers AC-001, AC-002, AC-003)
   - `T-002 [US-001]` — Wire `/health` into main router (covers AC-001) — `Depends on: T-001`
2. **Marked `[P]` for parallelization** (Spec Kit dual-rule: new files AND no overlap with anything else). T-001 qualified (new files); T-002 did not (shared `src/router.ts` is touched by other features in real projects, plus dependency on T-001).
3. **Specified exact `Files:` paths** per task (Spec Kit pattern) — the orchestrator uses these as hard write-scope boundaries enforced by the `dev` Subagent (`scope_files`).
4. **Tagged `AC covered:`** per task (Kiro forward-traceability) — every Spec AC must be covered by at least one task before approval.
5. **AC coverage gate** — designer-symmetric. 3/3 ACs covered (AC-001 by both T-001 and T-002; AC-002 + AC-003 by T-001).
6. **Final approval gate** — checklist + `AskUserQuestion` binary. Human approved → `status: approved` in `tasks.md`.

The `task-builder` then surfaced: *"Tasks approved. Next: run `/orchestrator FEAT-001` to start Phase 4 (Implementation). Phase 4 runs autonomously — you'll see the handoff message when it completes."*

### Phase 4 — Implementation (`orchestrator`, autonomous)

The human ran:

```
/orchestrator FEAT-001
```

**This is where the human steps out of the loop.** Phases 1-3 are interactive (Skills with `AskUserQuestion`, refinement chat, approval gates). Phase 4 is the **autonomous Implementation Pipeline** — no human prompts, no approval checkpoints. The orchestrator dispatches Subagents, reads Output Packets, enforces caps, and emits a single handoff at the end. The only thing the human sees during Phase 4 is the final handoff message.

The orchestrator did all the heavy lifting in the background:

1. **Read the approved Spec, Plan, and Tasks**; verified each had `status: approved` (refused otherwise per the precondition matrix).
2. **Initialized `task_states`** in `session.yml` — one entry per `T-XXX` (`state: pending`, all loop counters at 0).
3. **Built the per-task pipeline graph** from `Depends on:` constraints — T-001 in the ready queue immediately (no deps); T-002 waiting on T-001.
4. **Ran the dispatch loop** (capped concurrency = 5, FIFO overflow). For each task, the per-task pipeline followed: `dev → code-reviewer ‖ logic-reviewer (parallel) → qa`. Specifically:
   - **T-001:** dispatched `dev` (`dev-T-001-abc123` — see `inputs/`). `dev` did test-first implementation, ran tests (`pnpm test src/routes/health.test.ts` → exit 0), and emitted an atomic Conventional Commit (`feat(health): add /health endpoint with status and timestamp`, sha `abc1234`). Output Packet (`outputs/dev-T-001-abc123.json`) returned `status: done` with 4 evidence pointers. Orchestrator dispatched **`code-reviewer` ‖ `logic-reviewer` in parallel** (Google-style dimension split: code-reviewer = Design/Style/Naming/Comments/pattern-fit; logic-reviewer = Functionality/edge cases/concurrency/invariants). One reviewer returned a `minor` finding → orchestrator looped back to `dev` (counted: `review_loops: 1`). Second reviewer pass clean → orchestrator dispatched `qa`. `qa` validated all 3 ACs against the Spec (one `kind: test` evidence per AC, every AC ID present as a key in `ac_coverage`) → `status: done`. T-001 transitioned `running → done`.
   - **T-002:** unblocked after T-001 done. Dispatched `dev` (one-shot — wired the route into `src/router.ts`, atomic commit `def5678`). Reviewers clean on first pass (`review_loops: 0`); `qa` pass on first try (`qa_loops: 0`). T-002 done.
5. **Per-task state machine + sole-writer invariant** — after every Subagent return, the orchestrator atomically rewrote `session.yml.task_states[T-XXX]` (tmp + rename). Subagents NEVER write `session.yml`; eliminates concurrent-write races without file locks (Buck2's single-coordinator pattern).
6. **Loop caps enforced throughout** — `review_loops_max: 3`, `qa_loops_max: 2`, `blocker_calls_max: 2` per task. Cap counters preserved across `--resume`. Hash-based progress detection (`last_diff_hash`, `last_findings_hash`, `last_finding_set_hash`) catches "reviewer repeating itself" stalls regardless of remaining loop budget.
7. **Escalation path** (not triggered in this run, but always armed): on cascade trigger (`status: blocked`, reviewer conflict on same `file:line`, loop cap, progress stall) the orchestrator dispatches `blocker-specialist` (Opus, xhigh effort). The specialist either writes a decision memo (`status: done`, resume instructions) OR escalates to human (`status: escalate`, task enters `pending_human` terminal state — other tasks continue independently). After `blocker_calls_max: 2` the task goes `pending_human` regardless.

**Pipeline result for this run:** 2/2 tasks `done`. `escalation_metrics.escalation_rate: 0%` (target band: 10-15% per Galileo's production agent benchmarks; well under means clean Spec, well-scoped tasks, no ambiguity). The orchestrator computed the handoff (see next section), saved it to `handoff.md`, set `current_phase: done`, and returned.

---

## Handoff — concrete

The SDD handoff is **not cross-squad** like Discovery's (which feeds a Spec pitch into `/spec-writer`). The SDD handoff is the **orchestrator → human** message at the end of Phase 4. After spending all of Phase 4 silent, the orchestrator surfaces a single Markdown document the human can read, decide to ship or fix, and act on.

The handoff is a **Conventional Commits title + 4 fixed sections** (one skeleton, three shape variants depending on outcome). For this run — uniform success — `handoff.md` reads:

```markdown
# feat(health): add /health endpoint with status and timestamp

## Summary
- Implemented `/health` endpoint per FEAT-001 — operators can verify service status programmatically.
- 2 tasks, both `done`. Zero escalations.

## Per-task status

| ID    | Title                                        | Status | Loops used     | Evidence                                |
|-------|----------------------------------------------|--------|----------------|-----------------------------------------|
| T-001 | Implement /health route handler with tests   | done   | review:1, qa:0 | commit abc1234, 4 evidence pointers     |
| T-002 | Wire /health into main router                | done   | review:0, qa:0 | commit def5678, 3 evidence pointers     |

## Validation
- AC coverage: 3/3 ACs validated (AC-001, AC-002, AC-003).
- Test commands run: `pnpm test src/routes/health.test.ts` (exit 0)
- escalation_rate: 0% (target: 10-15%; well under).

## Follow-ups / Escalations
- (none — ready to ship)

---

Implementation done. When ready, run `/ship FEAT-001` to clean up the session.
```

Notice four things:

1. **The title is a Conventional Commits string** (`<type>(<scope>): <imperative summary>`) so it renders cleanly in GitHub PRs, Linear, and Jira — and so the human can copy it directly into a merge commit message.
2. **`Per-task status` shows loop usage explicitly** (`review:1, qa:0`). When loops approach caps, the human can see which tasks burned budget — a smell signal for under-specified ACs or thin Plan decisions.
3. **Evidence is pointers, never inline content** — `commit abc1234`, `4 evidence pointers` (the file/command/commit refs live in the per-dispatch Output Packet). The handoff stays readable; the audit trail stays verifiable.
4. **The closing line varies by outcome** — three shape variants from one skeleton:
   - **Uniform success** (this run): `"Implementation done. When ready, run /ship FEAT-001 to clean up the session."`
   - **Mixed status** (some tasks `pending_human`): `"Partial completion. <N> done, <M> awaiting human decision. After resolving and editing artifacts, choose: /orchestrator FEAT-001 --resume (default — preserves done tasks) | /orchestrator FEAT-001 --restart (only if prior work is invalidated)."`
   - **Full escalate** (all tasks `pending_human`): `"Pipeline escalated. All tasks blocked. See decision memos at .agent-session/FEAT-001/decisions/ and resolve before /orchestrator FEAT-001 --resume."`

After the human ships the feature (PR merged, deployed, monitored), running `/ship FEAT-001` deletes the entire `.agent-session/FEAT-001/` folder — the durable record (commit messages, the merged code, CI artifacts) belongs in git and the team's external tools (Linear, Jira, observability dashboards), not in agent scratch space.

---

## Validation

Run `./scripts/smoke-walkthrough.sh` from the repo root to verify all files in this example parse and cross-references resolve. The smoke covers Phase 1 structure (Spec status + at least one US/AC), Phase 2 structure (Plan status + 5 risk categories + AC Coverage Map), Phase 3 structure (Tasks status + `T-XXX` + `Files:` + `AC covered:`), Phase 4 artifacts (`session.yml` valid YAML with populated `task_states`, at least one dispatch in `inputs/` + `outputs/`, `handoff.md` present), the cross-reference invariant (every Spec AC appears in `tasks.md`), and validates each Output Packet against the canonical JSON schema. Baseline: **59/59 PASS**.
