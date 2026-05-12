---
name: task-builder
description: Phase 3 entry point. Conducts an interactive task-decomposition session with the human — reads the approved Spec and Plan, proposes a granular task breakdown (with file scope, AC coverage, parallelization markers), refines with the human, writes the approved `tasks.md`. Surfaces a guided next-step message based on `planned_phases`.
---

# Task Builder — Phase 3 (Tasks)

The Skill that turns an approved Spec + Plan into an approved Tasks list: granular `T-XXX` units with exact file scope, AC coverage, and `[P]` parallelization markers. Interactive with the human. Style inspired by GitHub Spec Kit's tasks template.

## When to invoke
- `/task-builder` — after Spec+Plan approved and `tasks` is in `planned_phases` (auto-detects `task_id` from Session).
- `/task-builder FEAT-NNN` — explicit `task_id`.
- `/task-builder FEAT-NNN --rewrite` — discard existing approved Tasks and start over.

## Refuse when
- `tasks` not in `planned_phases` → message: `"Tasks was not planned for this Session. Edit planned_phases in session.yml or restart with /spec-writer."`
- Spec not `status: approved` → message: `"Spec must be approved before /task-builder."`
- Plan in `planned_phases` but Plan not `status: approved` → message: `"Plan must be approved before /task-builder. Run /designer FEAT-NNN to finish it."`
- Existing Tasks is `status: approved` and `--rewrite` not passed → message: `"Tasks already approved. Use --rewrite to start over."`
- `session.yml.schema_version` higher than this Skill knows → message: `"Session schema_version <N> newer than this Skill's <M>. Upgrade ai-squad."`

## Inputs (preconditions)
- `.agent-session/<task_id>/session.yml` with `tasks` in `planned_phases`.
- `.agent-session/<task_id>/spec.md` (status: approved).
- `.agent-session/<task_id>/plan.md` (status: approved) — IF `plan` is in `planned_phases`. Auto-derived stub if Plan was skipped.

## Steps

### 1. Resolve Session and read inputs
1. Determine `task_id` (explicit arg or current Session from `session.yml`).
2. Read approved Spec; extract User Stories (`US-XXX [P1|P2|P3]`) and ACs (`AC-XXX`).
3. Read approved Plan (if present); extract Architecture/Data/API/UX decisions and the AC Coverage Map.
4. Build the **AC universe** (every AC from Spec) — Tasks must cover all of them.

### 2. Generate first draft (vertical-slice decomposition — Spec Kit pattern)
Decompose using the per-User-Story phase model:
- One section of tasks per User Story, sequenced by priority (P1 → P2 → P3).
- Inside each story: layered tasks (model → service → API → UX → tests) following INVEST sizing (Independent, Negotiable, Valuable, Estimable, Small, Testable).
- Target: **5-8 tasks per story, ~15-30 tasks total per feature**. Outliers OK with rationale; if over 40, flag possible feature-scope explosion.
- **Task size = smallest independently testable slice that touches a coherent file set** (not 1 file, not 1 module).
- Each task gets: monotonic `T-XXX` ID, `[US-XXX]` reference (or none for Setup/Foundational), `Files:` (exact paths — see step 4), `AC covered:` tags, optional `Depends on:`, `Estimated complexity:`.
- Optional **Setup** phase (`T-001..T-00N`) for shared scaffolding before any story tasks; optional **Foundational** phase for cross-story prereqs.
- Write to `.agent-session/<task_id>/tasks.md` (atomic; `status: draft`).

### 3. Mark `[P]` (parallelization — Spec Kit dual-rule)
A task is `[P]`-safe IFF **both**:
- (a) Its `Files:` set is **disjoint** from every other `[P]` task in its phase (mechanical exact-path set intersection), AND
- (b) It has **no `Depends on:`** pointing to an incomplete predecessor.

Reject `[P]` markers that fail either rule:
- **Interactive mode** (`auto_approved_by != "pm"`): emit a chat warning; remove the `[P]` (default) OR ask the human to refactor `Files:` into disjoint sets via `AskUserQuestion`.
- **PM-mode** (`auto_approved_by == "pm"`): do NOT silently remove the `[P]`. Instead INSERT a `[NEEDS CLARIFICATION] [P]-violation: <task-id> shares write scope with <conflicting-task-id>` marker into `tasks.md` (atomic write). The bypass step (Step 9) will detect the marker and refuse approval — the violation is never silently masked.

### 4. Specify `Files:` (exact paths — Spec Kit pattern)
- Use **exact file paths** (e.g. `src/auth/login.ts`), never globs (e.g. `src/auth/**`).
- Exception: a directory path is allowed only when the task creates new files within it (e.g. `src/auth/` for "scaffold auth module").
- Exact paths enable mechanical `[P]`-conflict detection in step 3.

