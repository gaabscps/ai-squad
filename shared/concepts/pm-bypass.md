# Concept — PM-mode Bypass (`auto_approved_by: pm`)

> Status: canonical. Referenced verbatim by /spec-writer, /designer, /task-builder.

## Definition

**`auto_approved_by`** is an optional string field in `session.yml` that signals the PM Skill is running the session autonomously. When its value is exactly `"pm"` (lowercase, strict equality), the three Phase Skills (`spec-writer`, `designer`, `task-builder`) skip their interactive `AskUserQuestion` approval gates and approve the artifact programmatically. The PM persona (running in the main session) is the gate — the interactive prompt is replaced by a written evidence trail.

**`"pm"`** (the activation value) represents the `/pm` Skill executing as an autonomous Senior-PM reviewer across all Phases. Any other value — including absent, null, `"PM"`, `True`, `"yes"`, or a non-string — is treated identically to absent and the normal interactive path runs unchanged.

This field is part of the `session.yml` additive extension introduced in FEAT-004 (see `shared/schemas/dispatch-manifest.schema.json` for the broader schema context).

## The bypass step

The following pseudocode step is inserted into each Phase Skill's "Run procedure" **before** the final approval gate. The three Skills reference this section verbatim — it is the single source of truth for bypass behavior.

**Step: PM-mode approval gate check**

```
1. Read session.yml.auto_approved_by.
2. IF auto_approved_by != "pm"  (strict equality, case-sensitive, must be string)
      → Proceed to the normal interactive AskUserQuestion approval gate. Stop here.

3. Scan the artifact for any [NEEDS CLARIFICATION] markers.
   IF one or more markers remain:
      → REFUSE bypass. Do NOT approve.
      → Attempt to append to session.yml.notes (atomic tmp + rename):
           - kind: pm_escalation
             timestamp: "<ISO8601-now>"
             phase: <phase-name>
             artifact_path: <path-to-artifact>
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
      - IF session.yml already contains phase_history.<phase>.approved_by == "pm"
        AND the artifact's frontmatter status == "approved":
          REFUSE (raise). A phase that has already been PM-approved AND
          whose artifact is already marked approved MUST NOT be re-approved
          silently; the PM session should not re-run an already-approved phase.
      - IF session.yml already contains phase_history.<phase>.approved_by == "pm"
        AND the artifact's frontmatter status != "approved":
          **Partial-write repair path.** A previous run crashed after writing
          session.yml (step 4.b) but before writing the artifact (step 4.c).
          Do NOT raise. Skip steps 4.b and 4.b'' (session.yml already has the
          evidence). Proceed directly to step 4.c to complete the idempotent
          artifact write, then continue to step 4.d.
      - IF session.yml does NOT contain phase_history.<phase>.approved_by:
          Continue to step 4.b (normal path).

   b. Perform a single atomic read-modify-write on session.yml (one
      tmp + rename) that writes ALL of the following keys together:
        - phase_history.<phase>.approved_by: "pm"
        - notes: append the pm_decision entry below
        - current_phase: advance to the next phase per session.yml.planned_phases
      If session.yml.notes is absent, initialize it as an empty list
      before appending. This single atomic mutation guarantees that
      phase_history, the pm_decision evidence, and current_phase are
      always consistent — there is no partial-write window where one
      exists without the others, which would trigger a false AC-017
      audit violation.

      **current_phase advancement rule (step 4.b''):** read
      session.yml.planned_phases (ordered list); find the entry
      matching the current phase; set current_phase to the next entry
      in that list. If the current phase is the last planned phase,
      set current_phase to "done". This mirrors the advancement logic
      in the normal interactive approval path (Step 7).

   c. Write status: approved to the artifact's frontmatter.

   d. Skip the AskUserQuestion approval gate entirely.
   e. Continue to the next step in the Skill's run procedure.
```

**`pm_decision` entry shape** (written to `session.yml.notes` as a YAML list item):

```yaml
- kind: pm_decision
  timestamp: "<ISO8601-timestamp>"     # ISO8601, UTC
  phase: "specify"                     # literal: "specify" | "plan" | "tasks"
  artifact_path: ".agent-session/FEAT-XXX/spec.md"
  gate_applied: "auto_approved_by=pm"
```

The `audit-agent` reconciliation check (`pm_gate_violations`, AC-017) matches `phase_history.<phase>.approved_by == "pm"` against this entry by `artifact_path` and `timestamp` (within ±60 seconds). Both fields are mandatory.

## Phase-specific notes

### spec-writer (Step 6.5 — before Step 7)

- The bypass step is inserted as Step 6.5 between the final Spec drafting step and the approval gate (Step 7).
- The `[NEEDS CLARIFICATION]` escalation (AC-012) fires on any unresolved spec questions — e.g., an open question that the `/pm` persona must adjudicate before the Spec can be considered complete.
- **Marker ownership:** spec-writer MUST insert the `[NEEDS CLARIFICATION]` marker into the artifact BEFORE invoking the bypass step. The bypass step's scan in Step 3 is the audit check — it is not the producer of the marker. If spec-writer reaches Step 6.5 without inserting a required marker, the bypass step will incorrectly approve a deficient artifact.
- `phase` value in `pm_decision`: `"specify"`.
- `artifact_path`: the spec.md file under `.agent-session/<task_id>/spec.md`.

