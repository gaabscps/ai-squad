# DISC-001-fake — Worked Example

This folder shows what `.agent-session/<task_id>/` looks like in a consumer project after a complete Discovery squad run for a real-feeling opportunity: **"Real-time notifications for support tickets"**.

**Purpose:** demonstrate the full Discovery flow end-to-end (Frame → Investigate → Decide), and show concretely how a Discovery memo becomes the input pitch for the SDD squad when the Decision is to proceed.

**This is the ONLY copy of these artifacts in the ai-squad repo.** In a real consumer project they'd live at `<project>/.agent-session/DISC-001/` and be gitignored — `/ship DISC-001` would delete them after the human accepts the Decision.

## Files

- `session.yml` — created by `discovery-lead` at Phase 1 entry; updated by each Skill as Phases complete; ends in `current_phase: done`.
- `memo.md` — single-source-of-truth artifact. Grows across all 3 Phases (Frame fills Q1-Q9; Investigate fills `## Investigate Findings`; Decide fills `## Decide`).
- `inputs/<dispatch_id>.json` — Work Packets (`discovery-orchestrator` → Subagent). 5 total: 1 codebase-mapper + 4 risk-analyst (one per Cagan Big Risk).
- `outputs/<dispatch_id>.json` — Output Packets (Subagent → `discovery-orchestrator`). Mirror layout of inputs.

---

## Walkthrough

### Phase 1 — Frame (`discovery-lead`)

The human ran:

```
/discovery-lead "Support agents miss urgent ticket replies until they refresh manually"
```

`discovery-lead` walked them through filling in Cagan's Opportunity Assessment Q1-Q9 — interactively, one section at a time. After each section the artifact was atomic-written to `memo.md`. At the end, an explicit approval gate (`AskUserQuestion` with checklist) confirmed the Frame was ready.

**Result in `memo.md`:**
- Q1 Problem — "Support agents do not know about urgent ticket replies until they manually refresh..."
- Q2 Target Market — "50 internal support agents (B2B internal tooling)..."
- Q3 Opportunity Size — "~8 agent-hours/day reclaimed; SLA breach reduction from 12% to 5%..."
- Q4 Alternatives — manual refresh, email alerts (3-5 min delay), dashboard tab
- Q5 Why Us — "support tooling owned end-to-end by platform team..."
- Q6 Why Now — "Q1 SLA breach rate spike (30% YoY) has executive visibility..."
- Q7 Go-to-Market — `N/A` (internal tooling)
- Q8 Success Metric — "Lagging: SLA breach rate. Baseline 12%, target ≤6%..."
- Q9 Critical Success Factors — WebSocket capacity, agent permissions, dedup

The `discovery-lead` then surfaced the next step: *"Frame approved. Next: run `/discovery-orchestrator DISC-001` to start Phase 2 (Investigate)."*

### Phase 2 — Investigate (`discovery-orchestrator`)

The human ran:

```
/discovery-orchestrator DISC-001
```

`discovery-orchestrator` did all the heavy lifting in the background:

1. Dispatched **`codebase-mapper`** sequentially to build a C4 Level 1 + Level 2 view of the technical surface. Output (in `outputs/codebase-mapper-disc001xyz.json`): 3 containers identified (`support-app` · `ticket-api` · `push-service`), with relationships and the existing Kafka event channel.
2. Dispatched **4× `risk-analyst` in parallel** (one Work Packet per Cagan Big Risk):
   - `risk-analyst-value` → verdict: **validated · low** — solution materially beats current alternatives (sub-second vs 3-5 min email delay).
   - `risk-analyst-usability` → verdict: **validated · low** — existing desktop notification pattern (billing alerts) is already familiar.
   - `risk-analyst-feasibility` → verdict: **validated · medium** — push-service exists but hasn't been load-tested above 30 concurrent connections (50+ needed). Surfaced 1 assumption (`F-001`).
   - `risk-analyst-viability` → verdict: **N/A** — internal tooling, no revenue model.

