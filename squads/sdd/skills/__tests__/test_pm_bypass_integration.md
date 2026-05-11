# QA Scenario — PM-mode Bypass Integration (T-015)

> **Executor:** qa Subagent (or audit-agent acting as QA fixture validator).
> **AC scope:** AC-009, AC-010, AC-011, AC-012.
> **Source of truth:** `shared/concepts/pm-bypass.md`; bypass steps in
> `spec-writer/skill.md` §6.5, `designer/skill.md` §6.5,
> `task-builder/skill.md` §9.
> **Canonical bypass doc:** `shared/concepts/pm-bypass.md`

---

## Setup — synthetic session fixture

The following `session.yml` is the shared starting state for all happy-path
scenarios. Seed it at `.agent-session/FEAT-TEST/session.yml` before each
scenario (or equivalent in-memory stub for automated execution).

```yaml
# .agent-session/FEAT-TEST/session.yml
schema_version: 1
task_id: FEAT-TEST
feature_name: "Test Feature for PM Bypass"
created_at: "2026-05-11T00:00:00Z"
auto_approved_by: "pm"          # PM-mode activation value — strict lowercase
pm_cost_cap_usd: null           # no budget cap; bypass check only
planned_phases:
  - specify
  - plan
  - tasks
  - implementation
current_phase: specify
phase_history: {}               # empty at scenario start
notes: []                       # pm_decision entries land here
```

Seed the artifact stubs (no `[NEEDS CLARIFICATION]` markers, minimal valid
content):

- `.agent-session/FEAT-TEST/spec.md` — `status: draft`, one `US-001 [P1]`,
  one `AC-001`.
- `.agent-session/FEAT-TEST/plan.md` — `status: draft`, AC Coverage Map
  shows `AC-001` covered.
- `.agent-session/FEAT-TEST/tasks.md` — `status: draft`, `T-001` with
  `AC covered: AC-001`.

---

## Scenario 1 — `spec-writer` happy path (AC-009, AC-010)

### Given
- `session.yml.auto_approved_by` is exactly `"pm"` (string, lowercase).
- `spec.md` contains zero `[NEEDS CLARIFICATION]` markers.
- `session.yml.phase_history` does NOT contain `specify.approved_by`.

### When
`/spec-writer FEAT-TEST` executes and reaches its Step 6.5 (PM-mode approval
gate check).

### Then

**AC-009:** The Skill MUST NOT emit an `AskUserQuestion` tool call for the
approval gate. No interactive prompt is raised.

**AC-010 — three assertions (all must hold):**

1. `spec.md` frontmatter `status` is updated to `"approved"` (atomic write).

2. `session.yml.phase_history.specify.approved_by` equals `"pm"` after the
   step completes.

3. `session.yml.notes` contains at least one entry matching ALL of:
   ```yaml
   kind: pm_decision
   phase: "specify"
   artifact_path: ".agent-session/FEAT-TEST/spec.md"
   gate_applied: "auto_approved_by=pm"
   timestamp: <ISO8601 string — present and non-empty>
   ```

**Ordering invariant:** the `pm_decision` entry MUST appear in `session.yml`
BEFORE `spec.md` `status: approved` is written. Verify by simulating a crash
between steps 4.b and 4.c — `session.yml` must show `approved_by: pm` even
when `spec.md` is still `status: draft` (partial-write repair pre-condition).

**current_phase:** `session.yml.current_phase` advances from `"specify"` to
`"plan"` (the next entry in `planned_phases`).

---

## Scenario 2 — `designer` happy path (AC-009, AC-010)

### Given
- Session fixture from Setup, with `current_phase: plan`.
- `spec.md` is `status: approved` (precondition for designer).
- `plan.md` contains zero `[NEEDS CLARIFICATION]` markers.
- AC Coverage Map in `plan.md` shows `AC-001` covered (Step 6 gate passes).
- `session.yml.phase_history` does NOT contain `plan.approved_by`.

### When
`/designer FEAT-TEST` executes and reaches Step 6.5 (PM-mode approval gate
check).

### Then

**AC-009:** No `AskUserQuestion` tool call for the approval gate.

**AC-010 — three assertions:**

1. `plan.md` frontmatter `status` is `"approved"`.

