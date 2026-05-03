---
id: "DISC-001"
title: "Real-time notifications for support tickets"
status: "approved"
squad: "discovery"
phase_completed: "decide"
created_at: "2026-04-15T10:00:00Z"
last_updated_at: "2026-04-15T15:30:00Z"
parent_session: "./session.yml"
---

# Discovery Memo — DISC-001

> **Framework:** Marty Cagan's Opportunity Assessment (10 questions, *Inspired* 2nd ed., Ch. 35).
> Phase 1 (Frame): Q1-Q9 by `discovery-lead`. Phase 2 (Investigate): `discovery-orchestrator` + 1 mapper + 4 risk-analyst. Phase 3 (Decide): `discovery-synthesizer`.

---

## 1. Problem
Support agents do not know about urgent ticket replies until they manually refresh the queue. Average detection delay is 4-7 minutes, contributing to a 30% rise in SLA breaches last quarter.

## 2. Target Market
Internal support agents (B2B internal tooling). 50 agents on the customer-success team, working tier-1 and tier-2 escalations.

## 3. Opportunity Size
50 agents × ~10 min/day saved on manual refresh checks = ~8 agent-hours/day reclaimed. Bigger benefit: reducing SLA breach rate from current 12% toward target 5%.

## 4. Alternatives
- Manual refresh of the ticket queue page (current behavior)
- Email alerts via existing notification service (3-5 minute delay; agents report they ignore them)
- Dedicated dashboard tab kept open (not all agents do this; no audio cue)

## 5. Why Us
The support tooling stack is owned end-to-end by our platform team — no third-party dependency. Existing `push-service` already delivers desktop notifications for billing alerts.

## 6. Why Now
Q1 SLA breach rate spike (30% increase YoY) has executive visibility. Customer Success VP requested options before next quarterly review (60 days out).

## 7. Go-to-Market
N/A — internal tooling, no go-to-market required. Rollout = staged enablement to 50 agents over 2 weeks.

## 8. Success Metric
Lagging metric: SLA breach rate. Baseline: 12% (Q1 2026). Target: ≤6% within 60 days of full rollout. Measured via existing SLA dashboard.

## 9. Critical Success Factors
- WebSocket capacity must absorb 50 concurrent agent connections (currently sized for 20)
- Agents must have desktop notification permissions enabled (~80% currently do per IT survey)
- Notification deduplication required (no alerting on agent's own actions)

## Open Questions
- None blocking approval.

---

## Investigate Findings

### Codebase Map
3 containers identified (C4 Level 2): `support-app` (React frontend), `ticket-api` (Go REST service), `push-service` (Node WebSocket gateway). `support-app` already consumes `push-service` for billing alerts. `ticket-api` exposes events on a Kafka topic that `push-service` could subscribe to. No new container needed.

### Risk Analysis (Cagan's Four Big Risks)
- **Value** — verdict: validated · severity: low
  Rationale: User pain is well-documented (Q1, Q4 alternatives are inadequate). Solution materially beats current alternatives — push notifications are sub-second vs 3-5 min email delay.
  Evidence: 12 user_signal items from agent interviews; 1 metric_benchmark (SLA breach rate trend).

- **Usability** — verdict: validated · severity: low
  Rationale: Existing desktop notification pattern is already in use for billing alerts; agents are familiar. Visual + audio cues prevent missed events.
  Evidence: 3 expert_judgment items from UX team review; 1 user_signal (agent quote: "billing alerts work fine").

- **Feasibility** — verdict: validated · severity: medium
  Rationale: All 3 containers exist; integration is additive. Only meaningful work: scale `push-service` capacity from 20 to 50+ concurrent connections (estimated 1-2 weeks of platform work).
  Evidence: 4 code_evidence pointers (push-service capacity config, Kafka topic schema, WebSocket connection pooling); 1 absence (no current load testing for >30 concurrent connections).

- **Viability** — verdict: N/A · severity: (omitted)
  Rationale: Internal tooling with no revenue model. Viability not applicable to this opportunity per Cagan's product-vs-internal distinction.

---

## Decide

### Options
| # | Option | Description | Pros | Cons | Effort | Risk-coverage |
|---|--------|-------------|------|------|--------|---------------|
| 1 | Kill | Do not pursue | Zero cost | SLA breach trend continues | 0 | N/A |
| 2 | Proceed as scoped | Build full real-time notifications, scale push-service | Solves problem fully; aligned with existing patterns | Requires push-service scaling work | M | Covers all 4 Cagan risks |
| 3 | Proceed reduced scope | Notify only urgent (P1) tickets first | Lower push-service load; faster MVP | Partial value; agents still miss P2/P3 quickly | S | Covers value + feasibility; defers usability validation at full scale |
| 4 | Defer + experiment | Run a 2-week prototype with 10 agents before committing | Validates feasibility risk further | Delays delivery; SLA continues degrading meanwhile | S | Buys data on feasibility risk |

### Recommendation
- **Recommended option:** #2 (Proceed as scoped)
- **Rule matched:** R4 (all risks ∈ {validated, N/A}, severities ∈ {low, medium})
- **Confidence:** high
- **Cited evidence:** outputs/risk-analyst-value-disc001abc.json#verdict, outputs/risk-analyst-usability-disc001def.json#verdict, outputs/risk-analyst-feasibility-disc001ghi.json#risk_severity, outputs/risk-analyst-viability-disc001jkl.json#verdict
- **Override rationale:** N/A (no override applied)

### Decision
- **Decision:** Option #2 — Proceed as scoped · 2026-04-15T15:30:00Z
- **Decided by:** Customer Success VP
- **Notes:** Scaling work tracked separately; full real-time notifications scoped for delivery.

### Open Questions for Delivery
- F-001 · push-service has not been load-tested above 30 concurrent connections; verify capacity before SDD scoping · validated_at: 2026-04-15T13:45:00Z · validation_path: load test in staging with 50 simulated agent connections
- F-002 · ~20% of agents lack desktop notification permissions per IT survey; rollout plan must include permissions enablement step · validated_at: 2026-04-15T13:45:00Z · validation_path: cross-check current IT permissions report before launch
