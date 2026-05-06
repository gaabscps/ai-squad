# ai-squad — Glossary

The canonical vocabulary. Every other doc and `skill.md`/`agent.md` in this repo must use these terms exactly. If you need a new term, add it here first.

> Convention legend: `[platform]` = inherited from Claude Code / Claude Agent SDK. `[ours]` = defined by ai-squad. `[industry]` = follows industry consensus (Anthropic Building Effective Agents, GitHub Spec Kit, etc).

---

## Core

**Role** `[ours]`
The unit of responsibility in the squad. **10 canonical Roles**: `spec-writer`, `designer`, `task-builder`, `orchestrator` (4 Skills, one per Phase), and `dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`, `audit-agent` (6 Subagents, all in Phase 4). Closed set; not extensible by host projects. One Role = one file. Full structure in [`shared/concepts/role.md`](concepts/role.md).

**Skill** `[platform]`
A `.md` file under `skills/{name}/skill.md` with YAML frontmatter. Runs in the **main session** (sees the human, can dispatch subagents). In ai-squad, the 4 Skills are `spec-writer` (Phase 1), `designer` (Phase 2), `task-builder` (Phase 3), and `orchestrator` (Phase 4). Invoked by the human via slash command (`/spec-writer`, `/designer`, `/task-builder`, `/orchestrator`). Slim frontmatter (`name`, `description`); `model`/`effort` inherited from the human's session.

**Subagent** `[platform]`
A `.md` file under `agents/{name}.md` with YAML frontmatter. Runs in an **isolated context** (does not see the parent's conversation; cannot spawn its own subagents). Invoked by the parent via the `Agent` tool, returns only a final summary. In ai-squad, the 6 Subagents are `dev`, `code-reviewer`, `logic-reviewer`, `qa`, `blocker-specialist`, `audit-agent` — all live in Phase 4. Rich frontmatter (`name`, `description`, `model`, `tools`, `effort`, `fan_out`).

**Effort** `[platform]`
Reasoning budget per agent: `low | medium | high | xhigh | max`. Set in a Subagent's frontmatter (Skills inherit from the human's session). `xhigh` is Opus 4.7 only. ai-squad calibration: `code-reviewer` / `qa` = sonnet + medium; `dev` = sonnet + high; `logic-reviewer` = **opus** + high; `blocker-specialist` = opus + xhigh; `audit-agent` = haiku + medium (mechanical reconciliation, low quota); the 4 Skills inherit. Override per dispatch via Work Packet's `effort` field. Full reasoning in [`shared/concepts/effort.md`](concepts/effort.md).

---

## Contracts

**Spec** `[ours]`
The approved feature specification produced in Phase 1. Single Markdown file at `.agent-session/<task_id>/spec.md` (gitignored on the consumer project), written from `squads/sdd/templates/spec.md`. **The contract between the human and the squad.** Once `status: approved`, it is consumed read-only by Phases 2–4. Uses **EARS** notation for acceptance criteria. Numbered IDs (`US-XXX`, `AC-XXX`, `NFR-XXX`, `SC-XXX`) provide forward traceability — referenced by the Plan, the Tasks file, Work Packets, and Output Packets. Full structure and lifecycle in [`squads/sdd/docs/concepts/spec.md`](../squads/sdd/docs/concepts/spec.md).

**Plan** `[ours]`
Phase 2 output. Single Markdown file at `.agent-session/<task_id>/plan.md`, written from `squads/sdd/templates/plan.md`. Translates the approved Spec into structural design decisions (architecture, data model, API surface, UX surface if applicable, dependencies, risks). Frontmatter carries `id` (`PLAN-FEAT-XXX`), `status`, `parent_spec`. Once `status: approved`, consumed read-only by Phases 3–4.