### 5. Tag `AC covered:` per task (Kiro forward-traceability)
Every AC in the Spec must appear in at least one task's `AC covered:` field. Re-tagging at the task layer (in addition to the Plan's AC Coverage Map) lets the `qa` Subagent verify AC closure mechanically per dispatch.

### 6. Clarification pass (one ambiguity at a time)
For uncertain decomposition decisions: insert `[NEEDS CLARIFICATION] <question>` markers. Resolve via `AskUserQuestion` with 2-3 enumerable options + "Other" fallback. Atomic write after each resolution.
- **Interactive mode** (`auto_approved_by != "pm"`): cap at 3 markers; ask the human to pick the 3 most important and move the rest to a `## Decisions deferred to Implementation` section.
- **PM-mode** (`auto_approved_by == "pm"`): NO cap — every unresolved ambiguity MUST get its own `[NEEDS CLARIFICATION]` marker so Step 9's bypass scan catches all of them. Silently demoting violations to a deferred section would hide them from the bypass audit check.

### 7. Section-by-section refinement (only when human asks)
- Enumerable decision (split T-005? promote T-007 to `[P]`? change `Estimated complexity`?) → `AskUserQuestion`.
- Generative refinement (rewrite a task title, restructure a `Depends on:` chain) → free-form chat.
- After every accepted change: atomic write of full `tasks.md` AND re-run `[P]` validation (step 3) AND re-check AC coverage (step 8).

### 8. AC coverage gate (designer-symmetric hard gate)
Before approval: every AC from the Spec MUST be covered by at least one task's `AC covered:` field.
- **Interactive mode** (`auto_approved_by != "pm"`): gaps → list them, refuse approval, return to step 7.
- **PM-mode** (`auto_approved_by == "pm"`): do NOT loop to step 7 (step 7 is interactive). Instead INSERT a `[NEEDS CLARIFICATION] AC-coverage gap: <AC-XXX> uncovered` marker into `tasks.md` for each uncovered AC (atomic write). The bypass step (Step 9) will detect the markers and refuse approval. This mirrors the designer pattern (T-013).

### 9. PM-mode approval gate check (bypass — runs before Step 10)

> Reference: `shared/concepts/pm-bypass.md` — reproduced here for in-context visibility.

1. Read `session.yml.auto_approved_by`.
2. IF `auto_approved_by != "pm"` (strict equality, case-sensitive, must be string)
   → Proceed to Step 10 (interactive gate). Stop here.

3. Scan `tasks.md` for any `[NEEDS CLARIFICATION]` markers.
   In the task-builder context, ALSO treat the following as escalation triggers (insert a `[NEEDS CLARIFICATION]` marker BEFORE reaching this step when either is detected):
   - **`[P]`-violation:** a proposed parallel-safe (`[P]`) task would share write scope with another `[P]` task in the same wave.
   - **AC-coverage gap:** any Spec AC is uncovered by the task list.
   IF one or more `[NEEDS CLARIFICATION]` markers remain:
   → REFUSE bypass. Do NOT approve.
   → Attempt to append to `session.yml.notes` (atomic tmp + rename):
     ```yaml
     - kind: pm_escalation
       timestamp: "<ISO8601-now>"
       phase: "tasks"
       artifact_path: ".agent-session/<task_id>/tasks.md"
       open_questions: [<one entry per NEEDS CLARIFICATION block>]
     ```
     If the append fails, retry exactly once. If the second attempt also fails, raise — do NOT swallow silently.
   → Surface to PM persona: `"Approval blocked — open questions must be resolved before autonomous approval."`
   → Exit this step; leave `tasks.md` status unchanged.

4. No markers remain. Approve in this exact order (ordering invariant: evidence lands in `session.yml` BEFORE artifact is marked approved):

   a. Check for re-entry / partial-write repair:
      - IF session.yml already has `phase_history.tasks.approved_by == "pm"`
        AND `tasks.md` frontmatter `status == "approved"`:
          REFUSE (raise). Phase already approved by PM must not be re-approved.
      - IF session.yml already has `phase_history.tasks.approved_by == "pm"`
        AND `tasks.md` frontmatter `status != "approved"`:
          Partial-write repair. Write occurred in session.yml (step 4.b) but not in tasks.md (step 4.c).
          DO NOT raise. Skip step 4.b (session.yml write and current_phase advancement already done). Go directly to step 4.c.
      - IF session.yml does NOT have `phase_history.tasks.approved_by`:
          Normal path. Continue to step 4.b.

   b. Perform a single atomic read-modify-write on `session.yml` (one tmp + rename) writing ALL of:
      - `phase_history.tasks.approved_by: "pm"`
      - `notes`: append the `pm_decision` entry below
      - `current_phase`: advance to the next phase per `planned_phases` (same logic as Step 10.3)
      (Initialize `session.yml.notes` as empty list if absent before appending.)

   c. Write `status: approved` to `tasks.md` frontmatter (atomic write).

   d. Skip Step 10's `AskUserQuestion` entirely.

   e. Continue to Handoff.

   **`pm_decision` entry shape** (appended to `session.yml.notes`):
   ```yaml
   - kind: pm_decision
     timestamp: "<ISO8601-now>"       # ISO8601, UTC
     phase: "tasks"
     artifact_path: ".agent-session/<task_id>/tasks.md"
     gate_applied: "auto_approved_by=pm"
   ```

