---
name: discovery-orchestrator
description: Phase 2 (Investigate) entry point. Dispatches codebase-mapper + 4× risk-analyst in parallel; aggregates findings into `memo.md`.
---

# Discovery Orchestrator — Phase 2 (Investigate)

The Skill that turns an approved Frame into structured Investigate Findings. Owns the dispatch sequence (sequential mapper → parallel risk fan-out), the aggregation into the memo, and the conditional gate to Phase 3.

The dispatch shape follows two industry-validated patterns:
- **Cagan's Four Big Risks** investigated in parallel by distinct owners after a shared context pass (`shared/glossary.md` and SVPG: *Product Risk Taxonomy*, *Discovery Sprints*).
- **Timebox > retry** — Discovery does not loop on inconclusive findings the way Phase 4 of the SDD squad loops on failed reviews. If a `risk-analyst` cannot conclude, it returns `verdict: inconclusive` and the orchestrator escalates rather than retrying.

## When to invoke
- `/discovery-orchestrator DISC-NNN` — start Phase 2 for a Discovery Session whose Frame is approved.
- `/discovery-orchestrator DISC-NNN --resume` — resume a paused or escalated Phase 2 (re-reads aggregated state from `memo.md` + `session.yml`; does NOT re-dispatch already-completed Subagents).

## Refuse when
- No Session at `.agent-session/<task_id>/` → message: `"No Session at .agent-session/<task_id>/. Run /discovery-lead to start Phase 1 first."`
- `session.yml.squad ≠ discovery` → message: `"Session <task_id> belongs to squad '<squad>', not discovery. Use the orchestrator Skill for that squad."`
- `session.yml.current_phase ≠ investigate` → message: `"Session <task_id> is in phase '<current_phase>'. Phase 2 entry requires current_phase: investigate."`
- `memo.md` missing OR `memo.md.phase_completed ≠ frame` → message: `"Frame is not approved. Run /discovery-lead DISC-NNN to complete Phase 1 first."`
- Existing Session is in terminal state (`paused | done | escalated`) and `--resume` not passed → message: `"Session <task_id> is <state>. Pass --resume to continue, or /ship DISC-NNN to clean up."`
- `session.yml.schema_version` newer than this Skill knows → message: `"Session schema_version <N> is newer than this Skill's <M>. Upgrade ai-squad before continuing."`

## Inputs (preconditions)
- `.agent-session/<task_id>/session.yml` with `squad: discovery`, `current_phase: investigate`, `planned_phases` includes `investigate`.
- `.agent-session/<task_id>/memo.md` with `status: approved`, `phase_completed: frame`, Q1–Q9 populated.

## Steps

### 1. Validate Session and Frame
Verify all preconditions in the refusal matrix. On any failure, refuse and exit cleanly (no Session mutation).

### 2. Dispatch `codebase-mapper` (sequential bootstrap)
Emit one Work Packet to `.agent-session/<task_id>/inputs/codebase-mapper-<dispatch_id>.json`:
- `to_role: "codebase-mapper"`
- `objective`: "Map the technical surface area relevant to this Discovery opportunity. Output: surface map covering modules touched, integration points, current architecture constraints. No risk analysis — that is the next step."
- `input_refs: ["./memo.md"]`
- `scope_files`: derived from Frame Q9 (Critical Success Factors) hints, OR empty (mapper decides surface).

Wait for Output Packet at `.agent-session/<task_id>/outputs/codebase-mapper-<dispatch_id>.json`. Validate against canonical Output Packet schema.

**On `status: blocked` from mapper** → cascade to `blocker-specialist` (Subagent reused from SDD squad) with the failing Output Packet. If `blocker-specialist` cannot resolve → escalate (jump to step 8, `escalation_summary` populated).

### 3. Dispatch 4× `risk-analyst` in parallel (fan-out)
Emit 4 Work Packets in parallel, one per Cagan Big Risk. All written to `.agent-session/<task_id>/inputs/risk-analyst-<risk_category>-<dispatch_id>.json`:

