# Concept — `Effort`

> Status: canonical. Vocabulary fixed in [`docs/glossary.md`](../glossary.md). Companion to [`role.md`](role.md) and [`skill-vs-subagent.md`](skill-vs-subagent.md).

## Definition

**Effort** is a Claude Code platform property that controls a model's *reasoning budget* — how much internal "thinking" it spends before producing output. The platform exposes 5 levels.

> *Terms used in this doc:*
> - **reasoning budget** (or *thinking budget*): how many internal chain-of-thought tokens the model is allowed to spend before responding. More budget = more time, more cost, generally more quality — up to a point.
> - **adaptive reasoning:** the model decides for itself how much to think on each step, within the ceiling that `effort` permits. `effort` does not force N tokens of thinking; it sets the cap.
> - **diminishing returns:** the point past which additional investment (more effort) yields little to no marginal gain.

## The 5 levels

| Effort | Behavior | When to use | Models supporting |
|--------|----------|-------------|-------------------|
| `low` | Fast, minimal internal reasoning | Latency-sensitive, trivial tasks | All |
| `medium` | Balances cost and quality | Reasonable default for structured tasks (pattern review, procedural execution) | All |
| `high` | More internal reasoning; minimum bar for intelligence-sensitive tasks | Tasks needing solid reasoning (implementation, gap analysis) | All |
| `xhigh` | Deep reasoning; recommended default for Opus 4.7 in agentic tasks | High-stakes decisions, arbitration | **Opus 4.7 only** |
| `max` | No ceiling on reasoning; can show diminishing returns | Extreme cases, architectural debugging | All |

Platform defaults: `xhigh` on Opus 4.7; `high` on Opus 4.6 and Sonnet 4.6.

## How effort interacts with model selection

`model` and `effort` are **two independent levers**:

- `model` controls *which* model runs (sonnet, opus, haiku) — capability ceiling.
- `effort` controls *how hard the chosen model thinks* — reasoning budget.

You can mix: `sonnet + high`, `opus + medium`, `opus + xhigh`. Each combination has different cost/quality tradeoffs. The squad uses calibrated combinations per Role (see mapping below) rather than maxing both.

## ai-squad calibration — model and effort per Role

This is the framework's opinionated default. Justifications below.

| Role | Materialization | Phase | Model | Effort | Why |
|------|-----------------|-------|-------|--------|-----|
| `spec-writer` | Skill | 1 | (inherits) | (inherits) | Skills inherit from the human's main session. Recommendation: run `/model opus` before `/spec-writer` — Phase 1 is design conversation where Opus's reasoning helps the human refine the Spec. |
| `designer` | Skill | 2 | (inherits) | (inherits) | Inherits. Recommendation: `/model opus` — Plan decisions (architecture, risks, dependencies) are reasoning-heavy. |
| `task-builder` | Skill | 3 | (inherits) | (inherits) | Inherits. Recommendation: `/model sonnet` — task decomposition is more procedural than the Plan. |
| `orchestrator` | Skill | 4 | (inherits) | (inherits) | Inherits. Sonnet is sufficient for sequential dispatch. Use Opus when the orchestrator needs to decompose for multi-instance fan-out — that decision is reasoning-heavy. |
| `dev` | Subagent | 4 | sonnet | high | Surgical implementation needs solid reasoning; `medium` breaks on non-trivial features. Sonnet keeps cost manageable under `fan_out`. Override to opus per Work Packet for architecturally complex features. |
| `code-reviewer` | Subagent | 4 | sonnet | medium | Pattern matching against conventions is procedural, not reasoning-heavy. |
| `logic-reviewer` | Subagent | 4 | **opus** | high | Detecting edge cases, behavioral gaps, race conditions, broken invariants requires strong reasoning — this is the Subagent where model upgrade pays the most. Effort stays at `high` (not `xhigh`) to preserve quota; `opus + high` is already a significant upgrade. |
| `qa` | Subagent | 4 | sonnet | medium | Executing scenarios and verifying pass/fail is procedural. |
| `blocker-specialist` | Subagent | 4 (escalation) | opus | xhigh | High-stakes arbitration; last line before the human. Both levers maxed because dispatch frequency is low (escalation only). |

## Why not Opus everywhere

Opus consumes platform quota roughly 5× faster than Sonnet. The squad's heaviest amplifier is `fan_out`: a Role marked `fan_out: true` can be instantiated N times in parallel. Pushing `dev` (the most fan-out-heavy Role) to Opus would burn a typical user's quota in a single feature.

The framework's calibration places Opus only where:

1. The Role's value comes from reasoning quality, not throughput (`logic-reviewer`, `blocker-specialist`), AND
2. The Role's dispatch frequency or fan-out factor does not amplify cost into a quota emergency.

Worst-case rough estimate for one feature with `fan_out` of 2 on dev and reviewers + 1 qa, single review cycle:

- All Sonnet baseline: ~9 Sonnet dispatches
- ai-squad calibration (logic-reviewer Opus, rest Sonnet): ~7 Sonnet + 2 Opus ≈ 17 Sonnet-equivalent units
- All Opus: ~9 Opus ≈ 45 Sonnet-equivalent units

The middle option fits comfortably inside a Max 5x plan. The third does not.

## Skill vs Subagent — how each handles effort

Recap from [`skill-vs-subagent.md`](skill-vs-subagent.md):

- **Skills inherit** `model` and `effort` from the human's main session. Setting them in a Skill's frontmatter is a no-op and confuses readers — do not declare them.
- **Subagents fix** `model` and `effort` in their frontmatter. The dispatching parent (orchestrator) cannot override at dispatch time *unless* the override mechanism below is used.

## Override path — Work Packet `effort` field

The Work Packet (concept #7, `../templates/work-packet.json`) carries an optional `effort` field. When present, it overrides the Subagent's frontmatter default **for that single dispatch**. The next dispatch reverts to the default.

Use cases:

- A critical-path feature that justifies upgrading `dev` from `high` to `xhigh`.
- A second loop after a reviewer flagged subtle gaps — bump effort once, see if it resolves before escalating to `blocker-specialist`.

The same mechanism applies to `model` overrides (passing `model: opus` in a Work Packet to upgrade a normally-Sonnet Role for one dispatch). Mechanics in [`work-packet.md`](work-packet.md).

## Anti-patterns

1. **`max` by default.** `max` has documented diminishing returns. Use only when `xhigh` failed observably on a specific task — not "for safety".

2. **Lowering `blocker-specialist` to save cost.** This Role exists for cases where deep reasoning pays. If escalations are too expensive, escalate less (revisit Pipeline) — do not weaken the escalation handler.

3. **Setting `effort` (or `model`) in Skill frontmatter.** No-op. Skills inherit from the human's session. Recommend the model in the README, do not hardcode it in the Skill.

4. **Maxing both levers simultaneously without need.** `opus + xhigh` is reserved for the one Role that genuinely needs it (`blocker-specialist`). Combining both as a "default" elsewhere burns quota with marginal gain.

## Cost note

Effort is the single biggest knob in the framework's runtime cost. The opinionated calibration above is the framework's bet on a defensible cost/quality tradeoff for the typical Max 5x user. Projects with different constraints (enterprise contracts, latency-sensitive contexts) can override per-Role via Work Packet without forking the framework.
