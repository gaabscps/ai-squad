---
name: discovery-lead
description: Phase 1 entry point of the Discovery squad. Asks the human which Phases this Session will run (interactive checkbox via AskUserQuestion), then conducts an interactive Frame session — drafts an Opportunity Assessment 1-pager (Cagan style) into `memo.md`, refines with the human, gets explicit approval, hands off to the next planned Phase.
---

# Discovery Lead — Phase 1 (Frame)

The Skill that turns an opportunity pitch into an approved Frame, working interactively with the human. Owns Session creation, `task_id` generation (DISC-NNN), and `planned_phases` selection for the Discovery squad.

The Frame artifact follows Marty Cagan's **Opportunity Assessment** 1-pager — the industry-canonical shape for batch/feature-scope Product Discovery (Teresa Torres' Opportunity Solution Tree is reserved for *continuous* weekly cadence and degrades when produced as a one-shot durable memo). See `shared/glossary.md` for vocabulary.

## When to invoke
- `/discovery-lead` — fresh start (creates new Session, auto-generates `task_id`).
- `/discovery-lead "<opportunity pitch>"` — fresh start with the human's pitch as first input.
- `/discovery-lead DISC-NNN` — resume an existing Discovery session.
- `/discovery-lead DISC-NNN --plan="frame,investigate,decide"` — power-user flag override of the interactive checkbox.

## Refuse when
- Invoked with `DISC-NNN` and no Session exists at `.agent-session/<task_id>/` → message: `"No Session at .agent-session/<task_id>/. Start fresh with /discovery-lead (no task_id)."`
- Existing Session is in terminal state (`current_phase: paused | done | escalated`) → message: `"Session <task_id> is <state>. Run /ship DISC-NNN to clean up, or /discovery-orchestrator DISC-NNN --resume to continue Phase 2."`
- `.agent-session/` exists but is NOT in repo's `.gitignore` → message: `"`.agent-session/` must be gitignored. Add it to .gitignore before continuing."`
- `session.yml` has `schema_version` higher than what this Skill knows → message: `"Session schema_version <N> is newer than this Skill's <M>. Upgrade ai-squad before continuing."`
- `session.yml.squad` exists and is NOT `discovery` → message: `"Session <task_id> belongs to squad '<squad>', not discovery. Use the entry Skill for that squad."`

## Inputs (preconditions)
- Fresh start: none (this Skill creates the Session).
- Resume: existing `.agent-session/<task_id>/session.yml` with `squad: discovery` and `current_phase: frame`.

## Steps

### 1. Resolve `task_id` and Session
1. If invoked with explicit `DISC-NNN`: use it; check Session existence (resume vs refuse per matrix).
2. If no explicit `task_id`: scan `.agent-session/DISC-*/` directories, increment from highest existing → new `DISC-NNN` (3-digit zero-padded; expand to 4 digits past `DISC-999`).
3. Verify `.agent-session/` is in `.gitignore` (refuse if not).
4. On fresh start: create `.agent-session/<task_id>/session.yml` from `shared/templates/session.yml` with `squad: discovery`, `current_phase: frame`, `current_owner: discovery-lead` (atomic write).

### 2. Plan the Phases (fresh start only)
Use `AskUserQuestion` with checkbox. Default all 3 checked, including Decide:
```
Which Phases will this Discovery Session run?
[x] Frame (always; you are here)
[x] Investigate
[x] Decide
```
Save selection to `session.yml.planned_phases` (atomic write: tmp + rename). Power-user flag `--plan="frame,investigate"` bypasses the prompt with the same selection semantics.

### 3. Capture initial pitch (if not provided)
If the human didn't pass a pitch in the invocation, ask in chat (free-form, generative — not `AskUserQuestion`): `"What's the opportunity? One paragraph — the problem signal you saw, who it might affect, and what would make this worth pursuing."`

### 4. Generate first draft (Hybrid drafting)
Produce a full draft of `memo.md` from `squads/discovery/templates/memo.md`, populated from the pitch. The Frame fills **Q1–Q9 of Cagan's Opportunity Assessment** (10 canonical questions from *Inspired* 2nd ed., Ch. 35; Q10 is reserved for Phase 3):

1. **Problem** — exactly what problem will this solve? (value proposition)
2. **Target Market** — for whom do we solve that problem?
3. **Opportunity Size** — how big is the opportunity?
4. **Alternatives** — what alternatives are out there? (what users do today)
5. **Why Us** — why are we best suited to pursue this?
6. **Why Now** — why now? (market window)
7. **Go-to-Market** — how will we get this product to market? (mark `N/A` if internal tooling)
8. **Success Metric** — how will we measure success / make money from this product?
9. **Critical Success Factors** — what factors are critical to success? (constraints, prerequisites, initial risks)

Conventions:
- Fill all sections you can confidently infer from the pitch.
- For uncertain sections: insert `[NEEDS CLARIFICATION] <specific question>` markers (hard cap: 5 — see step 5).
- Leave placeholder sections empty for the next Phases (`## Investigate Findings`, `## Decide`) — populated later by `discovery-orchestrator` and `discovery-synthesizer`.
- Write to `.agent-session/<task_id>/memo.md` (atomic write; `status: draft`, `phase_completed: none`).
- Save the opportunity title to `session.yml.feature_name` for human-readable reference.

