# Model/effort selection — canonical Tier × Loop enforcement

Referenced from `skill.md` step 3 and the Dispatch contract. On every Subagent dispatch the orchestrator MUST (a) pass the Task tool `model` parameter AND (b) populate the Work Packet `model` and `effort` fields, all per the Tier × Loop table below. The Subagent frontmatter default is documentation-only — never trust it to be honored at runtime.

## Contents
- Tier × Loop table (model + effort per role/loop)
- Tier definitions (operational)
- Selection algorithm
- Concrete Task tool call example
- Dynamic tier reclassification

## Canonical Tier × Loop table
Inlined from [`shared/concepts/effort.md`](../../../shared/concepts/effort.md) — keep in sync.

| Step / Role            | Description                                | T1 — Procedural | T2 — Pattern    | T3 — Judgement  | T4 — Core complex |
|------------------------|--------------------------------------------|-----------------|-----------------|-----------------|-------------------|
| **dev L1**             | First implementation                       | haiku, high     | sonnet, medium  | sonnet, high    | sonnet, high      |
| **dev L2**             | Retry with `previous_findings` from reviewer | sonnet, medium ¹ | sonnet, high ¹  | sonnet, high    | sonnet, high      |
| **dev L3**             | Final retry (`review_loops_max = 3`)       | sonnet, high ¹  | sonnet, high    | sonnet, high    | **opus, high** ²  |
| **dev qa-L1**          | Retry after qa fail (skips reviewers)      | sonnet, medium  | sonnet, high    | sonnet, high    | sonnet, high      |
| **dev qa-L2**          | Final retry after qa fail                  | sonnet, high    | sonnet, high    | sonnet, high    | **opus, high** ²  |
| **code-reviewer**      | Any loop (L1/L2/L3)                        | sonnet, medium  | sonnet, medium  | sonnet, medium  | sonnet, medium    |
| **logic-reviewer**     | Any loop (L1/L2/L3)                        | sonnet, medium  | sonnet, medium  | sonnet, high    | opus, high        |
| **qa**                 | Any attempt                                | sonnet, medium  | sonnet, medium  | sonnet, medium  | **sonnet, high**  |
| **blocker-specialist** | Any trigger (cap, stall, conflict)         | opus, xhigh ³   | opus, xhigh ³   | opus, xhigh ³   | opus, xhigh ³     |
| **audit-agent**        | Singleton pre-handoff                      | haiku, medium ⁴ | haiku, medium ⁴ | haiku, medium ⁴ | haiku, medium ⁴   |
| **chronicler**         | Delivery report post-audit (step 8.5)      | sonnet, high ⁵  | sonnet, high ⁵  | sonnet, high ⁵  | sonnet, high ⁵    |

¹ Subir tier do `dev` quando há `previous_findings` carregado — contexto mais rico exige modelo mais forte para não repetir o erro do loop anterior.
² Última chance em core complex: opus **high** (não medium). Economizar effort aqui é exatamente onde débito técnico entra.
³ Blocker é raro e alta aposta — opus xhigh sempre. Custo agregado fica baixo porque dispatch frequency é low.
⁴ Audit é reconciliação mecânica de manifesto vs outputs — haiku medium é o ponto certo. Subir desperdiça quota.
⁵ **chronicler** — `sonnet, high`, tier-independent. Synthesis + long narrative over large context; observational (not causal), so Sonnet over Opus. Runs once per pipeline at step 8.5.

## Tier definitions (operational)

| Tier | Definition | Example |
|------|-----------|---------|
| **T1 — Procedural** | Single path, no design decision, no non-obvious invariant | Rename, add field, copy existing pattern |
| **T2 — Pattern** | Established repo pattern, 1–2 local decisions | Endpoint mirroring existing endpoints |
| **T3 — Judgement** | Multiple design decisions, cross-file impact | New auth flow, module refactor |
| **T4 — Core complex** | Domain invariant, concurrency, security, data migration, public contract. Error = incident | Schema migration, lock manager, RBAC core |

