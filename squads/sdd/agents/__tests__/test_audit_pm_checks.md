---
id: TEST-AUDIT-PM-CHECKS
feature_id: FEAT-005
ac_scope: [AC-017, AC-018, AC-019, AC-020, AC-021, AC-009, AC-010]
depends_on: T-024
check_refs: [audit-agent.md#check-10, audit-agent.md#check-11, audit-agent.md#check-4]
created: 2026-05-11
updated: 2026-05-11
---

# QA Fixture: Audit-agent PM checks (Checks 10 + 11)

> Documented qa scenario. The qa Subagent executes these scenarios against the
> audit-agent running on the provided fixture sessions and asserts the expected
> findings.
>
> Reference: `squads/sdd/agents/audit-agent.md` — "Check 10 — PM gate
> violations" (AC-017, AC-020) and "Check 11 — PM cost cap exceeded"
> (AC-018, AC-019, AC-020).

---

## Fixture sessions

Three fixture sessions are defined below. Each describes the minimal file state
the qa Subagent must seed before invoking the audit-agent. All paths are
relative to `.agent-session/FIXTURE-<N>/`.

---

### Fixture A — Clean PM run (audit should pass both checks)

**Purpose:** Verify the happy path. Phase approved by pm with matching
pm_decision evidence; cost under cap. Both checks pass silently.

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-A",
  "pm_sessions": [
    {
      "session_id": "pm-session-A-001",
      "started_at": "2026-05-11T08:00:00Z",
      "completed_at": "2026-05-11T08:30:00Z",
      "usage": {
        "input_tokens": 5000,
        "output_tokens": 1000,
        "total_tokens": 6000,
        "cost_usd": 0.80
      },
      "source": "platform_captured"
    }
  ],
  "actual_dispatches": []
}
```

`session.yml`
```yaml
session_id: FIXTURE-A
auto_approved_by: pm
pm_cost_cap_usd: 5.00
phase_history:
  specify:
    approved_by: pm
    approved_at: "2026-05-11T08:15:00Z"
    artifact_path: ".agent-session/FIXTURE-A/spec.md"
notes:
  - pm_decision:
      timestamp: "2026-05-11T08:15:20Z"
      phase: specify
      artifact_path: ".agent-session/FIXTURE-A/spec.md"
      gate_applied: "auto_approved_by=pm"
```

**Expected audit outcome:**

- Check 10: PASS — `phase_history.specify.approved_by == "pm"` has a matching
  `pm_decision` entry in `session.yml.notes` with `artifact_path` matching
  exactly and `timestamp` (08:15:20) within ±60s of `approved_at` (08:15:00).
  No finding emitted.
- Check 11: PASS — `pm_cost_cap_usd` is set (5.00); total PM cost is 0.80,
  which does not exceed the cap. No finding emitted.
- Overall: audit status `done` (assuming all other universal checks also pass).

---

### Fixture B — PM-approved phase WITHOUT matching pm_decision (blocker)

**Purpose:** Verify Check 10 blocks when `approved_by == "pm"` has no
corresponding `pm_decision` evidence. Satisfies AC-017.

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-B",
  "pm_sessions": [
    {
      "session_id": "pm-session-B-001",
      "started_at": "2026-05-11T09:00:00Z",
      "completed_at": "2026-05-11T09:20:00Z",
      "usage": {
        "input_tokens": 3000,
        "output_tokens": 800,
        "total_tokens": 3800,
        "cost_usd": 0.50
      },
      "source": "self_reported"
    }
  ],
  "actual_dispatches": []
}
```

`session.yml`
```yaml
session_id: FIXTURE-B
auto_approved_by: pm
phase_history:
  specify:
    approved_by: pm
    approved_at: "2026-05-11T09:10:00Z"
    artifact_path: ".agent-session/FIXTURE-B/spec.md"
  plan:
    approved_by: pm
    approved_at: "2026-05-11T09:15:00Z"
    artifact_path: ".agent-session/FIXTURE-B/plan.md"
notes: []
```

> Note: `session.yml.notes` is empty — no `pm_decision` entries present.
> Neither the `specify` phase nor the `plan` phase has matching evidence.

**Expected audit outcome:**

