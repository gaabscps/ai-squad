# PM-mode approval gate — spec-writer bypass procedure

Referenced from `skill.md` step 6.5. This runs BEFORE the interactive approval gate (step 7). Canonical source of truth: [`shared/concepts/pm-bypass.md`](../../../shared/concepts/pm-bypass.md) — the procedure below is the verbatim insertion mandated for `spec-writer`.

## Contents
- Bypass procedure (numbered steps 1–4)
- `pm_decision` entry shape
- Phase-specific notes for spec-writer

## Bypass procedure

```
1. Read session.yml.auto_approved_by.
2. IF auto_approved_by != "pm"  (strict equality, case-sensitive, must be string)
      → Proceed to the normal interactive AskUserQuestion approval gate (Step 7). Stop here.

3. Scan the artifact for any [NEEDS CLARIFICATION] markers.
   IF one or more markers remain:
      → REFUSE bypass. Do NOT approve.
      → Attempt to append to session.yml.notes (atomic tmp + rename):
           - kind: pm_escalation
             timestamp: <ISO8601-now>
             phase: "specify"
             artifact_path: ".agent-session/<spec_id>/spec.md"
             open_questions: [<one entry per NEEDS CLARIFICATION block>]
        If the append fails, retry exactly once. If the second attempt
        also fails, raise (do NOT swallow the error silently) — the
        PM persona must be informed that the escalation record could
        not be persisted.
      → Surface to PM persona: "Approval blocked — open questions must be resolved before autonomous approval."
      → Exit the bypass step; leave artifact status unchanged.

4. No markers remain. Approve the artifact in this exact order:

   **Ordering invariant:** evidence MUST land in session.yml before the
   artifact is marked approved. This ensures that if the artifact write
   fails, the audit trail is still present and no ghost-approval exists.

   a. Check for re-entry / partial-write repair:
      - IF session.yml already contains phase_history.specify.approved_by == "pm"
        AND spec.md frontmatter status == "approved":
          REFUSE (raise). A phase that has already been PM-approved AND
          whose artifact is already marked approved MUST NOT be re-approved
          silently; the PM session should not re-run an already-approved phase.
      - IF session.yml already contains phase_history.specify.approved_by == "pm"
        AND spec.md frontmatter status != "approved":
          **Partial-write repair path.** A previous run crashed after writing
          session.yml (step 4.b) but before writing spec.md (step 4.c).
          Do NOT raise. Skip steps 4.b and 4.b'' (session.yml already has the
          evidence). Proceed directly to step 4.c to complete the idempotent
          artifact write, then continue to step 4.d.
      - IF session.yml does NOT contain phase_history.specify.approved_by:
          Continue to step 4.b (normal path).

   b. Perform a single atomic read-modify-write on session.yml (one
      tmp + rename) that writes ALL of the following keys together:
        - phase_history.specify.approved_by: "pm"
        - notes: append the pm_decision entry below
        - current_phase: advance to the next phase per session.yml.planned_phases
      If session.yml.notes is absent, initialize it as an empty list
      before appending.
      **notes contract:** `notes` is ALWAYS a YAML list of objects, each with a
      `kind` discriminator ("pm_decision" | "pm_escalation" | "audit_override")
      per `shared/schemas/session.schema.json`; NEVER a scalar/string, and never
      invent fields outside the schema.
      This single atomic mutation guarantees that
      phase_history, the pm_decision evidence, and current_phase are
      always consistent — there is no partial-write window where one
      exists without the others, which would trigger a false AC-017
      audit violation.

      **current_phase advancement rule (step 4.b''):** read
      session.yml.planned_phases (ordered list); find "specify"; set
      current_phase to the next entry. If "specify" is the last planned
      phase, set current_phase to "done".

   c. Write status: approved to the artifact's frontmatter (spec.md).

   d. Skip the AskUserQuestion approval gate entirely (do not execute Step 7).
   e. Continue to the next step in the Skill's run procedure.
```

## `pm_decision` entry shape (appended to `session.yml.notes`)

```yaml
- kind: pm_decision
  timestamp: "<ISO8601-timestamp>"     # ISO8601, UTC
  phase: "specify"
  artifact_path: ".agent-session/<spec_id>/spec.md"
  gate_applied: "auto_approved_by=pm"
```

## Phase-specific notes for spec-writer
- `[NEEDS CLARIFICATION]` marker ownership: spec-writer MUST insert the marker into `spec.md` BEFORE reaching step 6.5. The scan in step 3 above is the audit check — not the producer of the marker.
- `phase` value in `pm_decision`: `"specify"`.
- `artifact_path`: `.agent-session/<spec_id>/spec.md`.
