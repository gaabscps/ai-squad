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

## ai-squad calibration — model and effort

The framework calibrates **model** and **effort** along two axes:

- **Skills (Phases 1–4 entry points)** — inherit from the human's main session. Recommendations below.
- **Subagents (Phase 4 workers)** — frontmatter declares a *default*; per-dispatch *overrides* travel in the Work Packet (`model`/`effort` fields) and are set by the orchestrator from the canonical **Tier × Loop table** below.

### Skills — recommended main-session model

| Skill | Recommended model | Why |
|-------|-------------------|-----|
| `spec-writer` | opus + high | Phase 1 is design conversation — Opus's reasoning helps the human refine the Spec. |
| `designer` | opus + high | Plan decisions (architecture, risks, dependencies) are reasoning-heavy. |
| `task-builder` | sonnet + high | Task decomposition is more procedural than the Plan. |
| `orchestrator` | sonnet + high | Sequential dispatch + state merge. Bump to Opus for multi-instance fan-out planning. |
| `pm` (autonomous) | **opus + high** | Senior critical evaluation across all phases — Sonnet here accepts workarounds the PM mandate forbids. Effort `high` (not `xhigh`) because PM time is mostly reading packets and routing, not creative reasoning per token. |

### Subagent default frontmatter (fallback when Work Packet does not override)

| Subagent | Default model | Default effort | Notes |
|----------|---------------|----------------|-------|
| `dev` | sonnet | high | Mid-tier fallback. Real dispatches receive Work Packet override per the Tier × Loop table. |
| `code-reviewer` | sonnet | medium | Pattern-matching against conventions is procedural. |
| `logic-reviewer` | opus | high | Detecting invariants / edge cases / race conditions pays the most from model upgrade. |
| `qa` | sonnet | medium | Executing scenarios is procedural at mid-tier. |
| `blocker-specialist` | opus | xhigh | High-stakes arbitration; dispatch frequency is low. |
| `audit-agent` | haiku | medium | Mechanical manifest reconciliation. Singleton per run. |

### Canonical Tier × Loop table (orchestrator-enforced Work Packet overrides)

The orchestrator reads each task's `Tier:` field from `tasks.md` and overrides Work Packet `model`/`effort` per this table on every Subagent dispatch. Tier definitions and reclassification rules below.

| Step / Role            | Description                                | T1 — Procedural | T2 — Pattern    | T3 — Judgement  | T4 — Core complex |
|------------------------|--------------------------------------------|-----------------|-----------------|-----------------|-------------------|
| **dev L1**             | First implementation                       | haiku, high     | sonnet, medium  | sonnet, high    | sonnet, high      |
| **dev L2**             | Retry with `previous_findings` from reviewer | sonnet, medium ¹ | sonnet, high ¹  | sonnet, high    | sonnet, high      |
| **dev L3**             | Final retry (`review_loops_max = 3`)       | sonnet, high ¹  | sonnet, high    | sonnet, high    | **opus, high** ²  |
| **dev qa-L1**          | Retry after qa fail (skips reviewers)      | sonnet, medium  | sonnet, high    | sonnet, high    | sonnet, high      |
| **dev qa-L2**          | Final retry after qa fail                  | sonnet, high    | sonnet, high    | sonnet, high    | **opus, high** ²  |
| **code-reviewer**      | Any loop (L1/L2/L3)                        | haiku, high     | haiku, high     | sonnet, medium  | sonnet, medium    |
| **logic-reviewer**     | Any loop (L1/L2/L3)                        | sonnet, medium  | sonnet, medium  | sonnet, high    | opus, high        |
| **qa**                 | Any attempt                                | haiku, high     | haiku, high     | sonnet, medium  | **sonnet, high**  |
| **blocker-specialist** | Any trigger (cap, stall, conflict)         | opus, xhigh ³   | opus, xhigh ³   | opus, xhigh ³   | opus, xhigh ³     |
| **audit-agent**        | Singleton pre-handoff                      | haiku, medium ⁴ | haiku, medium ⁴ | haiku, medium ⁴ | haiku, medium ⁴   |

