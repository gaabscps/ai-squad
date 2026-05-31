---
name: spec-writer
description: Phase 1 (Specify) entry point for the SDD pipeline. Interactively turns a feature pitch into an approved Spec — creates the Session, generates the spec_id, collects planned_phases / pipeline_mode / output_locale intent, drafts and refines spec.md, and hands off to the next planned Phase. Use when running `/spec-writer` to start a fresh feature, or `/spec-writer FEAT-NNN` to resume an existing Spec session.
---

# Spec Writer — Phase 1 (Specify)

The Skill that turns a feature request into an approved Spec, working interactively with the human. Owns Session creation, `spec_id` generation, and `planned_phases` selection.

Detailed procedures live in flat reference files next to this one — read each when you reach the step that points to it:
- [`intent-collection.md`](intent-collection.md) — `planned_phases` / `pipeline_mode` / `output_locale` prompts + save mechanics (steps 2, 2.5, 2.6)
- [`pm-approval-gate.md`](pm-approval-gate.md) — PM-bypass approval procedure + `pm_decision` shape (step 6.5)
- [`failure-modes.md`](failure-modes.md) — abandonment / timeout / partial-write behavior + design rationale

## Hard rule — fresh-start mode is ALWAYS interactive (read this BEFORE step 1)

**This Skill NEVER infers `auto_approved_by: pm`, `pipeline_mode`, or `planned_phases` from prior `.agent-session/FEAT-XXX/session.yml` files.** Period.

- PM bypass (`auto_approved_by=pm`) is set EXCLUSIVELY by the `/pm` Skill when IT invokes this Skill in the same turn. If you are reading this in response to a direct `/spec-writer` user invocation, PM bypass is **OFF**, regardless of what any prior Session in `.agent-session/` looks like.
- Reading prior `session.yml` files is allowed ONLY for one purpose: computing the next `FEAT-NNN` increment (step 1). Any other field — `auto_approved_by`, `pipeline_mode`, `planned_phases`, `phase_history`, `notes` — MUST NOT influence the current Session's behavior.
- If you find yourself reasoning "the last 3 Sessions in this repo had `auto_approved_by: pm`, so I'll do the same" — STOP. That reasoning is forbidden. The user's intent for *this* invocation is the only authority. Run `AskUserQuestion` for steps 2 and 2.5 regardless.
- A human running `/spec-writer` directly expects to be asked questions. Skipping them silently breaks trust and removes their control over scope. There is no shortcut here, even if a prior Session looked "similar".

This rule supersedes any pattern-matching the model performs on the repo history. Treat it as a precondition for entering step 1.

## When to invoke
- `/spec-writer` — fresh start (creates new Session, auto-generates `spec_id`).
- `/spec-writer "<feature pitch>"` — fresh start with the human's pitch as first input.
- `/spec-writer FEAT-NNN` — resume an existing Spec session.
- `/spec-writer FEAT-NNN --plan="specify,plan,tasks"` — power-user flag override of the interactive checkbox.
- `/spec-writer FEAT-NNN --locale="pt-BR"` — power-user flag override of the interactive locale confirmation (BCP-47, hyphen).

## Refuse when
- Invoked with `FEAT-NNN` and no Session exists at `.agent-session/<spec_id>/` → message: `"No Session at .agent-session/<spec_id>/. Start fresh with /spec-writer (no task_id)."`
- Existing Session is in terminal state (`current_phase: paused | done | escalated`) → message: `"Session <spec_id> is <state>. Run /ship FEAT-NNN to clean up, or /orchestrator FEAT-NNN --resume to continue Phase 4."`
- `.agent-session/` exists but is NOT in repo's `.gitignore` → message: `"`.agent-session/` must be gitignored. Add it to .gitignore before continuing."`
- `session.yml` has `schema_version` higher than what this Skill knows → message: `"Session schema_version <N> is newer than this Skill's <M>. Upgrade ai-squad before continuing."`

## Inputs (preconditions)
- Fresh start: none (this Skill creates the Session).
- Resume: existing `.agent-session/<spec_id>/session.yml` with `current_phase: specify`.

## Steps

### 1. Resolve `spec_id` and Session
1. If invoked with explicit `FEAT-NNN`: use it; check Session existence (resume vs refuse per matrix).
2. If no explicit `spec_id`: scan `.agent-session/FEAT-*/` directories, increment from highest existing → new `FEAT-NNN` (3-digit zero-padded; expand to 4 digits past `FEAT-999`).
3. Verify `.agent-session/` is in `.gitignore` (refuse if not).
4. **Read constraint (per the top-of-file Hard rule):** when scanning prior `FEAT-*/` directories for step 2 above, the ONLY field you may read from any prior `session.yml` is the directory/file name itself for ID computation. Do NOT open prior `session.yml` content. Do NOT inspect `auto_approved_by`, `pipeline_mode`, `planned_phases`, `phase_history`, or `notes` from any prior Session. Treat prior `.agent-session/FEAT-*/` directories as opaque ID markers, nothing else. If you need any other state from a prior Session, that's a `--resume` flow (item 1 above) on that specific FEAT-ID — never an inference from history.