- Check 10: FAIL — two blocker findings emitted (one per phase):
  ```
  severity: blocker
  audit_finding_kind: pm_gate_violations
  ref: session.yml#phase_history.specify
  rationale: "PM-approved phase 'specify' has no matching pm_decision evidence
              in session.yml.notes (artifact_path or timestamp mismatch)"
  ```
  ```
  severity: blocker
  audit_finding_kind: pm_gate_violations
  ref: session.yml#phase_history.plan
  rationale: "PM-approved phase 'plan' has no matching pm_decision evidence in
              session.yml.notes (artifact_path or timestamp mismatch)"
  ```
- Check 11: SKIP — `pm_cost_cap_usd` is absent; cap not set → no finding
  (AC-019 opt-in behavior).
- Overall: audit status `blocked` with `blocker_kind: bypass_detected`.

---

### Fixture C — PM cost exceeds configured cap (major finding)

**Purpose:** Verify Check 11 emits a `major` finding when `pm_sessions[]` total
cost exceeds the configured `pm_cost_cap_usd`. Satisfies AC-018.

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-C",
  "pm_sessions": [
    {
      "session_id": "pm-session-C-001",
      "started_at": "2026-05-11T10:00:00Z",
      "completed_at": "2026-05-11T10:20:00Z",
      "usage": {
        "input_tokens": 20000,
        "output_tokens": 5000,
        "total_tokens": 25000,
        "cost_usd": 3.50
      },
      "source": "platform_captured"
    },
    {
      "session_id": "pm-session-C-002",
      "started_at": "2026-05-11T10:30:00Z",
      "completed_at": "2026-05-11T10:50:00Z",
      "usage": {
        "input_tokens": 15000,
        "output_tokens": 4000,
        "total_tokens": 19000,
        "cost_usd": 2.80
      },
      "source": "platform_captured"
    }
  ],
  "actual_dispatches": []
}
```

> Note: `sum(pm_sessions[].usage.cost_usd)` = 3.50 + 2.80 = **6.30 USD**.

`session.yml`
```yaml
session_id: FIXTURE-C
auto_approved_by: pm
pm_cost_cap_usd: 5.00
phase_history:
  specify:
    approved_by: pm
    approved_at: "2026-05-11T10:05:00Z"
    artifact_path: ".agent-session/FIXTURE-C/spec.md"
notes:
  - pm_decision:
      timestamp: "2026-05-11T10:05:10Z"
      phase: specify
      artifact_path: ".agent-session/FIXTURE-C/spec.md"
      gate_applied: "auto_approved_by=pm"
```

**Expected audit outcome:**

- Check 10: PASS — `phase_history.specify` has a valid `pm_decision` match
  (timestamp within ±60s). No finding emitted.
- Check 11: FAIL — total cost 6.30 exceeds `pm_cost_cap_usd` 5.00:
  ```
  severity: major
  audit_finding_kind: pm_cost_cap_exceeded
  ref: dispatch-manifest.json#pm_sessions
  rationale: "PM total cost $6.30 exceeds cap $5.00 set in
              session.yml.pm_cost_cap_usd"
  ```
- Overall: audit status `blocked` (major finding present; Check 11 emits major,
  not blocker — orchestrator policy: any finding causes `blocked`).

---

## Given / When / Then per AC

### AC-017
**Given** `dispatch-manifest.json.pm_sessions[]` is populated (PM run)
**And** `phase_history.<phase>.approved_by == "pm"` for one or more phases
**And** `session.yml.notes` contains NO matching `pm_decision` entry for those phases

**When** audit-agent runs Check 10

**Then** audit-agent MUST emit one `blocker` finding per offending phase with
`audit_finding_kind: pm_gate_violations` and a `ref` pointing to
`session.yml#phase_history.<phase>`

**Validated by:** Fixture B — two blocker findings, one per phase (`specify`,
`plan`).

---

### AC-018
**Given** `dispatch-manifest.json.pm_sessions[]` is populated (PM run)
**And** `session.yml.pm_cost_cap_usd` is explicitly set to a number (5.00)
**And** `sum(pm_sessions[].usage.cost_usd)` (6.30) exceeds `pm_cost_cap_usd`

