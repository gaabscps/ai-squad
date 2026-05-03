# FEAT-001-fake — Worked Example

This folder shows what `.agent-session/<task_id>/` looks like in a consumer project after a complete ai-squad run for a tiny feature ("/health endpoint").

**Purpose:** validates the cross-Phase contract chain (Spec → Plan → Tasks → Implementation) holds together. Read top-down to follow the artifacts each Phase consumes and produces.

**This is the ONLY copy of these artifacts in the ai-squad repo.** In a real consumer project they'd live at `<project>/.agent-session/FEAT-001/` and be gitignored — `/ship FEAT-001` would delete them after handoff.

## Files
- `session.yml` — Phase 1 creates; updated by all subsequent Phases.
- `spec.md` — Phase 1 (Specify) output.
- `plan.md` — Phase 2 (Plan) output.
- `tasks.md` — Phase 3 (Tasks) output.
- `inputs/<dispatch_id>.json` — Work Packets (orchestrator → Subagent).
- `outputs/<dispatch_id>.json` — Output Packets (Subagent → orchestrator).
- `handoff.md` — Phase 4 handoff message (Conventional Commits + 4 sections).

## Validation
Run `scripts/smoke-walkthrough.sh` from the repo root to verify all files parse and cross-references resolve.
