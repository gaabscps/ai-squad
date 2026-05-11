---
id: TEST-AUDIT-PM-CHECKS
feature_id: FEAT-004
ac_scope: [AC-017, AC-018, AC-019, AC-020]
depends_on: T-024
check_refs: [audit-agent.md#check-10, audit-agent.md#check-11]
created: 2026-05-11
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

**Then** audit-agent MUST skip the `pm_cost_within_budget` check entirely and
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

## QA Subagent execution instructions

1. For each fixture (A, B, C, D):
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

2. Record the Output Packet path per fixture run as evidence in the qa Output
   Packet's `evidence[]`.

3. Map each assertion to its AC in `ac_coverage`:
   - AC-017 → Fixture B assertion (blocker `pm_gate_violations`).
   - AC-018 → Fixture C assertion (major `pm_cost_cap_exceeded`).
   - AC-019 → Fixture B assertion (Check 11 skipped, no finding).
   - AC-020 → Fixture D assertion (both checks skipped).