**When** audit-agent runs Check 11

**Then** audit-agent MUST emit one `major` finding with
`audit_finding_kind: pm_cost_cap_exceeded` and a `ref` pointing to
`dispatch-manifest.json#pm_sessions`

**Validated by:** Fixture C — one major finding; total cost 6.30 > cap 5.00.

---

### AC-019
**Given** `dispatch-manifest.json.pm_sessions[]` is populated (PM run)
**And** `session.yml.pm_cost_cap_usd` is NOT set (field absent)

**When** audit-agent runs Check 11

**Then** audit-agent MUST skip the `pm_cost_cap_exceeded` check entirely and
emit NO finding — PM total cost is reported only as an informational metric in
the agentops report, not as an audit gate

**Validated by:** Fixture B — `pm_cost_cap_usd` absent; Check 11 skipped with
no finding.

---

### AC-020
**Given** `dispatch-manifest.json.pm_sessions[]` is absent OR empty
(non-PM run)

**When** audit-agent runs Checks 10 and 11

**Then** audit-agent MUST skip BOTH PM-related checks entirely and emit NO
PM-related findings

**Validated by:** Additional negative fixture below (Fixture D).

---

### Fixture D — Non-PM run (no pm_sessions) — Checks 10 + 11 fully skipped

**Purpose:** Confirm AC-020: when `pm_sessions[]` is absent, both PM checks are
skipped regardless of `phase_history` content.

`dispatch-manifest.json`
```json
{
  "schema_version": 1,
  "session_id": "FIXTURE-D",
  "actual_dispatches": []
}
```

> Note: no `pm_sessions` key at all (v1 manifest shape).

`session.yml`
```yaml
session_id: FIXTURE-D
phase_history:
  specify:
    approved_by: human
    approved_at: "2026-05-11T11:00:00Z"
    artifact_path: ".agent-session/FIXTURE-D/spec.md"
notes: []
```

**Expected audit outcome:**

- Check 10: SKIP — `pm_sessions[]` absent → precondition not met (AC-020).
  No finding emitted.
- Check 11: SKIP — `pm_sessions[]` absent → precondition not met (AC-020).
  No finding emitted.
- Overall: no PM-related findings; audit continues with the 9 universal checks
  only.

---

---

### Fixture E — Reviewer `needs_review` + qa done (should pass Check 4)

**Purpose:** Verify AC-009: when a reviewer dispatch has `status: needs_review` AND a
subsequent qa dispatch for the same `task_id` has `status: done`, audit-agent Check 4
must mark `reviewer_done: true` for that task and emit NO `bypass_detected` finding.

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-E",
  "actual_dispatches": [
    {
      "dispatch_id": "d-review-1",
      "task_id": "T-001",
      "role": "code-reviewer",
      "status": "needs_review",
      "started_at": "2026-05-11T12:00:00Z"
    },
    {
      "dispatch_id": "d-qa-1",
      "task_id": "T-001",
      "role": "qa",
      "status": "done",
      "started_at": "2026-05-11T12:05:00Z"
    }
  ]
}
```

> Note: `d-qa-1` has `started_at` 5 minutes after `d-review-1`, satisfying the
> "qa started AFTER reviewer" ordering requirement. `d-qa-1` has `status: done`.

**Expected audit outcome:**

- Check 4 (reviewer gate): `reviewer_done: true` for T-001.
  No `bypass_detected` finding emitted for the reviewer stage.
  No `pipeline_stage_skipped` finding for reviewer stage.
- No `incomplete_review` finding (the `needs_review + qa done` pattern is satisfied).
- Overall: Check 4 passes for the reviewer stage of T-001.

---

### Fixture F — Reviewer `needs_review` WITHOUT subsequent qa done (incomplete_review)

**Purpose:** Verify AC-010: when a reviewer dispatch has `status: needs_review` AND
there is no subsequent qa dispatch with `status: done`, audit-agent must emit finding
`incomplete_review` with `severity: minor` — NOT `bypass_detected`.

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-F",
  "actual_dispatches": [
    {
      "dispatch_id": "d-review-2",
      "task_id": "T-002",
      "role": "code-reviewer",
      "status": "needs_review",
      "started_at": "2026-05-11T13:00:00Z"
    }
  ]
}
```

