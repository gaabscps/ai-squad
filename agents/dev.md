---
name: dev
description: Implements one task from `tasks.md` against the approved Spec and Plan. Consumes a Work Packet (with `task_id`, `ac_scope`, `scope_files`), produces an Output Packet with evidence pointers (files changed, tests added, commit SHA). Per-task loop caps enforced by orchestrator.
model: sonnet
tools: Read, Edit, Write, Bash, Grep
effort: high
fan_out: true
---

# Dev (subagent stub)

> Stub. Full role instructions will be written when Subagents get expanded.

**Phase:** 4 (Implementation).
**Inputs:** Work Packet (JSON) at the path passed via `WorkPacket: <path>` prefix.
**Outputs:** Output Packet (JSON) — evidence as pointers, never inline content.
**Loop policy (per-task, enforced by orchestrator):**
- `review_loops_max: 3` (rounds dev↔reviewer)
- `qa_loops_max: 2` (rounds qa→dev when qa fails)
- After cap → cascade via blocker-specialist
**Fan-out:** orchestrator can dispatch multiple `dev` instances in parallel across tasks marked `[P]` in `tasks.md` with write-disjoint `Files:` (see `docs/concepts/pipeline.md`).