2. `session.yml.phase_history.plan.approved_by` equals `"pm"`.

3. `session.yml.notes` contains an entry matching ALL of:
   ```yaml
   kind: pm_decision
   phase: "plan"
   artifact_path: ".agent-session/FEAT-TEST/plan.md"
   gate_applied: "auto_approved_by=pm"
   timestamp: <ISO8601 string — present and non-empty>
   ```

**Ordering invariant:** `pm_decision` entry in `session.yml` is written
BEFORE `plan.md` `status: approved`.

**current_phase:** advances from `"plan"` to `"tasks"`.

---

## Scenario 3 — `task-builder` happy path (AC-009, AC-010)

### Given
- Session fixture from Setup, with `current_phase: tasks`.
- `spec.md` is `status: approved`.
- `plan.md` is `status: approved`.
- `tasks.md` contains zero `[NEEDS CLARIFICATION]` markers.
- All `[P]`-marked tasks in `tasks.md` pass the write-disjoint check
  (no `[P]`-violation markers present).
- AC Coverage Map: every AC in `spec.md` is tagged in at least one task
  (no `AC-coverage gap` markers present).
- `session.yml.phase_history` does NOT contain `tasks.approved_by`.

### When
`/task-builder FEAT-TEST` executes and reaches Step 9 (PM-mode approval gate
check).

### Then

**AC-009:** No `AskUserQuestion` tool call for the approval gate.

**AC-010 — three assertions:**

1. `tasks.md` frontmatter `status` is `"approved"`.

2. `session.yml.phase_history.tasks.approved_by` equals `"pm"`.

3. `session.yml.notes` contains an entry matching ALL of:
   ```yaml
   kind: pm_decision
   phase: "tasks"
   artifact_path: ".agent-session/FEAT-TEST/tasks.md"
   gate_applied: "auto_approved_by=pm"
   timestamp: <ISO8601 string — present and non-empty>
   ```

**Ordering invariant:** `pm_decision` entry written to `session.yml` BEFORE
`tasks.md` `status: approved`.

**current_phase:** advances from `"tasks"` to `"implementation"`.

---

## Scenario 4 — `auto_approved_by` absent → interactive path (AC-011)

Applies to all three Skills; demonstrated here for `spec-writer`. Designer and
task-builder follow the identical pattern at their respective bypass steps.

### Given
- `session.yml` does NOT contain the `auto_approved_by` field (field absent,
  not `null`, not empty string — absence is the canonical "not PM-mode" state).
- `spec.md` contains zero `[NEEDS CLARIFICATION]` markers.

### When
`/spec-writer FEAT-TEST` executes and reaches Step 6.5.

### Then

**AC-011:** The bypass step detects `auto_approved_by != "pm"` (absent is
treated identically to `null`) and falls through to Step 7 without modifying
any file. Specifically:

- `spec.md` `status` remains `"draft"` — no auto-approval written.
- `session.yml.phase_history` remains empty — no `approved_by: pm` written.
- `session.yml.notes` remains `[]` — no `pm_decision` appended.
- The Skill PROCEEDS to Step 7 and raises `AskUserQuestion` as normal.

**Variant:** repeat with `auto_approved_by: "PM"` (uppercase), `auto_approved_by: true`
(boolean), `auto_approved_by: "yes"`, `auto_approved_by: ""` (empty string).
All variants MUST fall through to the interactive gate — none activates the
bypass. See `shared/concepts/pm-bypass.md §Anti-patterns` for the full list.

---

## Scenario 5 — `[NEEDS CLARIFICATION]` present → bypass refuses + escalates (AC-012)

Demonstrated for `spec-writer`. Designer and task-builder follow the same
pattern; only the `artifact_path` and `phase` values differ.

### Given
- `session.yml.auto_approved_by` is exactly `"pm"`.
- `spec.md` contains at least one unresolved `[NEEDS CLARIFICATION]` marker,
  e.g.:
  ```
  [NEEDS CLARIFICATION] What is the target latency for the new endpoint?
  ```
- `session.yml.notes` is `[]` (empty list) before the scenario runs.

### When
`/spec-writer FEAT-TEST` executes and reaches Step 6.5.

### Then

**AC-012 — four assertions:**