> Note: no qa dispatch exists for T-002. The reviewer returned `needs_review` with
> no follow-up qa `done` to complete the pattern.

**Expected audit outcome:**

- Check 4 (reviewer gate): `reviewer_done: false` for T-002.
- One finding emitted:
  ```
  severity: minor
  audit_finding_kind: incomplete_review
  ref: dispatch-manifest.json#actual_dispatches[d-review-2]
  rationale: "reviewer d-review-2 returned needs_review but no subsequent qa done
              dispatch found for task T-002"
  ```
- NO `bypass_detected` finding (severity: blocker) for this task.
- Overall: no `bypass_detected` blocker; `incomplete_review` is advisory (minor).

---

### AC-009
**Given** `actual_dispatches[]` contains a reviewer dispatch for task T-001 with
`status: needs_review` and `started_at: T`
**And** `actual_dispatches[]` contains a qa dispatch for the same T-001 with
`status: done` and `started_at: T+5min` (after the reviewer dispatch)

**When** audit-agent runs Check 4 for T-001's reviewer stage

**Then** audit-agent MUST set `reviewer_done: true` for T-001
**And** MUST NOT emit any `bypass_detected` finding for T-001's reviewer stage
**And** MUST NOT emit any `pipeline_stage_skipped` finding for T-001's reviewer stage

**Validated by:** Fixture E — reviewer `needs_review` + subsequent qa `done`.

---

### AC-010
**Given** `actual_dispatches[]` contains a reviewer dispatch for task T-002 with
`status: needs_review`
**And** there is NO qa dispatch for T-002 with `status: done` started after the
reviewer dispatch

**When** audit-agent runs Check 4 for T-002's reviewer stage

**Then** audit-agent MUST set `reviewer_done: false` for T-002
**And** MUST emit exactly one finding with `severity: minor` and
`audit_finding_kind: incomplete_review` referencing the reviewer dispatch
**And** MUST NOT emit any `bypass_detected` finding (severity: blocker) for T-002

**Validated by:** Fixture F — reviewer `needs_review` with no subsequent qa `done`.

---

---

### Fixture G — Check 11 with mixed `cost_usd` presence in pm_sessions (AC-019 guard)

**Purpose:** Verify Check 11 treats absent `cost_usd` as `0` rather than propagating `None` into arithmetic, AND correctly sums mixed arrays (one absent + one present). Satisfies the defensive sum guard added in T-012 (AC-019).

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-G",
  "pm_sessions": [
    {
      "session_id": "pm-session-G-001",
      "started_at": "2026-05-11T14:00:00Z",
      "completed_at": "2026-05-11T14:20:00Z",
      "usage": {
        "input_tokens": 5000,
        "output_tokens": 1000,
        "total_tokens": 6000
      },
      "source": "self_reported"
    },
    {
      "session_id": "pm-session-G-002",
      "started_at": "2026-05-11T14:25:00Z",
      "completed_at": "2026-05-11T14:40:00Z",
      "usage": {
        "input_tokens": 3000,
        "output_tokens": 500,
        "total_tokens": 3500,
        "cost_usd": 1.20
      },
      "source": "platform_captured"
    }
  ],
  "actual_dispatches": []
}
```

> Note: `pm_sessions[0].usage.cost_usd` is absent; `pm_sessions[1].usage.cost_usd` is 1.20.
> Defensive sum must produce 0 + 1.20 = 1.20 (no TypeError from absent entry).

`session.yml`
```yaml
session_id: FIXTURE-G
auto_approved_by: pm
pm_cost_cap_usd: 5.00
phase_history:
  specify:
    approved_by: pm
    approved_at: "2026-05-11T14:05:00Z"
    artifact_path: ".agent-session/FIXTURE-G/spec.md"
notes:
  - pm_decision:
      timestamp: "2026-05-11T14:05:10Z"
      phase: specify
      artifact_path: ".agent-session/FIXTURE-G/spec.md"
      gate_applied: "auto_approved_by=pm"
