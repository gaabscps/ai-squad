# V2 — Supervisor Agent: Research & Viability Analysis

> **Status:** research artifact (V2 planning).
> **Date:** 2026-05-03.
> **Decision:** **Not yet implementable** as conceived — requires Claude Code platform feature (Agent Teams) to leave experimental, OR a redesign to fit current constraints.

This document captures the research that informed the V2 concept, the viability constraints discovered, and the open questions that need to be resolved before implementation can begin.

---

## Motivation

In V1, the human is the **Decider** at every cross-squad handoff:

- After Discovery's Decide phase, the human reads `memo.md` and recomposes the SDD pitch.
- After SDD's Build phase, the human accepts the handoff.
- The squads never communicate directly — only through human-mediated artifacts.

This is **defensible for V1** (research-validated: SVPG documents batch handoff as an anti-pattern when freshness is not re-checked by a human). But it makes the human the bottleneck of automation.

**V2 goal:** turn the human into a **Reviewer** (HOTL — human-on-the-loop) instead of a Decider (HITL — human-in-the-loop). A new agent — provisionally called **Supervisor** — takes cross-squad decisions; the human audits them post-hoc.

---

## Industry research — Is the concept defensible?

We dispatched targeted research on 5 dimensions (E1–E5). Summary:

| # | Dimension | Recommendation | Maturity in industry |
|---|-----------|----------------|----------------------|
| **E1** | HOTL vs HITL — taxonomy and criteria | **HOTL fits** when action is reversible (Discovery→SDD handoff is: memo + pitch are markdown, no prod side-effect) | Vocabulary consolidated; numbered SAE-style levels still emerging |
| **E2** | Executive/Manager agent above orchestrator | Pattern documented: **Hierarchical Agent Tree** (Google ADK), **CrewAI hierarchical (`manager_agent`)**, **LangGraph Supervisor**, **AutoGen GroupChatManager** | Emerging — production case studies sparse; Anthropic itself has not blessed an "executive" tier publicly |
| **E3** | Context management for broader-scope agents | Anthropic canonical 2025-2026 stack: **sub-agent distillation + memory tool + compaction + hierarchical summarization** (84% token reduction on 100-turn evals). **Already aligned with our Output Packet pattern** (proto-A2A) | Consolidated |
| **E4** | Guardrails for autonomous decisions | Non-negotiables: **confidence threshold + reversibility gate + critic agent + audit log + hard-HITL on irreversibles** (Anthropic + OpenAI both shipped explicit guardrail/approval APIs in 2025) | Consolidated |
| **E5** | Cross-squad / cross-pipeline orchestration | Pattern exists (CrewAI hierarchical, LangGraph supervisor, Google ADK + A2A). **Discovery→Delivery automation is a documented gap** in published literature — V2 ai-squad would be greenfield here | Emerging — V2 would stake ground |

**Naming decision (research-backed, not invented):** Use **`supervisor`** (LangGraph terminology — most neutral, most cited). Avoid `manager_agent` (CrewAI-specific) and `Project Engineer` (invented, no industry traction).

**Conceptual conclusion:** the concept is **defensible**. Combining HOTL + Supervisor pattern + Output Packets (≈A2A) + memory tool is the right shape. Each piece is consolidated or emerging individually; combining them for Discovery→Delivery is the novel piece.

---

## Claude Code platform constraints — Is the concept implementable?

We dispatched a second research pass focused on Claude Code platform limits (T1–T5). **The findings change the picture significantly.**

### T1 — Subagents cannot invoke other Subagents

