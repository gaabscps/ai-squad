# Handoff — 3 shapes, one skeleton (Conventional Commits + 4 fixed sections)

Referenced from `skill.md` step 9. Emit the handoff message to console AND save to `.agent-session/<spec_id>/handoff.md`. Write the prose in `session.yml.output_locale` (narrative sentences + Summary/Validation/Follow-ups bullets); keep the fixed skeleton — section headers, the Conventional Commits title `type(scope):`, table column keys, enum values (`done`/`pending_human`), and identifiers — canonical English. Absent → `en`.

**Title:** `<type>(<scope>): <imperative summary>` (Conventional Commits — renders cleanly in GitHub/Linear/Jira).

## Body skeleton (all shapes)
```
## Summary
- 1-3 bullets: what was built, headline outcome.

## Per-task status
| ID    | Title          | Status         | Loops used               | Evidence              |
|-------|----------------|----------------|--------------------------|-----------------------|
| T-001 | <title>        | done           | review:1, qa:0           | <file refs>           |
| T-002 | <title>        | pending_human  | review:3 (cap), blocker:2 (cap) | <decision memo path>  |

## Validation
- AC coverage: N/N ACs validated (qa Output Packets aggregated)
- Test commands run: `<cmd>` (exit 0)
- escalation_rate: X% (target: 10-15%)

## Follow-ups / Escalations
- T-XXX: <human action required, link to decision memo>
- (or `(none — ready to ship)` for uniform success)
```

## Four shape variants (closing line varies)
- **Uniform success** (all tasks done, audit clean): `"Implementation done. Changes are unstaged in the working tree — review with git diff / git status, then commit when ready. Run /ship FEAT-NNN to clean up the session."`
- **Mixed status** (some pending_human, audit clean): `"Partial completion. <N> done, <M> awaiting human decision. Changes are unstaged — review before committing. After resolving the blockers: /orchestrator FEAT-NNN --resume (default) | /orchestrator FEAT-NNN --restart (if prior work is invalidated)."`
- **Full escalate** (all pending_human): `"Pipeline escalated. All tasks blocked. See decision memos at .agent-session/<spec_id>/decisions/ and resolve before /orchestrator FEAT-NNN --resume."`
- **Audit-failure handoff** (step 8 returned `blocked` or `escalate` — issue #1 mitigation): emit a refusal handoff, NOT one of the three above. The opening line varies by the audit-agent's `blocker_kind` (do NOT default to the bypass narrative — it is wrong and alarming for a format defect). Skeleton:
  ```
  ## Pipeline integrity audit FAILED — handoff refused

  <opening line, selected by blocker_kind:>
  - bypass_detected:   The dispatch manifest does not reconcile with actual execution — the orchestrator likely bypassed Subagent dispatch and did the work directly (or fabricated outputs). (If the only findings were `orchestrator_edited_source` and a human was present, the Layer 2 authorization in skill.md step 8 ran first; this refusal means it was unavailable — PM-autonomous — or the human denied the change.)
  - schema_violation:  The pipeline ran and the work may be correct, but one or more Output Packets are malformed (missing required fields). This is an artifact-format defect, not a bypass.
  - pipeline_stage_skipped: A required pipeline stage did not run for one or more tasks.
  - audit_inconclusive / other: The audit gate could not confirm pipeline integrity (see findings).

  ## Audit findings
  | gap_kind                    | severity | ref                                |
  |-----------------------------|----------|------------------------------------|
  | <one row per finding from audit-agent's Output Packet>            |

  ## What to do
  1. Inspect `.agent-session/FEAT-NNN/dispatch-manifest.json` and `outputs/` directly.
  2. For `bypass_detected`: if findings reflect a real bypass, discard the working-tree changes (`git restore .`) and re-run `/orchestrator FEAT-NNN --restart`.
  2b. For `schema_violation`: the source changes are likely sound; re-run `/orchestrator FEAT-NNN --restart` to re-dispatch the real subagents so they re-emit well-formed packets (do NOT hand-edit packets under `outputs/` — `guard-session-scope.py` blocks it and it was the FEAT-010 gaming pattern).
  3. If findings are false positives: file an issue with the audit-agent's Output Packet attached (`.agent-session/FEAT-NNN/outputs/<audit-dispatch-id>.json`).
  ```