### 2–2.6. Collect intent: `planned_phases`, `pipeline_mode`, `output_locale` (fresh start only)

**MANDATORY — all three run on every fresh-start invocation. NEVER skipped by PM bypass.** These are user intent, not automatable inferences. PM bypass (`auto_approved_by=pm`, detected at step 6.5) governs APPROVAL gates only (steps 6.5 and 7) — it does NOT cover intent collection. If you find yourself about to auto-pick any of the three from a prior Session or from how the feature "looks": STOP and run `AskUserQuestion` regardless.

Run, in order: step 2 (`planned_phases`, checkbox), step 2.5 (`pipeline_mode`, binary), step 2.6 (`output_locale`, detect + confirm). Full prompt text, defaults, save mechanics, and `--plan` / `--mode` / `--locale` flag overrides: [`intent-collection.md`](intent-collection.md). Each selection is an atomic write (tmp + rename) to `session.yml`.

### 3. Capture initial pitch (if not provided)
If the human didn't pass a pitch in the invocation, ask in chat (free-form, generative — not `AskUserQuestion`): `"What's the feature? One paragraph — problem, who it's for, what success looks like."`

### 4. Generate first draft (Hybrid drafting — Spec Kit style)
Produce a full draft of `spec.md` from the bundled template `spec.template.md` (in this skill's base directory — the "Base directory for this skill" path shown on activation), populated from the pitch:
- Fill all sections you can confidently infer (Problem, Goal, Constraints, Notes).
- For uncertain sections: insert `[NEEDS CLARIFICATION] <specific question>` markers (hard cap: 3 — see step 5).
- Generate at least one `US-001 [P1]` from the pitch.
- **Lite mode constraint** (`session.yml.pipeline_mode == "lite"`): generate **exactly one** `US-001 [P1]`. If the pitch implies multiple stories, surface this via chat: `"Lite mode allows only one US. The pitch suggests N stories — pick the most important one for this Session, or switch to standard mode."` Standard mode: 1-3 USs as appropriate from the pitch.
- **Edge-case coverage (mandatory):** for every US-XXX with code-touching ACs, enumerate ACs covering all four categories: **empty state**, **error state**, **concurrent action**, **partial failure**. If a category is genuinely N/A for a US, write `AC-NNN: N/A — <one-line reason>` explicitly (silent omission becomes a finding in step 6.4).
- Write to `.agent-session/<spec_id>/spec.md` (atomic write; `status: draft`).
- Save Spec title to `session.yml.feature_name` for human-readable reference.

### 5. Clarification pass (one ambiguity at a time)
For each `[NEEDS CLARIFICATION]` (max 3 — if more would emerge, ask the human to pick the 3 most important; the rest become `## Open Questions` entries):
- **Research dispatch trigger:** if the clarification touches **external API integration**, **concurrency / race conditions**, **security mechanisms** (auth, sessions, secrets, crypto), or **data migration**, dispatch an `Explore` agent (single research pass — one dispatch, synthesize, decide; do NOT loop) BEFORE asking the human. Check how Anthropic / Claude Code / industry literature treats the case. The research result becomes evidence in the spec's `## Constraints` or `## Notes` section. Skip this trigger for purely UX/copy/scope questions.
- Use `AskUserQuestion` with 2-3 enumerable resolution options + an "Other" free-form fallback. Options should reflect research findings when applicable.
- On answer: replace the marker with the resolved text; atomic write `spec.md`.
- When all resolved: proceed to step 6.

### 6. Section-by-section refinement (only when the human asks)
The human may want to refine any section. Conventions for picking the right tool:
- Enumerable decision (priority P1/P2/P3, "Add another US?" yes/no, pick from 2-3 options) → `AskUserQuestion`.
- Generative decision (rewrite a US's prose, refine a Constraint's wording) → free-form chat.
- After every accepted change to a major section (Problem, Goal, any US, NFR, SC): atomic write of the full `spec.md`.

### 6.4. Logic-gap sweep (mandatory — runs before 6.5 and 7)

Before any approval path, the spec-writer MUST perform an explicit self-critique sweep. This is the single highest-leverage step for shortening Phase 4 wall-clock: every gap caught here saves a `review_loops_max=3` or `qa_loops_max=2` cascade downstream.

Answer each item literally (do not skip):

1. **What would reviewer / QA flag?** Imagine the `code-reviewer`, `logic-reviewer`, and `qa` subagents reading this spec. What ambiguities, missing ACs, or under-specified edge cases would they cite? List concretely.
2. **Edge-case coverage** — confirm every US-XXX with code-touching ACs has ACs for **empty / error / concurrent / partial-failure** OR explicit `N/A — <reason>`.
3. **Out of Scope explicit** — anything a reasonable reviewer might assume is in scope but is NOT must be named. Silent exclusion is a gap.
4. **Non-functional constraints** — perf, security, compliance, observability called out where applicable. "Fast" / "secure" / "scalable" without a measurable definition is a gap.
5. **Term definitions** — every domain term used in ACs must be defined (in `## Notes` or inline). Undefined terms cause downstream agents to guess.

If the sweep finds gaps: patch `spec.md` inline (atomic write), re-run the sweep until zero gaps remain. Gaps are RESOLVED in the spec, never deferred to follow-ups. Only after zero gaps remain proceed to step 6.5 (PM mode) or step 7 (human mode).

### 6.5. PM-mode approval gate check (bypass — runs before Step 7)
Read `session.yml.auto_approved_by`. If it is not exactly `"pm"`, proceed to the interactive gate (step 7). If it IS `"pm"`, run the full bypass procedure — open-marker refusal, escalation record, the strict approval ordering invariant (evidence before artifact), partial-write repair path, and `current_phase` advancement — per [`pm-approval-gate.md`](pm-approval-gate.md). That reference is the verbatim insertion mandated by `shared/concepts/pm-bypass.md`; follow it exactly.

### 7. Final approval gate (Hybrid: checklist + AskUserQuestion)
Trigger when the human signals "done" OR when zero `[NEEDS CLARIFICATION]` markers remain AND at least one `US-XXX` is present:
1. Print a visual checklist summary (Spec Kit pattern):
   ```
   Spec ready for approval:
   [x] Problem stated
   [x] Goal stated
   [x] N User Stories (P1: X, P2: Y, P3: Z)
   [x] N NFRs / N Success Criteria
   [x] Out of Scope explicit
   [x] Zero NEEDS CLARIFICATION items
   ```
2. Use `AskUserQuestion` with binary choice (Kiro pattern — explicit affirmative mandated):
   ```
   Approve this Spec?
   [ ] Yes, approve and proceed
   [ ] No, more changes needed
   ```
3. On `Yes`: set `status: approved` in `spec.md` frontmatter (atomic write); update `session.yml` (`current_phase` advances per `planned_phases`); populate `phase_history.specify`.
4. On `No`: return to step 6.

## Output
- Path: `.agent-session/<spec_id>/spec.md` (template: `spec.template.md` in this skill's base directory).
- Status field: `draft` → `approved` (no `in-progress` mid-state).
- Atomic write: tmp + rename, on every accepted section change AND on final approval.
- Session updates: `session.yml.feature_name` populated at step 4; `session.yml.output_locale` populated at step 2.6; `phase_history.specify` populated at approval; `current_phase` advances at approval.

## Handoff (auto-advance when next Phase is planned)
After approval, check `planned_phases` and **auto-invoke the next Skill** — the human's approval IS the gate; no second manual step needed.
- If `plan` planned next: print `"Spec approved. Advancing to Phase 2 (Plan)..."` → invoke `/designer`.
- If `plan` skipped, `tasks` planned: print `"Spec approved. Plan was not planned. Advancing to Phase 3 (Tasks)..."` → invoke `/task-builder`.
- If `plan` and `tasks` skipped, `implementation` planned: print `"Spec approved. Plan and Tasks were not planned. Advancing to Phase 4 (Implementation)..."` → invoke `/orchestrator`.
- If only `specify` planned: `"Spec approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship FEAT-NNN."`

## Hard rules

- **Never** infer `auto_approved_by`, `pipeline_mode`, or `planned_phases` from prior `.agent-session/` Sessions. PM bypass is set ONLY by the `/pm` Skill in the same invocation. (See top-of-file Hard rule and step 1 item 4.)
- **Never** auto-set `auto_approved_by: pm` in `session.yml` when this Skill is invoked directly by the user. Only `/pm` writes that field.
- **Never** skip steps 2 (`planned_phases`) and 2.5 (`pipeline_mode`) `AskUserQuestion` prompts on a fresh-start invocation. These are intent collection, not approval — PM bypass does not apply.
- **Always** ask the user via `AskUserQuestion` for `planned_phases` and `pipeline_mode`, even if a prior Session in the same repo answered them differently. Each Session is independent.
- **Always** treat prior `.agent-session/FEAT-*/` directories as opaque ID markers (for `FEAT-NNN` increment only). Their internal state belongs to those Sessions, not this one.
- **Never** open a prior `session.yml` for "context" or "to match the existing pattern". If you find yourself wanting to do this, you have lost; STOP and just ask the user.

## Failure modes
Abandonment, AskUserQuestion timeout, partial `spec.md` write, `schema_version` mismatch, >3 `[NEEDS CLARIFICATION]`, premature approval attempt, and why this is a Skill (not a Subagent): [`failure-modes.md`](failure-modes.md).