### 10. Final approval gate (Hybrid: checklist + AskUserQuestion — Kiro/Spec Kit pattern)

> Runs only when `session.yml.auto_approved_by != "pm"` (Step 9 did not bypass).

1. Print visual checklist:
   ```
   Tasks ready for approval:
   [x] N total tasks across M user stories (P1: X, P2: Y, P3: Z)
   [x] Median story has K tasks (target: 5-8)
   [x] N tasks marked [P] — all file-disjoint AND no incomplete-predecessor
   [x] AC Coverage: N/N ACs covered (zero gaps)
   [x] Files: 100% exact paths (no globs)
   [x] Zero NEEDS CLARIFICATION items
   ```
2. `AskUserQuestion` binary (Kiro mandate — explicit affirmative required):
   ```
   Approve these Tasks?
   [ ] Yes, approve and proceed
   [ ] No, more changes needed
   ```
3. On `Yes`: set `status: approved` in `tasks.md` frontmatter (atomic write); update `session.yml` (`current_phase` advances per `planned_phases`); populate `phase_history.tasks`.
4. On `No`: return to step 7.

## Output
- Path: `.agent-session/<task_id>/tasks.md` (template at `squads/sdd/templates/tasks.md`).
- Status field: `draft` → `approved` (no `in-progress` mid-state).
- Atomic write: tmp + rename, on every accepted change AND on final approval.
- Each task has: `T-XXX` ID, optional `[P]` marker, `[US-XXX]` reference (or none for Setup/Foundational), `Files:` (exact paths), `AC covered:`, optional `Depends on:`, `Estimated complexity:`.

## Handoff (auto-advance when next Phase is planned)
After approval, check `planned_phases` and **auto-invoke the next Skill** — the human's approval IS the gate; no second manual step needed.
- If `implementation` planned next: print `"Tasks approved. Advancing to Phase 4 (Implementation)..."` → invoke `/orchestrator`.
- If `implementation` not planned: `"Tasks approved. Implementation was not planned for this Session — Session is now paused. To execute later: /orchestrator FEAT-NNN --resume. To clean up without executing: /ship FEAT-NNN."`

## Failure modes
- **Human abandons mid-Session:** state on disk reflects last atomic write. Next `/task-builder FEAT-NNN` resumes.
- **AskUserQuestion timeout / no answer:** Session paused; no state change.
- **Partial `tasks.md` write:** atomic write (tmp + rename) makes this impossible.
- **Spec or Plan edited externally during decomposition:** task-builder is read-only on Spec/Plan. mtime check on next refinement turn; if changed, warn: `"Spec/Plan changed since draft. Re-read and regenerate?"`.
- **More than 3 `[NEEDS CLARIFICATION]` would emerge (interactive mode only):** ask the human to pick the 3 most important; the rest go to a `## Decisions deferred to Implementation` section in tasks.md. In PM-mode there is NO cap — every unresolved ambiguity keeps its marker so Step 9 catches all violations (see Step 6).
- **`[P]` marker on tasks with overlapping `Files:` (interactive mode):** auto-detected in step 3; chat warning + remove the `[P]` marker (default) OR ask the human to refactor `Files:` into disjoint sets via `AskUserQuestion`. In PM-mode, task-builder MUST insert a `[NEEDS CLARIFICATION]` marker (atomic write) instead of silently removing `[P]` — marker ownership lies with task-builder, not with the bypass step.
- **AC coverage gap at approval gate (interactive mode):** refuse approval; list uncovered ACs; return to step 7. In PM-mode, task-builder MUST insert a `[NEEDS CLARIFICATION]` marker per uncovered AC (atomic write) — marker ownership lies with task-builder, not with the bypass step.
- **Task count > 40:** flag possible feature-scope explosion; ask the human to consider splitting the Spec via `AskUserQuestion` (split / proceed anyway / cancel).
- **PM bypass re-entry guard fires:** `phase_history.tasks.approved_by` already set when Step 9 runs → raise immediately; do NOT re-approve. Indicates a session state inconsistency — surface to PM persona for manual investigation.
- **`session.yml` write fails during PM bypass:** after one retry, raise (do NOT swallow). The PM persona must be informed; the artifact is NOT marked approved.

## Why a Skill (not a Subagent)
Phase 3 has the human in-the-loop reviewing decomposition. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents".
