# Risk-analyst fan-out — dispatch contract + aggregation + gate

Referenced from `skill.md` steps 3–6. The parallel investigation of Cagan's Four Big Risks: how to dispatch 4× `risk-analyst`, how to aggregate the 5 Output Packets into `memo.md`, and how the conditional approval gate decides between auto-advance and a human checkpoint.

## Contents
- [Dispatch the 4 risk-analysts (step 3)](#dispatch-the-4-risk-analysts-step-3)
- [Per-risk verdict handling](#per-risk-verdict-handling)
- [Aggregate the 5 Output Packets (step 4)](#aggregate-the-5-output-packets-step-4)
- [Memo section to write (step 5)](#memo-section-to-write-step-5)
- [Conditional approval gate (step 6)](#conditional-approval-gate-step-6)

## Dispatch the 4 risk-analysts (step 3)
Emit 4 Work Packets in parallel, one per Cagan Big Risk. All written to `.agent-session/<spec_id>/inputs/risk-analyst-<risk_category>-<dispatch_id>.json`:

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

Wait for all 4 Output Packets. Validate each against the canonical Output Packet schema. risk-analyst-specific fields (`risk_category`, `verdict`, `severity`) are required; the canonical schema treats them as optional fields valid only when `role: risk-analyst`.

## Per-risk verdict handling
- **N/A** — if a risk category does not apply (e.g. `value` risk for an internal infra change), the risk-analyst returns `verdict: "N/A"` with a 1-sentence `rationale`. Do NOT treat `N/A` as failure.
- **Inconclusive** — if a risk-analyst returns `verdict: "inconclusive"` (insufficient data, requires user research, requires external input), do NOT cascade individually. Gather all 4 outputs first; the gate (step 6) handles inconclusive collectively.
- **Blocked** — if a risk-analyst returns `blocked`, do NOT block the other 3 instances. Record the blocked instance with `verdict: blocked`; the gate triggers.

## Aggregate the 5 Output Packets (step 4)
Build aggregated state in memory:
- 1× codebase-mapper output (surface map, free text)
- 4× risk-analyst outputs (each with `risk_category`, `verdict`, `severity`, `rationale`, `evidence[]`)

No synthesis — only structured aggregation. Synthesis (Recommendation, Decision) belongs to `discovery-synthesizer` in Phase 3.

## Memo section to write (step 5)
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

Set `memo.md.phase_completed: investigate` only AFTER the gate (step 6) resolves (gate or auto-advance).

## Conditional approval gate (step 6)
Decide gate vs auto-advance from the 4 risk verdicts:
- **Auto-advance** if ALL 4 verdicts ∈ `{validated, refuted, N/A}` AND ALL 4 severities ∈ `{low, medium}`.
- **Approval gate** if ANY verdict is `inconclusive` OR ANY severity is `high`.

When the gate triggers, print the visual checklist (Kiro pattern):

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

Then use `AskUserQuestion` with a binary choice:

```
Proceed to Phase 3 (Decide), or stop here?
[ ] Proceed — synthesizer will weigh options including the inconclusive items
[ ] Stop — Session pauses; resume later with /discovery-orchestrator DISC-NNN --resume after gathering more data
```

On `Stop` → set `current_phase: paused` in `session.yml`; populate `phase_history.investigate` with `pause_reason`; exit cleanly.