1. **Bypass refused:** the Skill does NOT approve the artifact.
   - `spec.md` `status` remains `"draft"` (unchanged).
   - `spec.md` content is NOT modified by the bypass step.

2. **Escalation record written:** `session.yml.notes` contains an entry
   matching ALL of:
   ```yaml
   kind: pm_escalation
   phase: "specify"
   artifact_path: ".agent-session/FEAT-TEST/spec.md"
   timestamp: <ISO8601 string — present and non-empty>
   open_questions:
     - "What is the target latency for the new endpoint?"
   ```
   The `open_questions` list MUST have one entry per `[NEEDS CLARIFICATION]`
   block found in the artifact.

3. **No AskUserQuestion raised** for the approval gate (bypass step does not
   fall through to Step 7 in this path; it exits after escalation).

4. **Escalation note surfaced:** the Skill outputs (to the PM persona / session
   log): `"Approval blocked — open questions must be resolved before autonomous
   approval."` (exact canonical text from `shared/concepts/pm-bypass.md`).

**Failure injection — escalation write fails (retry logic):**

Simulate a write failure on the first `session.yml.notes` append attempt.
Expected behavior per `shared/concepts/pm-bypass.md §3`:
- Retry exactly once.
- If the second attempt succeeds: escalation record written normally; scenario
  continues to assertion 2 above.
- If the second attempt also fails: the Skill MUST raise (propagate the error);
  it MUST NOT swallow the exception silently. The artifact remains unapproved.

---

## Scenario 6 — `designer` AC-coverage gap → `[NEEDS CLARIFICATION]` inserted by Step 6 → bypass refuses (AC-012)

### Given
- `session.yml.auto_approved_by` is exactly `"pm"`.
- `plan.md` Step 6 (AC coverage gate) detects that `AC-002` is present in
  `spec.md` but has no matching coverage tag in `plan.md`.
- Step 6 (PM-mode branch) inserts the marker BEFORE Step 6.5:
  ```
  [NEEDS CLARIFICATION] AC coverage gap: AC-002 not covered by any Plan
  decision. Add a decision or move to Decisions deferred to Implementation
  with a one-line reason.
  ```

### When
`/designer FEAT-TEST` reaches Step 6.5.

### Then
Same as Scenario 5 assertions 1-4 with:
- `phase: "plan"`, `artifact_path: ".agent-session/FEAT-TEST/plan.md"`.
- `open_questions` entry names `AC-002` explicitly.

**Marker ownership verified:** the `[NEEDS CLARIFICATION]` was produced by
Step 6 (designer), NOT by the bypass step itself (Step 6.5 is consumer-only).

---

## Scenario 7 — `task-builder` `[P]`-violation → `[NEEDS CLARIFICATION]` inserted by Step 3 → bypass refuses (AC-012)

### Given
- `session.yml.auto_approved_by` is exactly `"pm"`.
- `tasks.md` contains two `[P]`-marked tasks (`T-002 [P]` and `T-003 [P]`)
  whose `Files:` sets overlap: both declare `src/auth/login.ts`.
- Step 3 (PM-mode branch) inserts before Step 9:
  ```
  [NEEDS CLARIFICATION] [P]-violation: T-002 shares write scope with T-003
  (src/auth/login.ts). Remove [P] from one or refactor Files: into disjoint sets.
  ```

### When
`/task-builder FEAT-TEST` reaches Step 9.

### Then
Same as Scenario 5 assertions 1-4 with:
- `phase: "tasks"`, `artifact_path: ".agent-session/FEAT-TEST/tasks.md"`.
- `open_questions` entry names the `[P]`-violation.

**Marker ownership verified:** the `[NEEDS CLARIFICATION]` was produced by
Step 3 (task-builder), NOT by the bypass step itself.

---

## Scenario 8 — `task-builder` AC-coverage gap in PM-mode → bypass refuses (AC-012)

### Given
- `session.yml.auto_approved_by` is exactly `"pm"`.
- `spec.md` contains `AC-003`.
- `tasks.md` has no task with `AC covered: AC-003` (coverage gap).
- Step 8 (PM-mode branch) inserts before Step 9:
  ```
  [NEEDS CLARIFICATION] AC-coverage gap: AC-003 uncovered. Add a task that
  covers AC-003 or explicitly defer with rationale.
  ```