```

**Expected audit outcome:**

- Check 10: PASS — `phase_history.specify` has a valid `pm_decision` match.
  No finding emitted.
- Check 11: PASS — `pm_cost_cap_usd` is 5.00; absent `cost_usd` in session G-001
  treated as `0` (defensive sum); present `cost_usd` 1.20 in session G-002 summed
  normally; total_cost = 0.00 + 1.20 = 1.20 which does NOT exceed cap 5.00.
  No `pm_cost_cap_exceeded` finding emitted. No TypeError.
- Overall: no PM findings from Checks 10 or 11 (scope assertions to PM checks only).

---

### Fixture H — Check 10 skipped for pre-FEAT-004 sessions (AC-021 guard)

**Purpose:** Verify Check 10 is skipped entirely when `session.yml.notes` is absent OR is not a list — both are pre-FEAT-004 session shapes. Satisfies the notes-absent / notes-not-list precondition added in T-012 (AC-021).

Two variants are defined:

#### Fixture H1 — `notes` key absent

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-H1",
  "pm_sessions": [
    {
      "session_id": "pm-session-H1-001",
      "started_at": "2026-05-11T15:00:00Z",
      "completed_at": "2026-05-11T15:20:00Z",
      "usage": {
        "input_tokens": 3000,
        "output_tokens": 600,
        "total_tokens": 3600,
        "cost_usd": 0.40
      },
      "source": "self_reported"
    }
  ],
  "actual_dispatches": []
}
```

`session.yml`
```yaml
session_id: FIXTURE-H1
auto_approved_by: pm
phase_history:
  specify:
    approved_by: pm
    approved_at: "2026-05-11T15:05:00Z"
    artifact_path: ".agent-session/FIXTURE-H1/spec.md"
```

> Note: `session.yml.notes` key is entirely absent (pre-FEAT-004 session, no pm_decision schema).

**Expected audit outcome:**

- Check 10: SKIP — `session.yml.notes` is absent; pre-FEAT-004 session guard fires.
  No `pm_gate_violations` finding emitted (absence of notes is not a violation).
- Check 11: SKIP — `pm_cost_cap_usd` is absent; cap not set → no finding (opt-in behavior).
- Overall: no PM findings from Checks 10 or 11 (scope assertions to PM checks only).

#### Fixture H2 — `notes` present but not a list (legacy string value)

**Fixture files to seed:**

`dispatch-manifest.json`
```json
{
  "schema_version": 2,
  "session_id": "FIXTURE-H2",
  "pm_sessions": [
    {
      "session_id": "pm-session-H2-001",
      "started_at": "2026-05-11T15:30:00Z",
      "completed_at": "2026-05-11T15:50:00Z",
      "usage": {
        "input_tokens": 2000,
        "output_tokens": 400,
        "total_tokens": 2400,
        "cost_usd": 0.25
      },
      "source": "self_reported"
    }
  ],
  "actual_dispatches": []
}
```

`session.yml`
```yaml
session_id: FIXTURE-H2
auto_approved_by: pm
phase_history:
  specify:
    approved_by: pm
    approved_at: "2026-05-11T15:35:00Z"
    artifact_path: ".agent-session/FIXTURE-H2/spec.md"
notes: "legacy string value"
```

> Note: `session.yml.notes` is a string (not a list) — pre-FEAT-004 session written
> before the pm_decision YAML list schema was introduced.

**Expected audit outcome:**

- Check 10: SKIP — `session.yml.notes` is not a list; pre-FEAT-004 session guard fires.
  No `pm_gate_violations` finding emitted (non-list notes in a pre-FEAT-004 session
  is not a violation).
- Check 11: SKIP — `pm_cost_cap_usd` is absent; cap not set → no finding (opt-in behavior).
- Overall: no PM findings from Checks 10 or 11 (scope assertions to PM checks only).

---

### AC-019 (T-012 guard — cost_usd absent treated as 0)
**Given** `dispatch-manifest.json.pm_sessions[]` is populated (PM run)
**And** one or more `pm_sessions[].usage.cost_usd` fields are absent or null
**And** `session.yml.pm_cost_cap_usd` is explicitly set to a number

**When** audit-agent runs Check 11 and computes `total_cost`