**Notes**

- ¹ Subir tier do `dev` quando há `previous_findings` carregado — contexto mais rico exige modelo mais forte para não repetir o erro do loop anterior.
- ² Última chance em core complex: opus **high** (não medium). Economizar effort aqui é exatamente onde débito técnico entra.
- ³ Blocker é raro e alta aposta — opus xhigh sempre. Custo agregado fica baixo porque dispatch frequency é low.
- ⁴ Audit é reconciliação mecânica de manifesto vs outputs — haiku medium é o ponto certo. Subir desperdiça quota.

### Tier definitions (operational)

| Tier | Definition | Example |
|------|-----------|---------|
| **T1 — Procedural** | Single path, no design decision, no non-obvious invariant | Rename, add field, copy existing pattern |
| **T2 — Pattern** | Established repo pattern, 1–2 local decisions | Endpoint mirroring existing endpoints |
| **T3 — Judgement** | Multiple design decisions, cross-file impact | New auth flow, module refactor |
| **T4 — Core complex** | Domain invariant, concurrency, security, data migration, public contract. Error = incident | Schema migration, lock manager, RBAC core |

**Tie-break:** when in doubt between two tiers, escalate to the higher one.

**Dynamic reclassification:** if L1 reviewer findings reveal complexity exceeding the initial tier, the orchestrator (or PM, in autonomous mode) MUST raise the task's `Tier:` field in `tasks.md` *before* dispatching L2 — so L2+ runs at the corrected tier. Recording the bump as a `Tier-bump note:` line on the task in `tasks.md` is recommended for audit traceability.

## Model precedence (FEAT-008)

A precedência canônica que determina o modelo efetivo no runtime, de mais alta pra mais baixa:

1. **Task tool `model` parameter** — único campo que controla o run-model do subagent. O orchestrator DEVE passá-lo em todo dispatch de role tiered (`dev`, `code-reviewer`, `logic-reviewer`, `qa`).
2. **Agent file frontmatter `model:`** — fallback documental; só é honrado quando (1) é omitido. Pode ser silenciosamente ignorado por mudanças no runtime do Claude Code.
3. **Parent session's model** — default implícito quando (1) e (2) ausentes. Inerentemente errado pra dispatches tiered (tipicamente opus no orchestrator, mas o subagent pode precisar de haiku/sonnet).

**Enforcement:** `verify-tier-calibration.py` (PreToolUse) bloqueia dispatches sem `model` no Task tool ou com `model` divergente do canônico. `verify-output-packet.py` (Stop) emite warning em stderr quando `usage.model` resolvido diverge do `model` requested no Work Packet — defesa pós-fato, não-bloqueante (o trabalho já aconteceu).

**Work Packet `model: ...`** é descritivo (pro subagent auto-conhecer seu tier no prompt), nunca enforced no runtime.

## Why not Opus everywhere

Opus consumes platform quota roughly 5× faster than Sonnet. The squad's heaviest amplifier is `fan_out`: a Role marked `fan_out: true` can be instantiated N times in parallel. Pushing `dev` (the most fan-out-heavy Role) to Opus would burn a typical user's quota in a single feature.

The framework's calibration places Opus only where:

1. The Role's value comes from reasoning quality, not throughput (`logic-reviewer`, `blocker-specialist`), AND
2. The Role's dispatch frequency or fan-out factor does not amplify cost into a quota emergency.

Tier-aware calibration sharpens this further: T1/T2 tasks run dev/code-reviewer/qa on haiku, saving quota for T3/T4 work where opus pays off. The Tier × Loop table is the framework's bet on a defensible cost/quality tradeoff for the typical Max 5x user.

Worst-case rough estimate for one feature with `fan_out` of 2 on dev and reviewers + 1 qa, single review cycle:

- All Sonnet baseline: ~9 Sonnet dispatches
- Tier-aware calibration on a mixed T2/T3 feature: ~3 haiku + 4 sonnet + 2 opus ≈ 13 Sonnet-equivalent units
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
