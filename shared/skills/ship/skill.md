---
name: ship
description: Auxiliary cleanup Skill — removes a terminal Session's `.agent-session/<spec_id>/` after human confirmation. Cross-squad (FEAT + DISC); conducts no Phase.
---

# Ship — Session Cleanup (auxiliary)

`/ship <spec_id>` removes a finished Session's runtime trace. It is **not** one of the Phase-conducting Skills — it conducts no Phase, owns no `current_phase`, and writes nothing to `session.yml`. Its whole job: a final read, a confirmation, and `rm -rf .agent-session/<spec_id>/`.

It is **cross-squad**: it cleans both SDD Sessions (`FEAT-NNN`) and Discovery Sessions (`DISC-NNN`), which share the same `.agent-session/` runtime root.

## When to invoke
- `/ship FEAT-NNN` — remove a terminal SDD Session.
- `/ship DISC-NNN` — remove a terminal Discovery Session.
- `/ship` — no argument: list existing Sessions and ask which to clean up.

## Refuse when
- `<spec_id>` given but no Session exists at `.agent-session/<spec_id>/` → message: `"No Session at .agent-session/<spec_id>/. Nothing to clean up."`
- Session exists but `current_phase` is NOT terminal (`done | paused | escalated`) → message: `"Session <spec_id> is in <current_phase> (active). /ship only removes terminal Sessions (done | paused | escalated). To abandon an active Session, restart it via its Phase Skill (e.g. /orchestrator <spec_id>), or wait for it to reach a terminal state."`
- `.agent-session/<spec_id>/session.yml` is unreadable or malformed → message: `"Cannot read .agent-session/<spec_id>/session.yml. Inspect it manually before removing, or delete the directory by hand if you are sure."`

## Inputs (preconditions)
- Existing `.agent-session/<spec_id>/session.yml` with `current_phase ∈ {done, paused, escalated}`.

## Steps

### 1. Resolve `spec_id`
- Invoked with `FEAT-NNN` / `DISC-NNN`: use it directly.
- Invoked with no argument: scan `.agent-session/*/`, read each `session.yml`'s `current_phase` and `last_activity_at`, and present the list (id, phase, last activity). Ask the human which to clean up. If none exist → `"No Sessions in .agent-session/. Nothing to clean up."`

### 2. Verify terminal state (the only guard)
- Read `.agent-session/<spec_id>/session.yml`.
- If `current_phase ∉ {done, paused, escalated}` → refuse per the matrix above. **Do not proceed.** Removing a Session mid-Phase would silently discard in-flight work.

### 3. Final read — show what will be destroyed
Before any deletion, surface a summary so the human can extract anything durable first:
```
About to remove .agent-session/<spec_id>/
  Phase:      <current_phase>
  Planned:    <planned_phases, joined>
  Tasks:      <N total — done / blocked / pending, if present in session.yml>
  Artifacts:  <count of files under outputs/, plus any of spec.md / plan.md / tasks.md / memo.md / report.html present>
```
Remind: `"These artifacts are gitignored and have no durable copy. If you need a permanent record, capture it in your tracker (Jira / PR description / Confluence) before confirming."`

### 4. Confirm
Use `AskUserQuestion` (NOT a free-text gate):
- `Confirm removal` — proceed to step 5.
- `Cancel` — exit, no changes: `"Cancelled. .agent-session/<spec_id>/ left untouched."`

### 5. Remove and suggest next
- `rm -rf .agent-session/<spec_id>/`. The directory is gitignored, so there is no git impact on the consumer repo.
- Suggest the next entry point, branched by prefix:
  - `FEAT-` → `"Session <spec_id> cleaned. To start a new feature: /spec-writer."`
  - `DISC-` → `"Session <spec_id> cleaned. To start a new opportunity: /discovery-lead."`

## What this Skill never does
- **Never writes to `session.yml`.** It only reads, then deletes the whole directory.
- **Never removes a Session in an active Phase** (`specify | plan | tasks | implementation`). That path is Restart, owned by the Phase Skill.
- **Never creates a backup tarball.** The runtime trace is disposable by design; durable records live in the consumer's external tracker.
- **Never runs automatically.** Cleanup is always human-initiated — this preserves the human's control over when the trace is discarded (auto-cleanup risks deleting information still needed; see `shared/concepts/phase.md`).
