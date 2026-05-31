# Dispatch manifest — schema and rules

Referenced from `skill.md` step 1b. The manifest is the **mechanical audit trail** the audit-agent reconciles in step 8 (Outbox + GitHub required-checks pattern). It is JSON, not YAML — hook scripts parse it with Python stdlib `json` (no yaml dependency).

Path: `.agent-session/<spec_id>/dispatch-manifest.json`. Write it atomically (tmp + rename) before any `Task` dispatch, and on every append.

## Initial structure (write before any dispatch)

```json
{
  "schema_version": 1,
  "spec_id": "FEAT-NNN",
  "plan_generated_at": "<iso8601>",
  "expected_pipeline": [
    {
      "task_id": "T-001",
      "required_roles": ["dev", "code-reviewer", "logic-reviewer", "qa"],
      "acScope": ["AC-001", "AC-002"],
      "tasksCovered": ["T-001"]
    },
    {
      "task_id": "T-002",
      "required_roles": ["dev", "code-reviewer", "logic-reviewer", "qa"],
      "acScope": ["AC-003", "AC-004"],
      "tasksCovered": ["T-002"]
    },
    {
      "task_id": null,
      "role_label": "audit-agent",
      "required_roles": ["audit-agent"],
      "acScope": [],
      "tasksCovered": ["T-001", "T-002"]
    }
  ],
  "actual_dispatches": []
}
```

## After every `Task` dispatch, append to `actual_dispatches[]`

```json
{
  "dispatch_id": "<uuid>",
  "task_id": "T-XXX",
  "role": "dev | code-reviewer | logic-reviewer | qa | blocker-specialist | audit-agent",
  "started_at": "<iso8601>",
  "completed_at": "<iso8601>",
  "output_packet_ref": "outputs/<dispatch_id>.json",
  "status": "<Output Packet status>",
  "review_loop": 1,
  "pm_note": null
}
```

### Field rules
- `review_loop`: integer ≥ 1 — increment `task_states[T-XXX].loops` BEFORE appending the dispatch entry to `actual_dispatches[]`; then set `review_loop` to the post-increment value. This guarantees the first dispatch for a task records `review_loop: 1` (not 0), the first retry records `review_loop: 2`, etc. (`task_states` initializes with `loops=0`; first pre-append increment yields 1.) Every dispatch entry MUST include this field. Exception roles: see audit-agent (step 8) and blocker-specialist (step 6) for their derivation rules.
- `pm_note`: non-null string ONLY for notable events; `null` otherwise. Recognized notes:
  - Loop restart: `"Loop N restart — reviewer findings: <one-line summary>"`
  - QA fail loop: `"QA fail loop N — failed ACs: <AC-XXX, AC-YYY>"`
  - Escalation: `"Escalated to blocker-specialist — <trigger kind>"`
  - Progress stall: `"Progress stall detected (fingerprint match)"`

### `expected_pipeline[]` population rules (AC-005)
- `acScope`: array of AC-IDs from the task's `ac_scope` field in `tasks.md` (e.g. `["AC-001", "AC-002"]`). For `audit-agent`, set to `[]` (audit validates all tasks, not a specific AC subset).
- `tasksCovered`: for task-scoped roles (dev, code-reviewer, logic-reviewer, qa), always `[task_id]` (single-element array). For `audit-agent`, set to the full list of all `T-XXX` IDs in the pipeline. Both fields are required for the audit-agent reconciliation step.

## On `--resume`
Read the existing manifest, do NOT re-write `expected_pipeline`; continue appending to `actual_dispatches[]`.