`discovery-orchestrator` aggregated the 5 Output Packets into `## Investigate Findings` of `memo.md`. Because **all verdicts ∈ {validated, refuted, N/A} AND all severities ∈ {low, medium}**, the conditional gate **auto-advanced** — no human interruption. The Skill surfaced: *"Investigate complete (4/4 risks investigated, 0 inconclusive). Findings written to memo.md. Next: run `/discovery-synthesizer DISC-001` to start Phase 3 (Decide)."*

### Phase 3 — Decide (`discovery-synthesizer`)

The human ran:

```
/discovery-synthesizer DISC-001
```

`discovery-synthesizer` read the Frame + Investigate Findings, then:

1. **Generated 4 Options** (kill always row 1):
   - #1 Kill (do not pursue)
   - #2 Proceed as scoped (full real-time notifications)
   - #3 Proceed reduced scope (P1 tickets only)
   - #4 Defer + experiment (2-week prototype with 10 agents)
2. **Applied decision rules** — matched **R4** (all risks ∈ {validated, N/A}, severities ∈ {low, medium}) → recommend **Proceed**.
3. **Picked Option #2** as `[RECOMMENDED]` with **confidence: high**, citing specific evidence rows from the 4 risk-analyst Output Packets.
4. **Showed the human all options + the recommendation** (RAPID Recommender pattern) via `AskUserQuestion`.
5. **Captured the human's Decision**: Option #2 (matched the recommendation in this case — but the human had full authority to pick differently).
6. **Auto-generated `### Open Questions for Delivery`** from the `assumptions[]` collected across all 4 risk-analyst outputs:
   - `F-001` — push-service load capacity above 30 concurrent connections (validation_path: load test in staging)
   - `F-002` — ~20% of agents lack desktop notification permissions (validation_path: cross-check IT permissions report)

These are the **freshness signals** the SDD squad will need to re-validate before scoping the Spec — especially if delivery starts weeks or months later.

---

## Handoff to SDD — concrete

Discovery's output is **never auto-fed** into SDD. The human reads the memo and recomposes a clear pitch for `/spec-writer`. Here's what that looks like for this example:

The human reads `memo.md` (focusing on the **Frame** and the **Decide** block), then runs:

```
/spec-writer "Implement real-time push notifications for the support ticket queue.
Source: DISC-001 — Decision: Option #2 (Proceed as scoped).

Context (from Frame):
- 50 internal support agents miss urgent ticket replies until manual refresh
- Current alternatives (email alerts, dashboard tabs) have 3-5 minute lag
- Existing push-service already delivers desktop notifications for billing alerts
- 3 containers in scope: support-app (React), ticket-api (Go, publishes to Kafka),
  push-service (Node, WebSocket gateway)

Success metric: SLA breach rate from 12% baseline → ≤6% within 60 days of full rollout.

Open Questions for Delivery (re-validate before scoping):
- push-service has not been load-tested above 30 concurrent connections;
  capacity for 50+ agents needs verification before commitment.
- ~20% of agents lack desktop notification permissions; rollout plan must
  include permissions enablement step."
```

Notice three things:

1. **The pitch cites the Discovery session ID (`DISC-001`)** so anyone reviewing the resulting Spec can trace back to the underlying memo.
2. **The Open Questions for Delivery are surfaced explicitly in the pitch** — the human acknowledges what may have decayed or remained unvalidated, signaling to `spec-writer` (and downstream Phases) that these need attention during scoping.
3. **The pitch is not a copy-paste of the memo.** The human distilled the relevant context. Discovery memos contain everything — Frame Q1-Q9, all 4 risk analyses, all options considered. The SDD pitch picks just what's needed to specify the work.

After the SDD squad ships the feature, the human can run `/ship DISC-001` to clean up this Discovery session — the durable record (memo content) belongs in their team's external tools (Confluence, Productboard, Notion).

---

## Validation

Run `./scripts/smoke-walkthrough.sh` from the repo root to verify all files in this example parse and cross-references resolve. The smoke covers Frame structure (Q1-Q9 present), Investigate aggregation (4 Cagan risks referenced), Decide structure (Options + Kill row 1 + Recommendation + Decision + Open Questions for Delivery), and validates each Output Packet against the canonical JSON schema.
