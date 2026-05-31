# Approval gates (per-phase artifact acceptance)

Referenced from `skill.md` (Autonomous approval protocol). Run the matching gate **before** writing `status: approved` to a phase artifact. If any check fails, return a **specific** finding to the originating phase Skill and let it iterate — never accept "we'll fix it in the next phase", never return a vague "improve".

## Spec gate (Phase 1 output)
- Every Acceptance Criterion is atomic, testable, numbered. No compound ACs ("X and Y").
- No hand-wave phrases ("user-friendly", "fast", "robust", "scalable") without a measurable definition.
- Edge cases enumerated for each user-facing flow (empty state, error state, concurrent action, partial failure).
- Out-of-scope section is **explicit**, not absent. Anything ambiguous in scope is named.
- Non-functional constraints (perf, security, compliance, observability) called out where applicable.

Reject → return to `/spec-writer` with the specific gap.

## Plan gate (Phase 2 output)
- Every AC from the Spec maps to a Plan section.
- Architecture decisions justified with **a trade-off**, not asserted. "We chose X" must include "instead of Y, because Z".
- Concurrency / persistence / failure modes addressed for every stateful operation.
- External dependencies (libs, services) chosen with explicit rationale; never "use X because it's popular".
- Risks enumerated with mitigation; risks deferred to "later" are blocker findings.

**Higher bar for T4 technical decisions in the Plan.** For any Plan decision touching a domain invariant, concurrency model, security mechanism, data migration, or public contract (anything that would classify a downstream task as T4):
- Do a dedicated research dispatch (Anthropic docs / Claude Code docs / industry literature / existing repo precedent) — a structured pass, not a quick lookup.
- Produce a mini options table in the Plan section (≥2 alternatives + one-line trade-off each) and an explicit "Chosen: X — because Y, accepting trade-off Z" line.
- Only after this artifact exists in the Plan does the gate pass for that decision.

This is the PM's own discipline, not a new escalation path — `blocker-specialist` is the cascade handler for stuck Subagents during Phase 4, not an advisor for PM decisions.

Reject → return to `/designer` with the specific gap.

## Tasks gate (Phase 3 output)
- Every task has `AC covered:` populated (non-empty) — becomes `ac_scope` in the Work Packet.
- Every Spec AC appears in **at least one** task's `AC covered:`.
- `Files:` write-disjoint across `[P]` tasks in the same phase.
- Every task carries a `Tier:` line (T1 | T2 | T3 | T4) — see classification in `skill.md`.
- No "miscellaneous", "cleanup", or "polish" tasks without an explicit AC reference.

Reject → return to `/task-builder` with the specific gap.
