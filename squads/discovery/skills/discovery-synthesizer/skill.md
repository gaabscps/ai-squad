---
name: discovery-synthesizer
description: Phase 3 (Decide) entry point for the Discovery squad. Generates a 3-5 row Options table (always with Kill), applies Cagan Four-Risks decision rules to recommend one option with confidence, captures the human Decision via an approval gate, and writes Decision + Open Questions for Delivery into `memo.md`. Use when running `/discovery-synthesizer DISC-NNN` on a Session whose Investigate (Phase 2) is approved, or `--resume` on a paused/escalated one.
---

# Discovery Synthesizer — Phase 3 (Decide)

Turns Frame + Investigate Findings into a structured Decision and a freshness-checkable handoff to Delivery. Workflow: generate Options → apply decision rules → mark the Recommended option + confidence → human Decides via the approval gate → finalize the memo with Open Questions for Delivery.

The human is the Decider (RAPID model); this Skill conducts the conversation, presents options, and captures the Decision — see [`shared/concepts/skill-vs-subagent.md`](../../../shared/concepts/skill-vs-subagent.md).

## Industry foundations
- **Options table over weighted scoring:** Cagan/Torres treat Discovery options as categorical (kill/pivot/proceed/defer), not rankable. RICE/ICE are reserved for feature prioritization on existing products — not Discovery decisions. Sources: SVPG *Assessing Product Opportunities*, Torres *Opportunity Solution Trees*.
- **Decision rules + override + rationale:** the literature gives no canonical decision rule for Discovery; this Skill defines one (Cagan Four Risks-derived) and keeps every recommendation auditable via cited evidence + optional override rationale.
- **Show-all + Recommend (RAPID Recommender):** Bain RAPID — the Recommender generates options and marks one with rationale; the Decider keeps full authority. Amazon Working Backwards PR/FAQ requires alternatives visible even when the PR commits to one direction.
- **Per-assumption freshness signal:** Torres *Continuous Discovery Habits* tracks each assumption individually with `validated_at`; treating "Discovery as a phase rather than a continuous discipline" causes assumption decay (Producttalk: *Discovery Hand-Offs Kill Momentum*). A time-decoupled handoff (Discovery → Delivery months later) requires machine-checkable freshness, not LLM judgment.

## When to invoke
- `/discovery-synthesizer DISC-NNN` — start Phase 3 for a Discovery Session whose Investigate is approved (or auto-advanced).
- `/discovery-synthesizer DISC-NNN --resume` — resume after a gate `Stop` or escalation.

## Refuse when
- No Session at `.agent-session/<spec_id>/` → message: `"No Session at .agent-session/<spec_id>/. Run /discovery-lead to start Phase 1 first."`
- `session.yml.squad ≠ discovery` → message: `"Session <spec_id> belongs to squad '<squad>', not discovery."`
- `session.yml.current_phase ≠ decide` → message: `"Session <spec_id> is in phase '<current_phase>'. Phase 3 entry requires current_phase: decide."`
- `memo.md` missing OR `memo.md.phase_completed ≠ investigate` → message: `"Investigate is not approved. Run /discovery-orchestrator DISC-NNN to complete Phase 2 first."`
- Existing Session is in terminal state (`paused | done | escalated`) and `--resume` not passed → message: `"Session <spec_id> is <state>. Pass --resume to continue, or /ship DISC-NNN to clean up."`
- `session.yml.schema_version` newer than this Skill knows → standard schema-mismatch refusal.

## Inputs (preconditions)
- `.agent-session/<spec_id>/session.yml` with `squad: discovery`, `current_phase: decide`, `planned_phases` includes `decide`.
- `.agent-session/<spec_id>/memo.md` with `phase_completed: investigate`, Q1–Q9 + `## Investigate Findings` populated.
- The 5 Output Packets from Phase 2 still on disk at `.agent-session/<spec_id>/outputs/` (audit trail for evidence citation).

## Steps

