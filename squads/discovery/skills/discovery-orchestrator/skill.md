---
name: discovery-orchestrator
description: Phase 2 (Investigate) entry point for the Discovery squad. Dispatches codebase-mapper (sequential bootstrap) then 4× risk-analyst in parallel (Cagan's Four Big Risks), aggregates the 5 Output Packets into `memo.md`, and runs a conditional approval gate before Phase 3. Use when running `/discovery-orchestrator DISC-NNN` on a Session whose Frame is approved, or `--resume` on a paused/escalated one.
---

# Discovery Orchestrator — Phase 2 (Investigate)

Turns an approved Frame into structured Investigate Findings. Owns the dispatch sequence (sequential mapper → parallel risk fan-out), the aggregation into the memo, and the conditional gate to Phase 3.

Two patterns govern the phase:
- **Cagan's Four Big Risks** (value, usability, feasibility, viability) investigated in parallel by distinct owners after a shared context pass — SVPG *Product Risk Taxonomy* + *Discovery Sprints*; see `shared/glossary.md`.
- **Timebox > retry.** Discovery does NOT loop on inconclusive findings the way SDD Phase 4 loops on failed reviews. A `risk-analyst` that cannot conclude returns `verdict: inconclusive`; the orchestrator escalates rather than retrying.

The risk fan-out contract (dispatch, aggregation, gate) lives in a flat reference — read it when you reach step 3:
- [`risk-fanout.md`](risk-fanout.md) — 4× risk-analyst dispatch table, per-risk verdict handling, memo template, conditional gate (steps 3–6)

## When to invoke
- `/discovery-orchestrator DISC-NNN` — start Phase 2 for a Session whose Frame is approved.
- `/discovery-orchestrator DISC-NNN --resume` — resume a paused or escalated Phase 2. Re-reads aggregated state from `memo.md` + `session.yml`; does NOT re-dispatch already-completed Subagents.

## Refuse when
- No Session at `.agent-session/<spec_id>/` → `"No Session at .agent-session/<spec_id>/. Run /discovery-lead to start Phase 1 first."`
- `session.yml.squad ≠ discovery` → `"Session <spec_id> belongs to squad '<squad>', not discovery. Use the orchestrator Skill for that squad."`
- `session.yml.current_phase ≠ investigate` → `"Session <spec_id> is in phase '<current_phase>'. Phase 2 entry requires current_phase: investigate."`
- `memo.md` missing OR `memo.md.phase_completed ≠ frame` → `"Frame is not approved. Run /discovery-lead DISC-NNN to complete Phase 1 first."`
- Existing Session in terminal state (`paused | done | escalated`) and `--resume` not passed → `"Session <spec_id> is <state>. Pass --resume to continue, or /ship DISC-NNN to clean up."`
- `session.yml.schema_version` newer than this Skill knows → `"Session schema_version <N> is newer than this Skill's <M>. Upgrade ai-squad before continuing."`

## Inputs (preconditions)
- `.agent-session/<spec_id>/session.yml` with `squad: discovery`, `current_phase: investigate`, `planned_phases` includes `investigate`.
- `.agent-session/<spec_id>/memo.md` with `status: approved`, `phase_completed: frame`, Q1–Q9 populated.

## Steps

### 1. Validate Session and Frame
Verify every precondition in the refusal matrix. On any failure, refuse and exit cleanly — no Session mutation.

### 2. Dispatch `codebase-mapper` (sequential bootstrap)
Emit one Work Packet to `.agent-session/<spec_id>/inputs/codebase-mapper-<dispatch_id>.json`:
- `to_role: "codebase-mapper"`
- `objective`: "Map the technical surface area relevant to this Discovery opportunity. Output: surface map covering modules touched, integration points, current architecture constraints. No risk analysis — that is the next step."
- `input_refs: ["./memo.md"]`
- `scope_files`: derived from Frame Q9 (Critical Success Factors) hints, OR empty (mapper decides surface).

Wait for the Output Packet at `.agent-session/<spec_id>/outputs/codebase-mapper-<dispatch_id>.json`. Validate against the canonical Output Packet schema.

**On `status: blocked` from mapper** → cascade to `blocker-specialist` (Subagent reused from SDD squad) with the failing Output Packet. If `blocker-specialist` cannot resolve → escalate (step 8). The mapper is the only sequential bottleneck — its failure stops the parallel fan-out.

### 3–6. Risk fan-out → aggregate → write memo → gate
Dispatch the four Cagan Big Risks in parallel, aggregate the 5 Output Packets into `memo.md`, and run the conditional approval gate. Full contract — dispatch table, per-risk verdict handling (N/A, inconclusive, blocked), memo template, and the auto-advance-vs-gate decision — in [`risk-fanout.md`](risk-fanout.md).

Set `memo.md.phase_completed: investigate` only AFTER the gate resolves (step 7).

### 7. Update Session and advance
On auto-advance OR gate `Proceed`:
- `memo.md.phase_completed: investigate` (atomic write).
- `session.yml.current_phase`: advances per `planned_phases` (`decide` if planned, else `paused`).
- `session.yml.phase_history.investigate`: populated (`completed_at`, `dispatches_summary`, `escalation_count`).

### 8. Escalation path (codebase-mapper blocked OR blocker-specialist returns escalate)
- Set `session.yml.current_phase: escalated`.
- Populate `phase_history.investigate.escalation_summary` with the failing Output Packet pointer + blocker-specialist's recommendation.
- Print the escalation summary; surface the next command (`--resume` or `/ship`).

### 9. Final handoff message
See Handoff below.

## Output
- `memo.md` populated with `## Investigate Findings` (codebase map + 4 risk analyses); `phase_completed: investigate`.
- `.agent-session/<spec_id>/inputs/` and `outputs/` carry the 5 dispatch packets (audit trail).
- `session.yml` advanced to `decide` (or `paused`/`escalated`).

## Handoff (dynamic, based on planned_phases + outcomes)
- **Auto-advance, `decide` planned:** `"Investigate complete (4/4 risks investigated, 0 inconclusive). Findings written to memo.md. Next: run /discovery-synthesizer DISC-NNN to start Phase 3 (Decide)."`
- **Gate Proceed, `decide` planned:** `"Investigate complete with <N> inconclusive and <M> high-severity risks (you reviewed and proceeded). Next: /discovery-synthesizer DISC-NNN — synthesizer will weigh these explicitly."`
- **Gate Stop:** `"Session paused after Investigate. Resume later with /discovery-orchestrator DISC-NNN --resume after addressing: <list of inconclusive items>."`
- **`decide` not planned:** `"Investigate complete. Decide was not planned for this Session — Session is now paused. To extend later, edit planned_phases in session.yml. To clean up: /ship DISC-NNN."`
- **Escalated:** `"Investigate escalated. blocker-specialist could not resolve <blocker_summary>. See memo.md and session.yml.phase_history.investigate.escalation_summary. To retry: /discovery-orchestrator DISC-NNN --resume after addressing the blocker."`

## Failure modes
- **codebase-mapper returns `blocked`:** cascade to `blocker-specialist`; if unresolved, escalate (step 8). The mapper is the only sequential bottleneck — its failure stops the parallel fan-out.
- **One risk-analyst returns `blocked`:** cascade the same way; do NOT block the other 3 instances. Aggregation records the blocked instance with `verdict: blocked` and the gate triggers.
- **Multiple risk-analysts return `inconclusive`:** acceptable; the gate surfaces all of them to the human in one decision.
- **Output Packet validation failure (malformed JSON, missing required field):** reject the packet, mark the dispatch `verdict: blocked` with reason `validation_failure`, cascade. Subagents are stateless — do NOT re-dispatch automatically (timebox > retry; human decides via `--resume`).
- **Human abandons mid-dispatch:** state on disk reflects the last atomic write. `--resume` re-reads `session.yml` + completed Output Packets; re-dispatches only what is missing.
- **`schema_version` mismatch on resume:** refuse per the refusal matrix.

## Why a Skill (not a Subagent)
Phase 2 dispatches Subagents (`codebase-mapper` + 4× `risk-analyst`) and surfaces a conditional gate to the human. Skills satisfy the criterion "human in-the-loop OR dispatches Subagents" (see `shared/concepts/skill-vs-subagent.md`).

## Communication style
This Skill talks to two audiences with different conventions.

**Agent → Subagent (Work Packet only, no fluff):**
- Work Packets carry pointers (`spec_ref`, `input_refs`, `scope_files`), never inline content.
- `objective` ≤ 80 chars when possible; expand only when risk_category framing requires it.
- No prose preamble in a dispatch — only the structured packet.

**Agent → User (friendly, clear, guided):**
- Friendly, direct tone; no marketing speak.
- Markdown tables for the gate checklist; bullets for the handoff verdict summary.
- `AskUserQuestion` ONLY for the binary gate decision (Proceed/Stop) — never during dispatch (Subagents run autonomously).
- Always end with a guided next-step message — even on escalation, name the command to retry.