| Risk category | Objective focus |
|---------------|-----------------|
| `value` | Will users use this? Validate the Frame's Problem (Q1) against what users do today (Q4 Alternatives). |
| `usability` | Can users figure out how to use it? Inspect UX surface, friction points, expected workflows. |
| `feasibility` | Can engineering build it within constraints? Inspect codebase-mapper output, dependencies, integration risk. |
| `viability` | Does it work for our business? Inspect Frame Q7 (Go-to-Market) + Q8 (Success Metric) feasibility. |

Each Work Packet carries:
- `to_role: "risk-analyst"`
- `risk_category: "<value|usability|feasibility|viability>"` (custom field; risk-analyst frontmatter declares awareness)
- `input_refs: ["./memo.md", "./outputs/codebase-mapper-<dispatch_id>.json"]`
- `objective`: derived from the table above + risk_category-specific framing.

Wait for all 4 Output Packets. Validate each against canonical schema. risk-analyst-specific fields (`risk_category`, `verdict`, `severity`) are required; canonical schema treats them as optional fields valid only when `role: risk-analyst`.

**Per-risk N/A handling:** if a Work Packet's risk category does not apply (e.g. `value` risk for an internal infra change), the risk-analyst returns `verdict: "N/A"` with `rationale` (1 sentence) explaining why. Orchestrator does NOT treat `N/A` as failure.

**Per-risk inconclusive handling:** if a risk-analyst returns `verdict: "inconclusive"` (insufficient data, requires user research, requires external input) → do NOT cascade individually. Continue gathering all 4 outputs first; the conditional gate at step 6 handles inconclusive collectively.

### 4. Aggregate the 5 Output Packets
Build aggregated state in memory:
- 1× codebase-mapper output (surface map, free text)
- 4× risk-analyst outputs (each with `risk_category`, `verdict`, `severity`, `rationale`, `evidence[]`)

No synthesis — only structured aggregation. Synthesis (Recommendation, Decision) is the responsibility of `discovery-synthesizer` in Phase 3.

### 5. Write `## Investigate Findings` into `memo.md`
Atomic write (tmp + rename). Replace the existing placeholder `## Investigate Findings` section with the populated structure:

```markdown
## Investigate Findings

### Codebase Map
<from codebase-mapper Output Packet — surface, key modules, integration points>

### Risk Analysis (Cagan's Four Big Risks)
- **Value** — verdict: <validated|refuted|inconclusive|N/A> · severity: <low|medium|high>
  Rationale: <one paragraph>
  Evidence: <bullet list>
- **Usability** — <same shape>
- **Feasibility** — <same shape>
- **Viability** — <same shape>
```

Update `memo.md.phase_completed: investigate` only AFTER step 6 resolves (gate or auto-advance).

### 6. Conditional approval gate (Hybrid policy)
Decide gate vs auto-advance based on the 4 risk verdicts:

- **Auto-advance** if ALL 4 verdicts ∈ `{validated, refuted, N/A}` AND ALL 4 severities ∈ `{low, medium}`.
- **Approval gate** if ANY verdict is `inconclusive` OR ANY severity is `high`.

When gate triggers, print the visual checklist (Kiro pattern):

```
Investigate Findings ready for review:
[<status>] Value risk      — verdict: <X> · severity: <Y>
[<status>] Usability risk  — verdict: <X> · severity: <Y>
[<status>] Feasibility risk — verdict: <X> · severity: <Y>
[<status>] Viability risk  — verdict: <X> · severity: <Y>
[<flag>]   Inconclusive items: <count>
[<flag>]   High severity items: <count>

Findings written to: .agent-session/DISC-NNN/memo.md
```

Then use `AskUserQuestion` with binary choice:
```
Proceed to Phase 3 (Decide), or stop here?
[ ] Proceed — synthesizer will weigh options including the inconclusive items
[ ] Stop — Session pauses; resume later with /discovery-orchestrator DISC-NNN --resume after gathering more data
```

On `Stop` → set `current_phase: paused` in `session.yml`; populate `phase_history.investigate` with `pause_reason`; exit cleanly.

