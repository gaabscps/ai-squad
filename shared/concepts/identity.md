# Identity — canonical identifiers across ai-squad

Single source of truth for how **every** component (schema, hooks, agents,
skills, the audit-agent, the manifest, `session.yml`) refers to a feature, a
task, and a dispatch.

Before this doc the vocabulary was inconsistent:
- `task_id` was **overloaded** — it meant `FEAT-NNN` (the feature) in
  `session.yml` / manifest top-level / audit Work Packet, AND `T-XXX` (one task)
  in manifest entries / Work Packets.
- The feature had **three names**: `task_id`, `spec_id`, `session_id`.

That ambiguity caused the FEAT-010 audit false-positive (the audit-agent required
a `task_id` the schema did not permit; the orchestrator "fixed" packets into
schema violations). This doc fixes the vocabulary. Everything conforms to it.

## The three identifiers

| Identifier    | Concept                                          | Format                          | Example         |
|---------------|--------------------------------------------------|---------------------------------|-----------------|
| `spec_id`     | The feature / Session (one SDD or Discovery run) | `FEAT-NNN` (sdd) `DISC-NNN` (disc) | `FEAT-010`   |
| `task_id`     | One task within the feature                      | `T-XXX`                         | `T-001`         |
| `dispatch_id` | One Subagent dispatch (a single `Task` call)     | `d-<task>-<role>-l<loop>` or uuid | `d-T-001-cr-l2` |

## Golden rule

- `task_id` is **ALWAYS** `T-XXX`. It NEVER holds a `FEAT-NNN`.
- The feature/Session is **ALWAYS** `spec_id`. Never `task_id`, never `session_id`.
- `dispatch_id` is the unique dispatch; `outputs/<dispatch_id>.json` is keyed by it.

## Where each appears

- **Session directory:** `.agent-session/<spec_id>/` — the dir **name** is the
  `spec_id` (`FEAT-NNN`). This is the runtime source of truth for the active
  Session id; hooks derive it from the dir name, not from a field.
- **`session.yml`:** `spec_id: FEAT-NNN` (was `task_id`).
- **Work Packet** (orchestrator → subagent input): `spec_id` + `task_id`
  (`T-XXX`, the task this dispatch works on) + `dispatch_id`.
- **Output Packet** (subagent → orchestrator): `spec_id` + `dispatch_id` +
  `role`, plus `task_id` (`T-XXX`) **for task-scoped roles**. Pipeline-scoped
  roles (`audit-agent`, `committer`) carry no `task_id` — they have no single task.
- **`dispatch-manifest.json`:** top-level `spec_id` (was `task_id: FEAT-NNN`);
  each `expected_pipeline[]` / `actual_dispatches[]` entry has `task_id`
  (`T-XXX`, or `null` for the pipeline-scoped audit-agent entry) + `dispatch_id`
  + `role`.

## Role → identifier scope

| Role                                                     | `spec_id` | `task_id` (`T-XXX`) | `dispatch_id` |
|----------------------------------------------------------|:---------:|:-------------------:|:-------------:|
| dev, code-reviewer, logic-reviewer, qa, blocker-specialist |    ✓    |          ✓          |       ✓       |
| audit-agent (pipeline-scoped)                            |     ✓     |          —          |       ✓       |
| committer (post-handoff, spec-scoped)                    |     ✓     |          —          |       ✓       |

## Migration (legacy → canonical)

- `task_id: FEAT-NNN` (session.yml, manifest top, audit Work Packet) → `spec_id`.
- `session_id` (Work Packet) → `spec_id`.
- Output Packets of task-scoped roles **gain** `task_id: T-XXX` (was absent; the
  audit-agent wrongly required it against a schema that forbade it).
- **Read-compat:** hooks accept a legacy `task_id` matching `^(FEAT|DISC)-` as an
  alias for `spec_id` so in-flight Sessions created before the rename keep
  working. All writers emit the canonical names only.
