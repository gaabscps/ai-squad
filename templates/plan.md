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

## Architecture decisions

> The "shape" of the implementation. Modules, services, data flow, integration points.
> Bullet-list, not narrative.

- <decision>
- <decision>

## Data model

> Entities, relationships, schemas. Tables, types, or interfaces if helpful.

- <entity>: <fields>

If none: `- (none)`

## API surface

> New endpoints, events, contracts. Each item: method/route + brief purpose.

- <method> <route> — <purpose>

If none: `- (none)`

## UX / interaction surface (only if Spec has visual surface)

> Screens, components, key states, key flows. High-level — not pixel-perfect mockups.

- <screen/component> — <key state or behavior>

If `Spec has no visual surface`: `- (none — backend-only feature)`

## Dependencies

> What this feature depends on (libraries, services, other features). New deps explicitly listed.

- <dependency>: <why needed>

If none: `- (none)`

## Risks and mitigations

> Known risks (perf, security, migration, backwards compat). Each with planned mitigation.

- Risk: <description>
  - Mitigation: <how>

If none: `- (none)`

## Decisions deferred to Implementation

> Things the dev Subagent will decide inline (no need to lock now).

- <decision>

If none: `- (none)`

## Notes

> Optional. Diagrams, references, prior art links.