### 7. Update Session and advance
On auto-advance OR gate `Proceed`:
- `memo.md.phase_completed: investigate` (atomic write)
- `session.yml.current_phase`: advances per `planned_phases` (`decide` if planned, else `paused`)
- `session.yml.phase_history.investigate`: populated (`completed_at`, `dispatches_summary`, `escalation_count`)

### 8. Escalation path (if codebase-mapper blocked OR blocker-specialist returns escalate)
- Set `session.yml.current_phase: escalated`
- Populate `phase_history.investigate.escalation_summary` with the failing Output Packet pointer + blocker-specialist's recommendation
- Print escalation summary to the human; surface the next command (`--resume` or `/ship`)

### 9. Final handoff message
See Handoff section below.

## Output
- `memo.md` populated with `## Investigate Findings` (codebase map + 4 risk analyses); `phase_completed: investigate`
- `.agent-session/<task_id>/inputs/` and `outputs/` carry the 5 dispatch packets (audit trail)
- `session.yml` advanced to `decide` (or `paused`/`escalated`)

## Handoff (dynamic, based on planned_phases + outcomes)
- **Auto-advance, `decide` planned:** `"Investigate complete (4/4 risks investigated, 0 inconclusive). Findings written to memo.md. Next: run /discovery-synthesizer DISC-NNN to start Phase 3 (Decide)."`
- **Gate Proceed, `decide` planned:** `"Investigate complete with <N> inconclusive and <M> high-severity risks (you reviewed and proceeded). Next: /discovery-synthesizer DISC-NNN — synthesizer will weigh these explicitly."`
- **Gate Stop:** `"Session paused after Investigate. Resume later with /discovery-orchestrator DISC-NNN --resume after addressing: <list of inconclusive items>."`
- **`decide` not planned:** `"Investigate complete. Decide was not planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship DISC-NNN."`
- **Escalated:** `"Investigate escalated. blocker-specialist could not resolve <blocker_summary>. See memo.md and session.yml.phase_history.investigate.escalation_summary. To retry: /discovery-orchestrator DISC-NNN --resume after addressing the blocker."`

## Failure modes
- **codebase-mapper returns `blocked`:** cascade to `blocker-specialist`; if unresolved, escalate (step 8). Mapper is the only sequential bottleneck — its failure stops the parallel fan-out.
- **One risk-analyst returns `blocked`:** treat the same as cascade — do NOT block the other 3 instances. Aggregation step records the blocked instance with `verdict: blocked` and gate triggers.
- **Multiple risk-analysts return `inconclusive`:** acceptable; gate at step 6 surfaces all of them to the human in one decision.
- **Output Packet validation failure (malformed JSON, missing required field):** orchestrator rejects the packet, marks the dispatch as `verdict: blocked` with reason `validation_failure`, cascades. Subagents are stateless — orchestrator does NOT re-dispatch the same Subagent automatically (timebox > retry; human decides via `--resume`).
- **Human abandons mid-dispatch:** state on disk reflects last atomic write. `--resume` re-reads `session.yml` + already-completed Output Packets; only re-dispatches what is missing.
- **`schema_version` mismatch on resume:** refuse per refusal matrix.

## Why a Skill (not a Subagent)
Phase 2 dispatches Subagents (`codebase-mapper` + 4× `risk-analyst`) and surfaces a conditional gate to the human. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `shared/concepts/skill-vs-subagent.md`).

## Communication style
This Skill talks to two audiences with different conventions:

**Agent → Subagent (Work Packet only, no fluff):**
- Work Packets carry pointers (`spec_ref`, `input_refs`, `scope_files`), never inline content.
- `objective` field ≤ 80 chars when possible; expand only when risk_category framing requires it.
- No prose preamble in dispatch — only the structured packet.

**Agent → User (friendly, clear, guided):**
- Friendly, direct tone; no marketing speak.
- Markdown tables for the gate checklist; bullets for the handoff verdict summary.
- `AskUserQuestion` only for the binary gate decision (Proceed/Stop) — no `AskUserQuestion` during dispatch (Subagents run autonomously).
- Always end with a guided next-step message — even on escalation, name the command to retry.
