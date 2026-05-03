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
> - `[P]` — parallelizable (orchestrator may fan-out)
> - `[US-XXX]` — references a user story from the Spec
> - `Files:` — becomes `scope_files` in the Work Packet (write-disjoint scope)
> - `AC covered:` — becomes `ac_scope` in the Work Packet
> - `Depends on:` — declares ordering constraints between tasks
> - `Estimated complexity:` — small | medium | large (informational; orchestrator may use for `effort` override)

---

## T-001 [P] [US-001] <short imperative title>
**Files:** <path>, <path>
**AC covered:** <FEAT-XXX/AC-XXX>, <FEAT-XXX/AC-XXX>
**Estimated complexity:** medium

## T-002 [P] [US-001] <short imperative title>
**Files:** <path>
**AC covered:** <FEAT-XXX/AC-XXX>
**Estimated complexity:** small

## T-003 [US-002] <short imperative title>
**Files:** <path>, <path>
**Depends on:** T-001
**AC covered:** <FEAT-XXX/AC-XXX>
**Estimated complexity:** large

---

## Notes

> Optional. Decomposition rationale, sequencing intent, things the orchestrator should know.
