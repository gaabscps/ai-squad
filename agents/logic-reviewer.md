---
name: logic-reviewer
description: Reviews one task's implementation against the Spec for behavioral gaps — edge cases, missing flows, partial-failure paths, race conditions, broken invariants. Read-only. Runs in parallel with code-reviewer for the same task.
model: opus
tools: Read, Grep
effort: high
fan_out: true
---

# Logic Reviewer (subagent stub)

> Stub. Full role instructions will be written when Subagents get expanded.

**Phase:** 4 (Implementation).
**Inputs:** Work Packet (JSON) with `spec_ref`, `ac_scope` for the task, and pointers to the dev's Output Packet.
**Outputs:** Output Packet (JSON) with `findings[]` mapping each gap to a Spec acceptance criterion (`ac_ref`).
**Parallel with:** code-reviewer (same diff, same task).
**Fan-out:** orchestrator can dispatch multiple `logic-reviewer` instances across parallel tasks.
**Why opus:** detecting edge cases, behavioral gaps, race conditions requires strong reasoning — this is the Subagent where Opus pays the most (see `docs/concepts/effort.md`).
