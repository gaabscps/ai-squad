---
id: TASKS-FEAT-XXX
status: draft
owner: <human handle>
created: YYYY-MM-DD
parent_spec: FEAT-XXX
parent_plan: PLAN-FEAT-XXX
---

# Tasks: <feature name>

> Phase 3 output. Decomposes Spec + Plan into granular work units.
> Lives at `.agent-session/<task_id>/tasks.md` in the consumer project (gitignored).
> Format inspired by GitHub Spec Kit. Each task is a unit the orchestrator can dispatch as a Work Packet.

> **Conventions:**
> - `T-XXX` — monotonic task ID
> - `[P]` — parallelizable; orchestrator may fan-out. Two rules **both** required:
>   (a) `Files:` set disjoint from every other `[P]` task in the same phase, AND
>   (b) No `Depends on:` pointing to an incomplete predecessor.
> - `[US-XXX]` — references a user story from the Spec (omit for Setup/Foundational tasks)
> - `Files:` — **exact file paths** (no globs); becomes `scope_files` in the Work Packet
> - `AC covered:` — every AC from the Spec MUST appear in ≥1 task's list; becomes `ac_scope` in the Work Packet
> - `Depends on:` — declares ordering; predecessor must be `done` before this task starts
> - `Estimated complexity:` — small | medium | large (informational; orchestrator may use for `effort` override)
>
> **Sizing guidance (INVEST + Spec Kit):** task = smallest independently testable slice that touches a coherent file set (~1 commit-worth — not 1 file, not 1 module). Target: **5-8 tasks per User Story, ~15-30 total per feature**. >40 tasks suggests splitting the feature.

---

## Setup (optional — pre-story shared scaffolding)

## T-001 [P] <short imperative title>
**Files:** <exact path>, <exact path>
**AC covered:** —
**Estimated complexity:** small

---

## Foundational (optional — cross-story prereqs that block stories)

## T-002 <short imperative title>
**Files:** <exact path>
**AC covered:** <AC-XXX>
**Estimated complexity:** medium

---

## User Story 1 (P1): <story title>

## T-003 [P] [US-001] <short imperative title>
**Files:** <exact path>, <exact path>
**AC covered:** <AC-XXX>, <AC-XXX>
**Estimated complexity:** medium

## T-004 [P] [US-001] <short imperative title>
**Files:** <exact path>
**AC covered:** <AC-XXX>
**Estimated complexity:** small

## T-005 [US-001] <short imperative title>
**Files:** <exact path>, <exact path>
**Depends on:** T-003, T-004
**AC covered:** <AC-XXX>
**Estimated complexity:** large

---

## User Story 2 (P2): <story title>

## T-006 [US-002] <short imperative title>
**Files:** <exact path>
**AC covered:** <AC-XXX>
**Estimated complexity:** medium

---

## Notes

> Optional. Decomposition rationale, sequencing intent, things the orchestrator should know.
