---
id: PLAN-FEAT-XXX
status: draft
owner: <human handle>
created: YYYY-MM-DD
parent_spec: FEAT-XXX
---

# Plan: <feature name>

> Phase 2 output. Translates the approved Spec into structural design decisions.
> Lives at `.agent-session/<task_id>/plan.md` in the consumer project (gitignored).
>
> **Convention:** every decision tags the ACs it satisfies inline — `(covers: AC-001, AC-003)`. The AC Coverage Map at the end aggregates and verifies these.

## Architecture decisions

> The "shape" of the implementation. Modules, services, data flow, integration points.
> Tag covered ACs inline.

- <decision> (covers: AC-XXX)
- <decision> (covers: AC-YYY)

## Data model

> Entities, relationships, schemas. Tables, types, or interfaces if helpful.

- <entity>: <fields> (covers: AC-XXX)

If none: `- (none)`

## API surface

> New endpoints, events, contracts. Each item: method/route + brief purpose.

- <method> <route> — <purpose> (covers: AC-XXX)

If none: `- (none)`

## UX / interaction surface (only if Spec has visual surface)

> Screens, components, key states, key flows. High-level — not pixel-perfect mockups.

- <screen/component> — <key state or behavior> (covers: AC-XXX)

If Spec has no visual surface: `- (none — backend-only feature)`

## Dependencies

> What this feature depends on (libraries, services, other features). New deps explicitly listed.

- <dependency>: <why needed>

If none: `- (none)`

## Risks and mitigations

> **Fixed categories** (STRIDE + ATAM lineage). Every category gets at least one entry —
> write `(none — <one-line reason>)` if genuinely no risk in that category. Making the
> consideration explicit is the point; silence is not allowed.

### Security
- Risk: <description>
  - Mitigation: <how>

### Performance
- Risk: <description>
  - Mitigation: <how>

### Migration / data
- Risk: <description>
  - Mitigation: <how>

### Backwards compatibility
- Risk: <description>
  - Mitigation: <how>

### Regulatory / compliance
- Risk: <description>
  - Mitigation: <how>

## Decisions deferred to Implementation

> Things the dev Subagent will decide inline (no need to lock now). Acceptable parking
> for ACs that are too implementation-detail for the Plan layer — but each must justify
> the deferral.

- <decision> (defers: AC-XXX — reason: <one line>)

If none: `- (none)`

## AC Coverage Map

> Required end-of-Plan verification. Every AC from the Spec → Plan section(s) that
> satisfy it. Designer Skill auto-recomputes this on every refinement turn and refuses
> approval if any AC is uncovered.

| AC      | Covered by                              | Notes      |
|---------|-----------------------------------------|------------|
| AC-001  | Architecture decisions, API surface     | <optional> |
| AC-002  | Data model                              | <optional> |
| AC-XXX  | Decisions deferred to Implementation    | (deferred) |

## Notes

> Optional. References, prior art links, diagrams.
>
> **Alternatives considered** (MADR-style — post-hoc, not interactive):
> - Decision: <chosen> — Alternatives considered: <X (rejected because Y)>, <Z (rejected because W)>.