### 1. Validate Session and inputs
Verify every precondition in "Refuse when". On any failure, refuse and exit cleanly.

### 2. Read everything
- `memo.md`: Frame Q1-Q9 + Investigate Findings (codebase map + 4 risk analyses).
- `outputs/risk-analyst-<value|usability|feasibility|viability>-<dispatch_id>.json`: full structured outputs (verdict, severity, rationale, evidence[], assumptions[]).
- `outputs/codebase-mapper-<dispatch_id>.json`: containers[] for any feasibility-relevant option.

### 3. Generate the Options table (Kill + 2-4 alternatives)
Render a Markdown table with columns: `# | Option | Description | Pros | Cons | Effort | Risk-coverage`.

- **Row 1 is ALWAYS `Kill`** — non-negotiable (Working Backwards canonizes "do not build" as a normal outcome).
- Rows 2-5: alternatives derived from Frame + risk findings, by pattern:
  - **Pivot** — same Problem (Q1), different Solution (addresses a refuted risk).
  - **Proceed as scoped** — Frame as-is.
  - **Proceed with reduced scope** — drop the highest-severity risk's surface area.
  - **Defer + experiment** — ship a small assumption-testing artifact instead (Torres).
- `Risk-coverage` column: name which Cagan risks (value/usability/feasibility/viability) each option mitigates or leaves open.
- Cap at 5 rows total (Kill + 4 alternatives). More than 5 causes decision fatigue (present ≤5 options to a decision-maker).

### 4. Apply decision rules (first-pass recommendation)
Apply in order; first match wins:

| Rule | Trigger | Recommendation | Confidence |
|------|---------|----------------|------------|
| **R1** | ANY risk verdict=`refuted` AND `risk_severity=high` | **Kill** (cite which risk_category) | high |
| **R2** | ANY risk verdict=`inconclusive` AND `risk_severity=high` | **Defer-with-experiment** (cite assumptions[] from inconclusive risks) | high |
| **R3** | ≥2 risks verdict=`refuted` (any severity) | **Kill OR Pivot** (synthesizer chooses + cites) | medium |
| **R4** | ALL risks verdict ∈ {`validated`, `N/A`} AND ALL severities ∈ {`low`, `medium`} | **Proceed** | high |
| **R5** | catch-all (mixed validated/inconclusive low-medium) | **Proceed-with-monitoring** (surface assumptions to monitor) | medium |

**Override:** you MAY override a rule's recommendation (e.g. R1 fires but the refuted risk is acceptable in context). An override REQUIRES `override_rationale` (1-2 sentences citing specific evidence); confidence drops to `medium`.

**Cite specific evidence:** for every rule fired, reference the exact risk-analyst Output Packet row that triggered it (e.g. `"R1 triggered by outputs/risk-analyst-feasibility-<id>.json#risk_severity"`). NEVER cite hand-wavily.

### 5. Write the Recommendation block into memo (draft state)
Atomically write `memo.md` `### Recommendation` with:
- Recommended option: `#N` (from the Options table)
- Rule matched: `R1 | R2 | R3 | R4 | R5`
- Confidence: `high | medium | low`
- Cited evidence: pointer list
- Override rationale (if applicable)

Do NOT mark `phase_completed: decide` yet — that happens only after the human Decision (step 7).

### 6. Approval gate (Show-all + Recommend, RAPID-style) — HUMAN DECIDES
Print the Options table + Recommendation block as Markdown to chat (visible to the human). Then call `AskUserQuestion` with one enumerable choice per Options-table row. Mark the recommended option `[RECOMMENDED · confidence: high|medium|low]`:

```
Discovery Decision — DISC-NNN

[Render Options table here]

Synthesizer recommendation: Option #<N> "<label>" [RECOMMENDED · confidence: <C>]
Rule: R<X> · Cited: <evidence pointers>

Choose your Decision:
[ ] Option #1 — Kill
[ ] Option #2 — <label>  [RECOMMENDED · confidence: <C>]
[ ] Option #3 — <label>
[ ] Option #4 — <label>
[ ] Option #5 — <label>
```

