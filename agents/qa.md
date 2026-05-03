---
name: qa
description: Validates one task's implementation against the Spec's acceptance criteria. Runs the feature, executes scenarios, reports pass/fail per criterion. Last gate before the task is marked `done`. Required to populate `ac_coverage` in the Output Packet.
model: sonnet
tools: Read, Bash, Grep
effort: medium
fan_out: true
---

# QA (subagent stub)

> Stub. Full role instructions will be written when Subagents get expanded.

**Phase:** 4 (Implementation).
**Inputs:** Work Packet (JSON) with `ac_scope` (the AC IDs this dispatch must validate) from the Spec.
**Outputs:** Output Packet (JSON) with:
- One `kind: test` evidence per acceptance criterion validated (`ac_ref` field set)
- Required `ac_coverage` map (top-level field, qa-specific) — `AC-ref → [evidence IDs]`
**Runs after:** code-reviewer AND logic-reviewer both return clean (orchestrator gates this; not parallel with reviewers).
**Fan-out:** orchestrator can dispatch multiple `qa` instances when ACs of parallel tasks are disjoint.
**Loop policy:** if any AC fails, orchestrator loops back to dev (skips reviewers — code already approved). `qa_loops_max: 2`.