Tie-break: when in doubt between two tiers, escalate to the higher one.

## Algorithm
1. Read the task's `Tier:` field from `tasks.md` (values: `T1`, `T2`, `T3`, `T4`). If absent → abort with error `"Task <T-XXX> in tasks.md missing required Tier field — required by orchestrator model/effort calibration"`. Do NOT silently default; that defeats the calibration.
1a. **Lite-mode tier clamp:** if `session.yml.pipeline_mode == "lite"` AND the declared `Tier:` is `T3` or `T4`, **clamp to `T2`** for this dispatch and record `pm_note: "Lite-mode tier clamp T<X> → T2"` on the `actual_dispatches[]` entry. The clamp is per-dispatch (transient) and does NOT rewrite `tasks.md`. If reviewer findings later trigger dynamic tier reclassification beyond T2 (e.g., race condition surfaced), the orchestrator MUST switch the Session out of `lite` mode (atomic write to `session.yml.pipeline_mode = "standard"`) before dispatching the bumped tier — lite is a budget contract; breaking it requires explicit mode change.
2. Determine the dispatch's **loop kind** by inspecting `task_states[T-XXX]` and the immediately preceding dispatch in `actual_dispatches[]`:
   - `dev` + first dispatch on task → `dev L1`
   - `dev` + previous_findings from reviewer + `task_states.loops == 2` → `dev L2`
   - `dev` + previous_findings from reviewer + `task_states.loops == 3` → `dev L3`
   - `dev` + previous_findings from qa + qa-loop 1 → `dev qa-L1`
   - `dev` + previous_findings from qa + qa-loop 2 → `dev qa-L2`
   - `code-reviewer` / `logic-reviewer` / `qa` → look up by role only (loop-independent)
   - `blocker-specialist` → opus, xhigh (tier-independent)
   - `audit-agent` → haiku, medium (tier-independent)
   - `chronicler` → sonnet, high (tier-independent)
3. Look up `(loop_kind, tier)` in the Tier × Loop table → `(model, effort)`.
4. **Pass `model` as the Task tool's `model` parameter** — this is what actually controls the subagent's run-model. Omitting it bypasses the table entirely.
5. Write `model`, `effort`, `tier` into the Work Packet YAML (descriptive only — for subagent self-awareness and audit).

## Concrete Task tool call (canonical example for a qa T1 dispatch)
```
Task(
  subagent_type="qa",
  model="haiku",              # ← REQUIRED — derived from Tier × Loop table
  description="QA validation for T-001",
  prompt='''WorkPacket:
```yaml
# Stable block (cache-friendly prefix)
session_id: FEAT-NNN
spec_ref: ./.agent-session/FEAT-NNN/spec.md
plan_ref: ./.agent-session/FEAT-NNN/plan.md
tasks_ref: ./.agent-session/FEAT-NNN/tasks.md
output_locale: pt-BR
project_context:
  standards_ref: ./CLAUDE.md
# Variable block (per-dispatch)
task_id: T-001
dispatch_id: d-T-001-qa-l1
model: haiku
effort: high
tier: T1
subagent_type: qa
ac_scope: [AC-001]
scope_files: [src/auth/login.ts]
previous_findings: null
```
'''
)
```
Omitting `model="haiku"` causes the subagent to run on the orchestrator's own model (opus), and `verify-tier-calibration.py` will block the dispatch.

## Dynamic tier reclassification
If reviewer findings on a `dev` L1 Output Packet reveal complexity exceeding the initial `Tier:` (e.g., findings cite invariants, race conditions, or cross-module impact not anticipated in the original tier), the orchestrator MUST update the task's `Tier:` line in `tasks.md` BEFORE dispatching the L2 dev. Append a `Tier-bump note:` line on the task explaining the bump (one line). The L2+ dispatches read the corrected tier. Tier reclassification is logged on the next `actual_dispatches[]` entry's `pm_note` as `"Tier-bump T<X> → T<Y> — <one-line reason>"`.