> "Subagents work within a single session; agent teams coordinate across separate sessions." — [Subagents docs](https://code.claude.com/docs/en/sub-agents)
> "No nested teams: teammates cannot spawn their own teams or teammates. Only the lead can manage the team." — [Agent Teams docs](https://code.claude.com/docs/en/agent-teams)

**Maximum dispatch depth = 1.** This is enforced by the platform.

### T2 — Skills cannot invoke other Skills directly

Skills are invoked by the human (via slash command) or by `context: fork` into a Subagent. There is no Skill-to-Skill dispatch primitive.

### T3 — Skills CAN dispatch Subagents (current pattern)

This is what we already do (orchestrator Skill → 6 Subagents). No constraint observed at our usage levels. Limits: ~200k context per Subagent, ~10min timeout per task, no published cap on parallel dispatches.

### T4 — Multi-level "agent of agents" is only possible via Agent Teams (experimental)

Claude Code ships an **experimental** feature called [Agent Teams](https://code.claude.com/docs/en/agent-teams):

- Activated via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in settings.json
- Provides "Team lead + multiple Teammates (separate sessions) with shared task list + peer-to-peer messaging"
- Limitations: no session resumption with in-process teammates, task status can go stale, **still no nested teams**

This is the only documented path to depth > 1.

### T5 — Workarounds (all hacky)

- **Hooks** (PreCommand, PostToolUse, SessionStop) can sequence actions but are not orchestration primitives
- **MCP servers** can coordinate via protocol — infra, not orchestration
- **External orchestration** (bash script invoking `claude` CLI N times) simulates depth > 1 but loses the integrated UX
- **Slash command chains** (sequential `/orchestrator → /dev-1 → /reviewer-1`) — manual workaround
- **Skill with loop + manual approval gates** — simulates supervisor logic but requires human in the loop (defeats V2's purpose)

---

## Viability analysis — 4 scenarios

Given the platform constraints, V2 has 4 paths forward, each with trade-offs:

### Scenario A — Supervisor as Skill, squad orchestrators as Subagents (depth=1)

```
Supervisor (Skill, main session)
  └─> sdd-orchestrator (Subagent)
  └─> discovery-orchestrator (Subagent)
```

**Problem:** today the squad orchestrators are Skills that dispatch Subagents (dev, code-reviewer, etc). If they become Subagents themselves, they **lose the ability to dispatch their own workers** (depth=1 enforced — Subagents can't dispatch Subagents).

**Verdict:** **Not viable** without redesigning the entire SDD Phase 4 / Discovery Phase 2 workflow to flatten the worker dispatch into the Supervisor itself — which would balloon the Supervisor's responsibility absurdly.

### Scenario B — Use Claude Code Agent Teams (experimental)

```
Supervisor = Team Lead
  └─> sdd-orchestrator = Teammate (separate session)
  └─> discovery-orchestrator = Teammate (separate session)
      └─> each can dispatch its own Subagents in its own session
```

**Pros:** purpose-built for multi-level coordination; matches the conceptual design.

**Cons:**
- **Experimental feature** — not stable, requires opt-in via env var
- **No session resumption** with in-process teammates
- **Task status can go stale** (documented limitation)
- Adoption locks ai-squad to bleeding-edge Claude Code

**Verdict:** **Viable but premature.** Wait for Agent Teams to leave experimental; until then, V2 implementation would carry platform risk.

### Scenario C — Supervisor as Skill, emits slash commands for human to run

```
Supervisor (Skill, main session)
  └─> reads Discovery memo
  └─> composes pitch
  └─> tells human: "run /spec-writer '<composed pitch>'"
```

**Problem:** the human still has to click. The Supervisor is just a "memo summarizer" — doesn't actually take the decision autonomously.

**Verdict:** **Not really V2.** This is essentially V1 with extra ceremony.

### Scenario D — External orchestration (bash script over Claude Code CLI)

```
supervisor.sh (bash)
  └─> claude /discovery-orchestrator DISC-001 (separate Claude session)
  └─> reads DISC-001/memo.md from filesystem
  └─> composes pitch in bash
  └─> claude /spec-writer "<pitch>" (separate Claude session)
```

**Pros:** works today, no platform constraint.

**Cons:** loses the integrated Claude Code UX; the Supervisor is just glue code, not an agent; debugging cross-session state is painful; no LLM judgment in the supervisor itself (or you'd need a second Claude API call from bash).

**Verdict:** **Viable but degraded.** Not the conceptual V2 — closer to a CI pipeline.

---

## Recommendation

**Hold V2 implementation until Claude Code Agent Teams leaves experimental.**

Rationale:
- Scenarios A and C don't deliver V2's value proposition.
- Scenario B (Agent Teams) is the right fit conceptually but carries platform risk while experimental.
- Scenario D loses too much integrated UX to be worth the engineering.

In the meantime:
- Track Claude Code release notes for Agent Teams promotion to stable.
- Refine the conceptual design (decision rules, confidence thresholds, critic shape) so that when the platform is ready, V2 implementation is unblocked.
- Continue strengthening V1 — the human-in-the-loop pattern is research-validated and the time-decoupled handoff anti-pattern mitigations (Open Questions for Delivery, manual freshness check) are already best-in-class.

---

## Open questions for V2 implementation (when unblocked)

1. **Confidence threshold values** — what does "high confidence" numerically mean for cross-squad handoff? (Possibly: all Discovery risks `validated`, no `inconclusive`, severity ≤ medium, decision rule R4 matched without override.)
2. **Critic agent shape** — analogous to logic-reviewer in SDD Phase 4, but reviewing the recomposed pitch. What contract? What evidence does it cite?
3. **Audit log format** — machine-readable (JSON) for git-diff-style review, or human-readable Markdown? Where stored (`.agent-session/supervisor-NNN/decisions/`)?
4. **Hard-HITL triggers** — confirmed list: `kill` decisions, blocker-specialist escalations, Open Questions for Delivery unresolved, recommendation override applied. Anything else?
5. **Naming reconfirmation** — `supervisor` is research-backed (LangGraph), but should we revisit when implementing?
6. **Squad layout** — implement as `squads/supervisor/` (3rd squad with 1 Role) or `shared/skills/supervisor.md` (cross-squad utility)?

---

## Sources

### Industry / agent design (E1–E5)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic — Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- [Anthropic — Measuring agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy)
- [Anthropic — Hierarchical summarization for monitoring](https://alignment.anthropic.com/2025/summarization-for-monitoring/)
- [OpenAI — Guardrails and human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals)
- [OpenAI Agents SDK — Guardrails](https://openai.github.io/openai-agents-python/guardrails/)
- [Galileo — AI Agent Guardrails Framework](https://galileo.ai/blog/ai-agent-guardrails-framework)
- [Agentic AI Survey (arXiv 2510.25445)](https://arxiv.org/html/2510.25445v1)
- [A-Mem (arXiv 2502.12110)](https://arxiv.org/pdf/2502.12110)
- [CrewAI vs LangGraph vs AutoGen comparison](https://www.datacamp.com/tutorial/crewai-vs-langgraph-vs-autogen)
- [Waxell — HITL vs HOTL for AI Agents](https://www.waxell.ai/blog/human-in-the-loop-vs-human-on-the-loop-ai-agents)

### Claude Code platform (T1–T5)
- [Claude Code — Skills Documentation](https://code.claude.com/docs/en/skills)
- [Claude Code — Subagents Documentation](https://code.claude.com/docs/en/sub-agents)
- [Claude Code — Agent Teams Documentation (experimental)](https://code.claude.com/docs/en/agent-teams)
- [Claude Code — How Claude Code Works](https://code.claude.com/docs/en/how-claude-code-works.md)
- [Claude Multi-Agent Ecosystem](https://codex.danielvaughan.com/2026/04/09/claude-multi-agent-ecosystem/)
- [Issue #4182 — Sub-Agent Task Tool Not Exposed When Launching Nested Agents](https://github.com/anthropics/claude-code/issues/4182)