**Then** audit-agent MUST treat the absent/null `cost_usd` as `0` (not `None`)
**And** MUST NOT raise a TypeError or propagate `None` through arithmetic
**And** the budget comparison MUST be based on the numeric total only

**Validated by:** Fixture G — `cost_usd` absent; total treated as 0.00; no cap violation.

---

### AC-021 (T-012 guard — notes absent or not-a-list skips Check 10)
**Given** `dispatch-manifest.json.pm_sessions[]` is populated (PM run)
**And** `session.yml.notes` key is either entirely absent OR is present but not a list (e.g., a legacy string value)

**When** audit-agent runs Check 10

**Then** audit-agent MUST skip Check 10 entirely
**And** MUST NOT emit any `pm_gate_violations` finding — absence or non-list notes is not a violation in pre-FEAT-004 sessions

**Validated by:**
- Fixture H1 — `notes` key absent; Check 10 skipped with no findings.
- Fixture H2 — `notes` is a string `"legacy string value"` (not a list); Check 10 skipped with no findings.

---

## QA Subagent execution instructions

1. For each fixture (A, B, C, D, E, F, G, H1, H2):
   a. Seed the files listed under that fixture into a temporary
      `.agent-session/FIXTURE-<N>/` path.
   b. Invoke `audit-agent` with a Work Packet pointing to that session's
      `dispatch-manifest.json` and `session.yml`.
   c. Collect the Output Packet emitted by audit-agent.
   d. Assert the findings list matches the "Expected audit outcome" exactly
      (count, `audit_finding_kind`, `severity`, and `ref` values).
   e. For Fixture A and D: assert `status` is not `blocked` due to PM checks
      (other universal checks may or may not fire depending on the minimal
      fixture state — scope assertions to PM-related findings only).
   f. For Fixture B: assert `status: blocked` with at least 2 blocker findings
      of kind `pm_gate_violations`.
   g. For Fixture C: assert `status: blocked` with at least 1 major finding of
      kind `pm_cost_cap_exceeded`.
   h. For Fixture E: assert no `bypass_detected` finding and no
      `pipeline_stage_skipped` finding for the reviewer stage of T-001. Assert
      `reviewer_done: true` for T-001 (scope assertions to Check 4 reviewer gate
      only — other universal checks may fire on the minimal fixture state).
   i. For Fixture F: assert exactly one `incomplete_review` finding with
      `severity: minor` for task T-002's reviewer dispatch. Assert NO
      `bypass_detected` finding (severity: blocker) for T-002.
   j. For Fixture G: assert no `pm_cost_cap_exceeded` finding and no TypeError
      (scope assertions to Check 11 PM findings only). Assert total_cost computed
      as 0.00 (absent entry) + 1.20 (present entry) = 1.20 — sum combines correctly.
      Assert Check 10 passes (valid pm_decision match present).
   k. For Fixture H1: assert no `pm_gate_violations` finding (scope assertions to
      Check 10 PM findings only). Assert Check 11 skipped (no `pm_cost_cap_usd`).
   l. For Fixture H2: assert no `pm_gate_violations` finding (scope assertions to
      Check 10 PM findings only) — `notes` is a string not a list; pre-FEAT-004
      guard fires. Assert Check 11 skipped (no `pm_cost_cap_usd`).

2. Record the Output Packet path per fixture run as evidence in the qa Output
   Packet's `evidence[]`.

3. Map each assertion to its AC in `ac_coverage`:
   - AC-017 → Fixture B assertion (blocker `pm_gate_violations`).
   - AC-018 → Fixture C assertion (major `pm_cost_cap_exceeded`).
   - AC-019 → Fixture B assertion (Check 11 skipped, no finding) AND Fixture G
     assertion (absent cost_usd treated as 0, no TypeError).
   - AC-020 → Fixture D assertion (both checks skipped).
   - AC-021 → Fixture H1 assertion (notes absent; Check 10 skipped, no finding) AND Fixture H2 assertion (notes present but not a list; Check 10 skipped, no finding).
   - AC-009 → Fixture E assertion (`reviewer_done: true`, no `bypass_detected`).
   - AC-010 → Fixture F assertion (`reviewer_done: false`, `incomplete_review` minor, no `bypass_detected`).
