---
id: FEAT-XXX
status: draft
owner: <human handle>
created: YYYY-MM-DD
# parent_spec: FEAT-YYY    # optional; uncomment if this Spec depends on another
---

# Spec: <feature name in plain English>

## Problem

> One paragraph. What is the problem? Who has it? Why now?

<replace this with the problem statement>

## Goal

> One sentence. What does success look like?

<replace this with the goal>

## User Scenarios

> P1, P2, P3 priority. Each scenario is independently shippable and testable.
> Use EARS notation for acceptance criteria. See `../docs/concepts/spec.md` for the cheat sheet.

### US-001 [P1] — <short title>

**As a** <role>, **I want** <capability>, **so that** <outcome>.

**Independent test:** <how this scenario can be validated alone, without P2/P3 being implemented>.

**Acceptance Criteria (EARS):**

- AC-001: WHEN <trigger> THE SYSTEM SHALL <action>
- AC-002: WHILE <state> THE SYSTEM SHALL <continuous behavior>
- AC-003: IF <unwanted condition> THEN THE SYSTEM SHALL <mitigation>

### US-002 [P2] — <short title>

**As a** <role>, **I want** <capability>, **so that** <outcome>.

**Independent test:** <…>.

**Acceptance Criteria (EARS):**

- AC-XXX: WHEN <…> THE SYSTEM SHALL <…>

## Non-functional Requirements

> Each NFR is measurable + has a verification method.

- NFR-001: <measurable threshold> (verified by <how>)
- NFR-002: <…>

If none: `- (none)`

## Success Criteria

> Outcome metrics, measured **post-launch** (distinct from acceptance criteria).

- SC-001: <measurable outcome with target>
- SC-002: <…>

If none: `- (none)`

## Out of Scope

> Explicit. What this Spec deliberately does NOT address.
> Empty allowed; missing not allowed.

- <thing this Spec deliberately does NOT cover>

If none: `- (none)`

## Constraints

> Non-negotiable technical or business constraints.

- Stack: <fixed tech the implementation must use>
- External: <APIs, services, integrations that bound the design>
- Other: <regulatory, deadline, etc>

If none: `- (none)`

## Assumptions

> What this Spec assumes about the world. If an assumption is wrong, the Spec is wrong.

- <assumption>

If none: `- (none)`

## Open Questions

> `[NEEDS CLARIFICATION]` items. **Hard cap: 3.** All must be resolved (deleted) before `status` moves from `draft` to `approved`.

- [NEEDS CLARIFICATION] <question>

If none: `- (none)`

## Notes

> Optional. Links, prior art, references.