### designer (Step 6.5 — before Step 7)

- The bypass step is inserted as Step 6.5 between the AC coverage gate (Step 6) and the final approval gate (Step 7).
- The `[NEEDS CLARIFICATION]` escalation (AC-012) in the design context covers **AC coverage gaps** as well: if the Plan does not trace coverage for every AC in the Spec, the designer MUST insert a `[NEEDS CLARIFICATION]` marker into `plan.md` in **Step 6** (AC coverage gate, PM-mode branch) BEFORE reaching Step 6.5. This prevents the PM from auto-approving a Plan with known coverage holes.
- **Marker ownership:** designer MUST insert the `[NEEDS CLARIFICATION]` marker into `plan.md` in Step 6 — BEFORE invoking the bypass step. The bypass step's scan in Step 3 is the audit check — not the producer of the marker. Step 6 is responsible for detecting AC coverage gaps and inserting the marker atomically (tmp + rename); Step 6.5 only verifies absence.
- `phase` value in `pm_decision`: `"plan"`.
- `artifact_path`: the plan.md file under `.agent-session/<task_id>/plan.md`.

### task-builder (Step 9 — bypass — runs before Step 10)

- The bypass step replaces/wraps the existing approval gate at Step 9.
- The `[NEEDS CLARIFICATION]` escalation (AC-012) in the task-builder context covers two additional refusal triggers:
  1. **`[P]`-violation (Step 3 PM-mode branch):** if a proposed parallel-safe (`[P]`) task would share write scope with another `[P]` task in the same wave, task-builder MUST insert a `[NEEDS CLARIFICATION] [P]-violation: <task-id> shares write scope with <conflicting-task-id>` marker into `tasks.md` (atomic write). In interactive mode the default is to remove the `[P]`; in PM-mode silently removing it masks the violation from the bypass scan. The marker producer is Step 3 of task-builder — NOT the bypass step.
  2. **AC-coverage gap (Step 8 PM-mode branch):** if any Spec AC is uncovered by the task list, task-builder MUST insert a `[NEEDS CLARIFICATION] AC-coverage gap: <AC-XXX> uncovered` marker per uncovered AC (atomic write). In interactive mode the default is to loop back to Step 7 (interactive refinement); in PM-mode Step 7 is not available, so the loop would hang. The marker producer is Step 8 of task-builder — NOT the bypass step. This mirrors the designer pattern (T-013).
- **Clarification cap:** in interactive mode, `[NEEDS CLARIFICATION]` markers are capped at 3 (Step 6). In PM-mode there is NO cap — every unresolved ambiguity MUST get its own marker so the bypass scan in Step 9 detects all violations. Demoting excess violations to a `## Decisions deferred` section in PM-mode would hide them from the audit check.
- **Marker ownership summary:** task-builder (Steps 3, 6, 8) is the PRODUCER of all `[NEEDS CLARIFICATION]` markers. Step 9 (bypass) is the CONSUMER (scanner). The bypass step's scan is the audit — it does not produce markers. If task-builder reaches Step 9 without having inserted required markers, the bypass step will incorrectly approve a deficient artifact.
- `phase` value in `pm_decision`: `"tasks"`.
- `artifact_path`: the tasks.md file under `.agent-session/<task_id>/tasks.md`.

## Setting `auto_approved_by` in `session.yml`

The PM Skill writes `auto_approved_by: "pm"` to `session.yml` at the start of an autonomous run, before dispatching any Phase Skill. The field lives at the top level of `session.yml`:

```yaml
# session.yml (excerpt)
auto_approved_by: "pm"    # written by /pm at autonomous-run entry
pm_cost_cap_usd: null     # optional; absent = no cap enforcement
notes: []                 # pm_decision + pm_escalation entries appended here
```

When `auto_approved_by` is absent (a normal interactive run), `session.yml` simply does not carry the field. Phase Skills check for presence + exact value — absence is equivalent to `null` for bypass logic purposes.

The field MUST NOT be set manually by the human outside of `/pm` invocation. Setting it manually and then running a Phase Skill interactively defeats the audit trail — `audit-agent` will flag the mismatch between `approved_by: "pm"` in `phase_history` and the absence of a valid `pm_decision` evidence line (AC-017).

## Anti-patterns

The following values look like valid activation but are NOT — they all fall through to the normal interactive gate:

| Value | Why it fails |
|-------|-------------|
| `"PM"` | Strict lowercase equality required. `"PM" != "pm"`. |
| `"Pm"` | Same — case-sensitive. |
| `True` (boolean) | Not a string. YAML `true` parses as boolean, not `"pm"`. |
| `true` (boolean string `"true"`) | Not `"pm"`. |
| `"yes"` | Not `"pm"`. |
| `1` | Not a string. |
| `""` (empty string) | Not `"pm"`. |
| absent / null / `~` | Absent field — interactive gate runs as today. |

**Why strict equality:** any looser check (truthy, case-insensitive, regex) would allow accidental activation from YAML authoring errors (e.g., forgot quotes → boolean `true`). The PM bypass is a high-stakes operation (skips human review); false-positive activation is worse than false-negative.

**Why lowercase only:** the canonical invocation is `/pm` (lowercase slug). `"pm"` mirrors the slash-command handle. Anything that is not the exact handle is not the PM.