### When
`/task-builder FEAT-TEST` reaches Step 9.

### Then
Same as Scenario 5 assertions 1-4 with:
- `phase: "tasks"`, `artifact_path: ".agent-session/FEAT-TEST/tasks.md"`.
- `open_questions` entry names `AC-003`.

---

## Scenario 9 — re-entry guard (idempotency — already fully approved)

Demonstrates correct refusal when `phase_history` already has `approved_by:
pm` AND the artifact is already `status: approved` (duplicate invocation).

### Given
- `session.yml.phase_history.specify.approved_by` equals `"pm"`.
- `spec.md` `status` is `"approved"`.
- `session.yml.auto_approved_by` is `"pm"`.

### When
`/spec-writer FEAT-TEST` reaches Step 6.5 (e.g., invoked a second time for the
same phase).

### Then
- The bypass step detects re-entry via step 4.a and RAISES an error immediately.
- `spec.md` and `session.yml` are NOT modified.
- The raised error surfaces to the PM persona; the session is NOT silently
  advanced.

---

## Scenario 10 — partial-write repair path (crash recovery)

Demonstrates that a crash between step 4.b (session.yml written) and step 4.c
(artifact write) is repaired on the next invocation.

### Given
- `session.yml.phase_history.specify.approved_by` equals `"pm"` (step 4.b
  completed before crash).
- `spec.md` `status` is still `"draft"` (step 4.c never completed).
- `session.yml.notes` contains the `pm_decision` entry (also written in step
  4.b alongside `phase_history`).
- `session.yml.auto_approved_by` is `"pm"`.

### When
`/spec-writer FEAT-TEST` reaches Step 6.5 on the recovery invocation.

### Then
- Step 4.a detects the partial-write state: `phase_history.specify.approved_by
  == "pm"` AND `spec.md` `status != "approved"`.
- The bypass step enters the **partial-write repair path**: steps 4.b and 4.b''
  are SKIPPED (session.yml already has the evidence).
- Step 4.c writes `status: approved` to `spec.md`.
- Steps 4.d and 4.e proceed normally.
- No duplicate `pm_decision` entry is appended to `session.yml.notes`.
- `session.yml.current_phase` is NOT re-advanced (already advanced in the
  prior partial run's step 4.b).

---

## Assertions matrix (AC cross-reference)

| Scenario | AC-009 | AC-010 | AC-011 | AC-012 |
|----------|--------|--------|--------|--------|
| 1 spec-writer happy path | PASS | PASS | — | — |
| 2 designer happy path | PASS | PASS | — | — |
| 3 task-builder happy path | PASS | PASS | — | — |
| 4 auto_approved_by absent | — | — | PASS | — |
| 5 NEEDS CLARIFICATION (spec-writer) | — | — | — | PASS |
| 6 AC-coverage gap (designer) | — | — | — | PASS |
| 7 [P]-violation (task-builder) | — | — | — | PASS |
| 8 AC-coverage gap (task-builder) | — | — | — | PASS |
| 9 re-entry guard | PASS (refused) | — | — | — |
| 10 partial-write repair | PASS | PASS | — | — |

All four ACs (AC-009, AC-010, AC-011, AC-012) are covered by at least two
scenarios each.

---

## Execution notes for qa Subagent

1. Run scenarios in order 1→3 first (happy path); they build on each other's
   output state when run sequentially. Reset fixture between each scenario if
   running in isolation.

2. Scenarios 4-10 are stateless — reset to the Setup fixture before each.

3. For each scenario, inspect the EXACT session.yml and artifact frontmatter
   state after the bypass step completes; do NOT rely on log output alone.
   File state is the authoritative evidence.

4. The ordering invariant (evidence in session.yml BEFORE artifact approval)
   is observable only via crash simulation (step between 4.b and 4.c). If the
   test harness cannot inject mid-step failures, mark this assertion as
   "verified-by-inspection" and note it in the qa Output Packet's `notes`.

5. Anti-pattern variants in Scenario 4 (uppercase `"PM"`, boolean `true`, etc.)
   MUST each be tested individually — a single composite assertion is
   insufficient; each value has a distinct YAML parsing behavior.
