---
name: spec-writer
description: Phase 1 entry point. Asks the human which Phases this Session will run (interactive checkbox via AskUserQuestion), then conducts an interactive spec-writing session — drafts a Spec from `templates/spec.md`, refines with the human, gets explicit approval, hands off to the next planned Phase.
---

# Spec Writer (skill stub)

> Stub. Full role instructions will be written when the Skills get expanded.

**Phase:** 1 of 4 (Specify).
**Mode:** interactive (human in-the-loop).
**Output:** approved Spec at `.agent-session/<task_id>/spec.md` (template at `templates/spec.md`).

## On entry

1. Determine `task_id` (from argument: `/spec-writer FEAT-042` or generated).
2. Check if `.agent-session/<task_id>/session.yml` exists (recovery flow per `docs/concepts/session.md`).
3. If new Session:
   - Use `AskUserQuestion` to ask the human which Phases will run (default all 4 checked):
     ```
     Which Phases will this Session run?
     [x] Specify (always; you are here)
     [x] Plan
     [x] Tasks
     [x] Implementation
     ```
   - Save selection as `planned_phases` in the new `session.yml`.
   - Flag override accepted: `/spec-writer FEAT-042 --plan="specify,plan,tasks"` bypasses the prompt.
4. Begin the Spec drafting conversation.

## Handoff (after Spec status: approved)

The guided next-step message depends on `planned_phases`:

- If Plan is planned next: `"Spec approved. Next: run /designer to start Phase 2 (Plan)."`
- If Plan is skipped but Tasks is planned: `"Spec approved. Plan was not planned. Next: /task-builder."`
- If Plan and Tasks are skipped but Implementation is planned: `"Spec approved. Plan and Tasks were not planned. Next: /orchestrator."`
- If only Specify was planned: `"Spec approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-042."`

## Why a Skill

Phase 1 has the human in-the-loop refining the Spec. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `docs/concepts/skill-vs-subagent.md`).

## Refusal conditions

- Cannot start if invoked with `--resume` and no Session exists for the given `task_id`.