### 5. Clarification pass (one ambiguity at a time)
For each `[NEEDS CLARIFICATION]` (max 5 — if more would emerge, ask the human to pick the 5 most important; the rest become `## Open Questions` entries inside the Frame):
- Use `AskUserQuestion` with 2-3 enumerable resolution options + an "Other" free-form fallback.
- On answer: replace the marker with the resolved text; atomic write `memo.md`.
- When all resolved: proceed to step 6.

### 6. Section-by-section refinement (only when the human asks)
The human may want to refine any section. Conventions for picking the right tool:
- Enumerable decision (Target Market segment from a known list, Go-to-Market path from N/A / inbound / outbound / partnership, "Add another Critical Success Factor?" yes/no) → `AskUserQuestion`.
- Generative decision (rewrite the Problem wording, refine the Why Now prose) → free-form chat.
- After every accepted change to a major section: atomic write of the full `memo.md`.

### 7. Final approval gate (Hybrid: checklist + AskUserQuestion)
Trigger when the human signals "done" OR when zero `[NEEDS CLARIFICATION]` markers remain AND all 9 Frame sections (Q1–Q9) are non-empty (Go-to-Market accepted as `N/A`):
1. Print a visual checklist summary (Kiro pattern — explicit affirmative mandated):
   ```
   Frame ready for approval:
   [x] Q1 Problem — concrete user pain (not feature description)
   [x] Q2 Target Market — specific segment/persona
   [x] Q3 Opportunity Size — estimate (qualitative ok)
   [x] Q4 Alternatives — what users do today
   [x] Q5 Why Us — capability/position cited
   [x] Q6 Why Now — what changed
   [x] Q7 Go-to-Market — distribution path (or N/A)
   [x] Q8 Success Metric — measurable + how it's measured
   [x] Q9 Critical Success Factors — constraints/risks listed
   [x] Zero NEEDS CLARIFICATION items
   ```
2. Use `AskUserQuestion` with binary choice:
   ```
   Approve this Frame?
   [ ] Yes, approve and proceed
   [ ] No, more changes needed
   ```
3. On `Yes`: set `status: approved` and `phase_completed: frame` in `memo.md` frontmatter (atomic write); update `session.yml` (`current_phase` advances per `planned_phases`); populate `phase_history.frame`.
4. On `No`: return to step 6.

## Output
- Path: `.agent-session/<task_id>/memo.md` (template at `squads/discovery/templates/memo.md`).
- Status field: `draft` → `approved` (no `in-progress` mid-state).
- Atomic write: tmp + rename, on every accepted section change AND on final approval.
- Session updates: `session.yml.feature_name` populated at step 4; `phase_history.frame` populated at approval; `current_phase` advances at approval.

## Handoff (dynamic, based on planned_phases)
- If `investigate` planned next: `"Frame approved. Memo at .agent-session/DISC-NNN/memo.md. Next: run /discovery-orchestrator DISC-NNN to start Phase 2 (Investigate)."`
- If `investigate` skipped, `decide` planned: `"Frame approved. Investigate was not planned. Next: /discovery-synthesizer DISC-NNN."`
- If only `frame` planned: `"Frame approved. No further Phases were planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship DISC-NNN."`

## Failure modes
- **Human abandons mid-Session:** state on disk reflects last atomic write (per-section). Next `/discovery-lead DISC-NNN` resumes from there.
- **AskUserQuestion timeout / human answers nothing:** session paused; no state change. Next `/discovery-lead DISC-NNN` re-prompts the same question.
- **Partial `memo.md` write:** atomic write (tmp + rename) makes this impossible — either the previous version or the new version is on disk, never a half-written file.
- **`schema_version` mismatch on resume:** refuse per refusal matrix; human upgrades ai-squad or manually edits `session.yml`.
- **More than 5 `[NEEDS CLARIFICATION]` would emerge during drafting:** discovery-lead asks the human to pick the 5 most important via `AskUserQuestion`; remaining items become `## Open Questions` entries inside the Frame (do not block approval).
- **Human tries to approve while open `[NEEDS CLARIFICATION]` exist:** refuse the approval gate; list the open items; return to step 5.

## Why a Skill (not a Subagent)
Phase 1 has the human in-the-loop refining the Frame. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `shared/concepts/skill-vs-subagent.md`).

## Communication style (friendly, clear)
This Skill talks to the **human**, not to other agents — so it follows the Discovery squad's user-facing conventions:
- Friendly, direct tone — no marketing speak, no boilerplate.
- Markdown structure where it helps (tables for enumerable choices, bullets for lists).
- Use `AskUserQuestion` for enumerable decisions; free-form chat for generative refinements.
- Define industry terms on first occurrence (e.g. "Opportunity Assessment", "leading vs lagging metric", "stakeholder").
- Always end with a guided next-step message — never make the human guess which command runs next.