**Tasks** `[ours]`
Phase 3 output. Single Markdown file at `.agent-session/<task_id>/tasks.md`, written from `squads/sdd/templates/tasks.md`. Decomposes Spec + Plan into granular work units (`T-XXX [P] [US-XXX]` + `Files:` + `AC covered:` + optional `Depends on:`). Format inspired by GitHub Spec Kit. The orchestrator reads this file in Phase 4 and emits Work Packets from approved tasks. Once `status: approved`, consumed read-only by Phase 4.

**Work Packet** `[ours]`
JSON file written by the orchestrator to `.agent-session/<task_id>/inputs/<dispatch_id>.json`. Top-level fields: `spec_id`, `dispatch_id`, `spec_ref`, `to_role`, `objective`, optional `ac_scope`, `scope_files`, `input_refs`, `constraints`, `project_context`, `model`/`effort` overrides, `max_loops`, `previous_findings`. Passed to the Subagent via the convention `WorkPacket: <path>` in the `Agent` tool prompt. **Minimal handoff** — pointers only, never inline content. Symmetric to Output Packet (same `dispatch_id`, mirrored FS layout). Full schema in [`shared/concepts/work-packet.md`](concepts/work-packet.md).

**Output Packet** `[ours]`
JSON file emitted by a Subagent, written to `.agent-session/<task_id>/outputs/<dispatch_id>.json`. Top-level fields: `spec_id`, `dispatch_id`, `role`, `status` (enum), `summary`, `evidence[]`, `findings[]`, `blockers[]`, optional `next_role` (suggestion). For `qa` only: `ac_coverage`. The Subagent's textual return to its parent is just `OutputPacket: <path>`. Validation gate in the orchestrator rejects malformed packets. Full schema in [`shared/concepts/output-packet.md`](concepts/output-packet.md).

**Evidence** `[industry]`
A typed pointer to verifiable proof, attached to Output Packets. Closed enum of 7 `kind`s: `file | command | commit | test | log | url | absence`. Subagents write evidence to the filesystem (consumer project's repo files for code; `.agent-session/<task_id>/` for ephemera) and reference it by pointer. **Never inline content** (anti-context-pollution). Cap of 50 evidences per Output Packet — orchestrator aggregation is uncapped (Skills don't emit Output Packets). Full schema per kind in [`shared/concepts/evidence.md`](concepts/evidence.md).

