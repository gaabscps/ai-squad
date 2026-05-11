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
             timestamp: <ISO8601-now>
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

   a. Check for re-entry: if session.yml already contains
      phase_history.<phase>.approved_by, REFUSE (raise). A phase that
      has already been PM-approved MUST NOT be re-approved silently;
      the PM session should not re-run an already-approved phase.

   b. Perform a single atomic read-modify-write on session.yml (one
      tmp + rename) that writes BOTH of the following keys together:
        - phase_history.<phase>.approved_by: "pm"
        - notes: append the pm_decision entry below
      If session.yml.notes is absent, initialize it as an empty list
      before appending. This single atomic mutation guarantees that
      phase_history and the pm_decision evidence are always consistent
      — there is no partial-write window where one exists without the
      other, which would trigger a false AC-017 audit violation.

   c. Write status: approved to the artifact's frontmatter.

   d. Skip the AskUserQuestion approval gate entirely.
   e. Continue to the next step in the Skill's run procedure.
```

**`pm_decision` entry shape** (written to `session.yml.notes` as a YAML list item):

```yaml
- kind: pm_decision
  timestamp: "2026-05-11T05:42:00Z"   # ISO8601, UTC
  phase: "specify"                     # literal: "specify" | "plan" | "tasks"
  artifact_path: ".agent-session/FEAT-004/spec.md"
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

### designer (Step 7 — replacing the approval gate)

- The bypass step replaces/wraps the existing approval gate at Step 7.
- The `[NEEDS CLARIFICATION]` escalation (AC-012) in the design context covers **AC coverage gaps** as well: if the Plan does not trace coverage for every AC in the Spec, the designer MUST insert a `[NEEDS CLARIFICATION]` marker before reaching the bypass step. This prevents the PM from auto-approving a Plan with known coverage holes.
- **Marker ownership:** designer MUST insert the `[NEEDS CLARIFICATION]` marker into plan.md BEFORE invoking the bypass step. The bypass step's scan is the audit, not the producer. Designer is responsible for detecting AC coverage gaps and inserting the marker prior to Step 7; the bypass step only verifies absence.
- `phase` value in `pm_decision`: `"plan"`.
- `artifact_path`: the plan.md file under `.agent-session/<task_id>/plan.md`.

### task-builder (Step 9 — replacing the approval gate)

- The bypass step replaces/wraps the existing approval gate at Step 9.
- The `[NEEDS CLARIFICATION]` escalation (AC-012) in the task-builder context covers two additional refusal triggers:
  1. **`[P]`-violation:** if a proposed parallel-safe (`[P]`) task would share write scope with another `[P]` task in the same wave, the task-builder MUST insert a `[NEEDS CLARIFICATION]` marker rather than emitting a potentially unsafe tasks.md.
  2. **AC-coverage gap:** if any Spec AC is uncovered by the task list, same treatment as designer.
- **Marker ownership:** task-builder MUST insert the `[NEEDS CLARIFICATION]` marker into tasks.md BEFORE invoking the bypass step for either trigger above. The bypass step's scan is the audit, not the producer. Task-builder is responsible for detecting `[P]`-violations and AC-coverage gaps and inserting markers prior to Step 9.
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