The human's choice MAY differ from `[RECOMMENDED]` — that is the Decider's authority (RAPID). NEVER write the Decision (step 7) before the human selects.

### 7. Write Decision + Open Questions for Delivery into memo
On any selection (including Kill):
1. Update `### Decision` with the chosen option + ISO timestamp.
2. Auto-generate `### Open Questions for Delivery`:
   - Aggregate `assumptions[]` from all 4 risk-analyst outputs.
   - Keep those whose `validation_path` marks them required-before-delivery (heuristic: any assumption from an `inconclusive` verdict, plus high-severity validated/refuted with `validation_path` set).
   - Render each as a bullet: `<id> · <summary> · validated_at: <ISO> · validation_path: <path>`.
   - Empty section = "ready to hand off as-is" (rare — only when all assumptions are low-stakes).
3. Set `memo.md` `status: approved` and `phase_completed: decide`.
4. Atomically write.

### 8. Update Session
- `session.yml.current_phase`: `done` (Discovery has 3 phases; Decide is terminal for the squad).
- `session.yml.completed_at`: ISO timestamp.
- `session.yml.phase_history.decide`: populate `decision_option`, `confidence`, `rule_matched`.

### 9. Final handoff message
Emit the handoff for the Decision outcome (see Handoff below), and print it to chat.

## Output
- `memo.md` finalized: `## Decide` block fully populated (Options · Recommendation · Decision · Open Questions for Delivery); `phase_completed: decide`; `status: approved`.
- `session.yml`: `current_phase: done`, `completed_at` set, `phase_history.decide` populated.
- No new files created — single-source-of-truth principle (memo is the artifact).

## Handoff (dynamic, based on Decision)
- **Decision = Kill:** `"Decision: Kill. Memo finalized at .agent-session/DISC-NNN/memo.md. To clean up the Session: /ship DISC-NNN. Discovery memo will be lost — copy externally (Confluence, Productboard, Notion) if you want durable record."`
- **Decision = Proceed (R4 or R5):** `"Decision: Proceed (Option #<N>). Memo finalized. To start delivery: open .agent-session/DISC-NNN/memo.md, copy the relevant context (Frame Q1-Q9, Decision, Open Questions for Delivery), then run /spec-writer with that as your pitch. Note: this is a deliberate handoff (not auto-feed) — re-validate Open Questions before scoping."`
- **Decision = Pivot (R3 + override):** `"Decision: Pivot to Option #<N>. The original Problem (Q1) holds but Solution shifts. Recommend re-running Discovery with the pivoted Frame: /discovery-lead (new DISC-NNN) using the pivot description as pitch."`
- **Decision = Defer-with-experiment (R2):** `"Decision: Defer. Open Questions for Delivery lists what needs validation before re-deciding. To re-enter: /discovery-orchestrator DISC-NNN --resume after gathering data, OR /discovery-lead (new DISC-NNN) if scope shifted."`

## Failure modes
- **Human abandons mid-gate:** state on disk reflects last atomic write (Recommendation drafted but Decision not set). `--resume` re-prints the gate.
- **Override rationale missing on an override:** refuse to draft the Recommendation; supply `override_rationale` first (self-check before step 5).
- **All options identical (degenerate Options table):** options were not differentiated; emit `status: blocked, blocker_kind: degenerate_options` — escalate to the human, do NOT proceed to the gate.
- **AskUserQuestion timeout:** Session paused; no state change. `--resume` re-prompts.

## Communication style
This Skill talks to the **human** as Decider — friendly, structured, RAPID-style:
- Friendly, direct tone — no marketing speak.
- Markdown table for Options (cap at 5 rows to mitigate decision fatigue).
- `AskUserQuestion` for the Decision (one option per row, recommended marked).
- Always cite a specific evidence row in the Recommendation — never hand-wave.
- Always end with a guided next-step message — even on Kill (point to `/ship`); on Proceed, name the SDD entry command and remind about freshness re-validation.
