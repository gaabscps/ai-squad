# Inspirations

ai-squad is a synthesis, not an invention. Each source listed here shaped a specific decision (cited inline in commits, concept docs, and Role file bodies).

## SDD squad

| Source | Shaped |
|--------|--------|
| [GitHub Spec Kit](https://github.com/github/spec-kit) | `/specify`, `/clarify`, `/plan`, `/tasks` shape; `[P]` parallelization marker; per-user-story decomposition |
| [AWS Kiro](https://kiro.dev) | Per-Phase approval gate; per-task forward traceability |
| [Aider](https://aider.chat) | One atomic Conventional Commit per task |
| [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents) + [multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system) | Orchestrator-workers pattern; 3-5 parallel workers as the empirical sweet spot |
| [Reflexion (Shinn et al., NeurIPS 2023)](https://arxiv.org/abs/2303.11366) | Retry caps and verbal feedback; ai-squad uses 3/2/2 (review/qa/blocker) |
| [Nygard ADR](https://github.com/joelparkerhenderson/architecture-decision-record) | 5-field memo schema for blocker decisions |
| [Google Engineering Practices](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | code-reviewer (patterns) vs logic-reviewer (behavior) split |
| [STRIDE](https://en.wikipedia.org/wiki/STRIDE_(security)) + [ATAM](https://www.sei.cmu.edu/library/architecture-tradeoff-analysis-method-collection/) | Fixed risk-category checklist in Plan |
| [INVEST](https://en.wikipedia.org/wiki/INVEST_(mnemonic)) + [SPIDR](https://www.mountaingoatsoftware.com/blog/five-simple-but-powerful-ways-to-split-user-stories) | Task-sizing heuristics |
| [Buck2](https://buck2.build/) | Single-coordinator pattern for state |

## Discovery squad

| Source | Shaped |
|--------|--------|
| [Marty Cagan — *Inspired* (Ch. 35)](https://svpg.com/books/) + [SVPG Opportunity Assessment](https://www.svpg.com/assessing-product-opportunities/) | The 10 questions that drive the Frame (Q1-Q9 in Phase 1, Q10 = Recommendation in Phase 3) |
| [SVPG — The Four Big Risks](https://www.svpg.com/four-big-risks/) + [Product Risk Taxonomy](https://www.svpg.com/product-risk-taxonomies/) | Phase 2 fan-out: 4 risk-analyst instances (value/usability/feasibility/viability); N/A handling |
| [SVPG — Discovery Sprints](https://www.svpg.com/discovery-sprints/) + [Time-Boxing Product Discovery](https://www.svpg.com/time-boxing-product-discovery/) | Timebox > retry — no retry loops in Phase 2; `inconclusive` as first-class output |
| [Teresa Torres — Continuous Discovery Habits](https://www.producttalk.org/) + [Assumption Testing](https://www.producttalk.org/assumption-testing/) | Discovery evidence taxonomy (user_signal, competitor_observation, ...); per-assumption `validated_at`; Open Questions for Delivery as freshness signal |
| [Producttalk — Discovery Hand-Offs Kill Momentum](https://producttalk.org/2021/11/discovery-handoffs) | Time-decoupled handoff is an anti-pattern in literature; ai-squad mitigates with manual handoff (no auto-feed) + Open Questions for Delivery |
| [Bain — RAPID Decision Making](https://www.bain.com/insights/rapid-decision-making/) | Phase 3 approval gate: synthesizer = Recommender; human = Decider; show all options + recommend with confidence |
| [Amazon — Working Backwards / PR-FAQ](https://workingbackwards.com/concepts/working-backwards-pr-faq-process/) | "Kill" as a normal outcome (always row 1 in Options table); alternatives must be visible even when one is recommended |
| [Neville-Neil — Code Spelunking (ACM Queue 2003)](https://queue.acm.org/detail.cfm?id=945136) + [C4 model (Brown)](https://c4model.com/) | codebase-mapper persona: forensic, read-only, stops at C4 Level 2 (System Context + Containers) |
| [Asana — Risk Register Guide](https://asana.com/resources/risk-register) | 3-level severity scale (low/medium/high) — canonical in Product/PM (vs 5×5 IT/Security matrices) |