**Status enum** `[industry]`
Output Packet `status` is one of: `done | needs_review | blocked | escalate`. No prose status. The orchestrator routes purely on this enum. `done` advances; `needs_review` loops back to prior Role; `blocked` dispatches `blocker-specialist`; `escalate` (emitted in practice only by `blocker-specialist`) stops the Pipeline and hands off to human. Detailed semantics in [`shared/concepts/output-packet.md`](concepts/output-packet.md#status-enum-semantics).

---

## Flow

**Phase** `[ours]`
The squad has exactly **4 Phases**: **Specify → Plan → Tasks → Implementation**. The first 3 are AI-driven with the human in-the-loop (one Skill conducts each); the 4th is fully autonomous (orchestrator dispatches the 6 Subagents). Each Phase has an explicit transition gate: human approves the artifact (`status: approved`) and the Skill auto-advances to the next planned Phase. Phase 4 ends with a one-shot handoff (gated by audit-agent). Full structure in [`shared/concepts/phase.md`](concepts/phase.md).

**Pipeline** `[ours]`
The deterministic workflow graph the orchestrator executes inside Phase 4 only. Canonical sequence:
```
orchestrator → dev (fan-out per [P] tasks) → (code-reviewer ‖ logic-reviewer) → qa → handoff
```
Routes purely on Output Packet `status` enum + `findings[]` (no prose interpretation). Reconciliation is **all-must-pass** (any failure stops advancement). Loops dev↔reviewer cap at 3 rounds + hash-based progress detection (early escalation if no progress between iterations). Reviewer conflicts → arbitration by `blocker-specialist`. Phases 1–3 are not "Pipelines" — they are linear human↔Skill interaction. Full workflow graph, fan-out rules, routing truth-table, handoff format, and anti-patterns in [`squads/sdd/docs/concepts/pipeline.md`](../squads/sdd/docs/concepts/pipeline.md).

**Escalation** `[ours]`
The path back to the human from Phase 4. **Operates per-task (async)** — one task escalating does not block parallel tasks. 4 canonical triggers: `status: blocked` from any Subagent; conflict between reviewers; loop cap exceeded; progress stall (no-progress hash detection). Cascade is fixed: trigger → `blocker-specialist` always first → if specialist returns `status: escalate`, task enters `pending_human` terminal state. Other tasks continue. Loop caps (industry-validated, per-task): `review_loops_max: 3`, `qa_loops_max: 2`, `blocker_calls_max: 2`. Final handoff aggregates mixed outcomes (done + pending_human) and shows escalation rate. Full mechanics in [`squads/sdd/docs/concepts/escalation.md`](../squads/sdd/docs/concepts/escalation.md).

**Escalation rate** `[ours]`
Observational health metric — fraction of tasks that end in `pending_human` instead of `done`, observed per Pipeline run and (future) cumulative across runs. Healthy range: **10–15%** (industry guidance, Galileo). Below 5% suggests under-escalation (issues slip through); above 25% suggests systemic issue (typically vagueness amplification in Specs). Surfaced in handoffs (mid-Pipeline blocker notes and final handoff). Not enforced — diagnostic for the human.

**Session** `[ours]`
The runtime persistent state of one feature in flight. Single YAML file at `.agent-session/<task_id>/session.yml` (gitignored on the consumer project). Tracks `current_phase` (`specify | plan | tasks | implementation | paused | done | escalated`), `current_owner` (which Role has write authority), `planned_phases` (array set at /spec-writer entry via `AskUserQuestion`), per-task state, loop counters, hashes for progress detection, escalation metrics, `phase_history`. Updated via atomic write (tmp + rename). Ownership is exclusive per Phase (Subagents never write). Multi-session permitted (one feature per `task_id`). Recovery flow on Skill invocation always interactive (resume / restart / cancel). Removed by `/ship FEAT-XXX`. Full schema, lifecycle, and recovery semantics in [`shared/concepts/session.md`](concepts/session.md).

**Planned Phases** `[ours]`
Array stored in `session.yml` listing which of the 4 Phases the human selected to run for this Session. Selected at `/spec-writer` entry via `AskUserQuestion` (default: all 4 checked); flag override `/spec-writer FEAT-XXX --plan="specify,plan,tasks"` available. Each subsequent Skill verifies its own Phase is in the list before proceeding. Skipping any Phase (including Implementation) is supported — Session enters `paused` terminal-but-resumable state after the last planned Phase. Enables "plan now, execute later" workflows. Mid-Session edits supported (human edits the array in `session.yml`). Detailed in [`shared/concepts/session.md`](concepts/session.md) and [`shared/concepts/phase.md`](concepts/phase.md).

---

## What ai-squad is NOT

- **Not a generic agent framework.** It is opinionated about SDD with a fixed pipeline of named Roles. Need a different topology? Use the Claude Agent SDK directly.
- **Not a multi-agent orchestrator across sessions.** Everything runs inside one Claude Code main session per task.
- **Not a project rules engine.** Project-specific patterns, naming, and conventions stay in the host project's `CLAUDE.md` and rules files. The squad reads them; it does not own them.
- **Not human-in-the-loop in the middle of Phase 4.** Humans intervene during Phases 1–3 (Skill sessions) and at handoff/escalation. Once Phase 4 starts, humans stay out until handoff.
- **Not a replacement for tests/CI.** `qa` validates acceptance criteria; it does not replace the host project's test suite or CI pipeline.
- **Not a long-term documentation system.** Spec/Plan/Tasks live in `.agent-session/` (gitignored) and are removed by `/ship` after handoff. Persistent tracking belongs in Jira/ClickUp/GitHub PR descriptions — wherever the consumer project already tracks features.
