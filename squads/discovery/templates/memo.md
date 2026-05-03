---
id: "DISC-XXX"                     # squad-prefixed sequential, scoped to consumer project
title: ""                           # opportunity title (human-readable); populated by discovery-lead at first draft
status: "draft"                     # draft | approved
squad: "discovery"
phase_completed: "none"             # none | frame | investigate | decide
created_at: ""                      # ISO timestamp
last_updated_at: ""                 # ISO timestamp; atomic write on every change
parent_session: "./session.yml"
---

# Discovery Memo — DISC-XXX

> **Framework:** Marty Cagan's Opportunity Assessment (10 questions, *Inspired* 2nd ed., Ch. 35).
> **Authorship distribution across the squad's 3 Phases:**
> - **Phase 1 (Frame)** — `discovery-lead` populates Q1–Q9.
> - **Phase 2 (Investigate)** — `discovery-orchestrator` populates `## Investigate Findings` from Cagan's Four Big Risks (`codebase-mapper` + 4× `risk-analyst` fan-out).
> - **Phase 3 (Decide)** — `discovery-synthesizer` populates Q10 (`### Recommendation`), `### Options` (kill always present), and surfaces the human-marked `### Decision`.
>
> Sections may carry `[NEEDS CLARIFICATION] <question>` markers from Phase 1 (cap: 5; overflow goes to `## Open Questions`).

---

## 1. Problem
<!-- Cagan Q1: Exactly what problem will this solve? (value proposition)
     Concrete user pain, not a feature description. One paragraph. -->

## 2. Target Market
<!-- Cagan Q2: For whom do we solve that problem? (target market)
     Specific segment / persona. Avoid "all our users". -->

## 3. Opportunity Size
<!-- Cagan Q3: How big is the opportunity? (market size)
     Estimate addressable demand. May be qualitative if no numbers exist yet. -->

## 4. Alternatives
<!-- Cagan Q4: What alternatives are out there? (competitive landscape)
     What do affected users do today instead? Internal workarounds count. -->

## 5. Why Us
<!-- Cagan Q5: Why are we best suited to pursue this? (our differentiator)
     Capability, position, prior context — what makes us the right team. -->

## 6. Why Now
<!-- Cagan Q6: Why now? (market window)
     What changed that makes this the right moment vs 6 months ago or later. -->

## 7. Go-to-Market
<!-- Cagan Q7: How will we get this product to market? (go-to-market strategy)
     Distribution / rollout / adoption path. Mark N/A if not applicable
     (e.g. internal tooling) — do not delete the section. -->

## 8. Success Metric
<!-- Cagan Q8: How will we measure success / make money from this product? (metrics / revenue strategy)
     One primary metric + how it will be measured. Include target threshold if known. -->

## 9. Critical Success Factors
<!-- Cagan Q9: What factors are critical to success? (solution requirements)
     Constraints and prerequisites that, if violated, kill the opportunity.
     Initial Risks (technical, regulatory, deadline) belong here. -->

## Open Questions
<!-- Overflow from the Frame clarification cap (>5 NEEDS CLARIFICATION items)
     OR questions surfaced during refinement that do not block approval.
     Format: one bullet per question. Empty section = "no open questions". -->

---

## Investigate Findings
> *Populated in Phase 2 by `/discovery-orchestrator`.*
> Synthesizes outputs from `codebase-mapper` (sequential context bootstrap) and 4× `risk-analyst` instances (parallel fan-out, one per Cagan Big Risk).

<!-- Structure populated by discovery-orchestrator (atomic write after step 5):

### Codebase Map
(from codebase-mapper Output Packet — C4 Level 1 + Level 2: System Context + Containers + Relationships)

### Risk Analysis (Cagan's Four Big Risks)
- **Value** — verdict: <validated|refuted|inconclusive|N/A> · severity: <low|medium|high>
  Rationale: <one paragraph>
  Evidence: <bullets, each with kind from Discovery taxonomy>
- **Usability** — <same shape>
- **Feasibility** — <same shape>
- **Viability** — <same shape>
-->

---

## Decide
> *Populated in Phase 3 by `/discovery-synthesizer`.*
> Resolves Q10 of Cagan's Opportunity Assessment: "Given the above, what's the recommendation?"

### Options
<!-- Table format. KILL is always present as the first row — non-negotiable
     (Working Backwards canonizes "do not build" as a normal outcome).

| Option | Description | Pros | Cons | Effort | Risk after Investigate |
|--------|-------------|------|------|--------|-----------------------|
| Kill   | Do not pursue this opportunity | ... | ... | 0 | None |
| ...    | ...         | ...  | ...  | ...    | ...                   |
-->

### Recommendation
<!-- Cagan Q10. discovery-synthesizer's recommended option from the table above + rationale.
     Cite which Investigate findings drove the recommendation. -->

### Decision
<!-- Marked by the human at the Phase 3 approval gate.
     Format: chosen option + date. -->

### Open Questions for Delivery
<!-- Handoff hints for whoever runs /spec-writer later (potentially months later).
     Surface assumptions that may have decayed and need re-validation before delivery starts.
     Format: one bullet per question. Empty section = "ready to hand off as-is". -->
