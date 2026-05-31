# Intent collection — planned_phases, pipeline_mode, output_locale

Referenced from `skill.md` steps 2, 2.5, 2.6. These three are **user intent**, never inferred from prior Sessions or from how the feature "looks". Each runs on every fresh-start invocation and is NEVER skipped by PM bypass — bypass governs APPROVAL gates (steps 6.5/7) only, not intent collection. The non-negotiable invariants stay in `skill.md`; the prompt text, save mechanics, and flag overrides live here.

## Contents
- Step 2 — Plan the Phases (`planned_phases`)
- Step 2.5 — Pipeline mode (`pipeline_mode`)
- Step 2.6 — Output locale (`output_locale`)

## Step 2 — Plan the Phases (`planned_phases`)

If you find yourself about to auto-pick `planned_phases` because a previous Session in `.agent-session/` did it that way: STOP and run `AskUserQuestion` regardless. The user may want a different shape this time.

Use `AskUserQuestion` with checkbox. **Default = planning only (Specify + Plan + Tasks); Implementation UNCHECKED by default** — recommended path is to run Implementation in a separate session via `/orchestrator FEAT-NNN --resume` for (a) clean per-phase cost attribution in `report.html`, and (b) structural prevention of PM-mode inference from planning history (a recurring bug class — see commits `4a06ff9`, `d91c0a4`).

```
Which Phases will this Session run? (Recommended: leave Implementation UNCHECKED and run it in a fresh `--resume` session.)
[x] Specify (always; you are here)
[x] Plan
[x] Tasks
[ ] Implementation  — opt-in only; checking this runs everything in this session and gives an APPROXIMATE planning/orchestration cost split (timestamp-bracketed, not session-isolated).
```

Save selection to `session.yml.planned_phases` (atomic write: tmp + rename). Power-user flag `--plan="specify,plan,tasks,implementation"` bypasses the prompt with explicit semantics (use it to opt into single-session implementation).

## Step 2.5 — Pipeline mode (`pipeline_mode`)

`pipeline_mode` is user intent about scope of the change, NOT an inference from "this looks visually medium-sized" or from prior Sessions. If you find yourself about to auto-pick `standard` because the feature looks non-trivial, or auto-pick from a prior Session's mode: STOP and run `AskUserQuestion` regardless. The user is the only authority on whether this is a `lite` or `standard` change.

Use `AskUserQuestion` (binary):

```
What's the scope of this change?

[ ] Small change (lite mode)
    Fix, small refactor, doc/copy change, or single-purpose feature.
    Downstream effects:
      - task-builder caps total tasks at 2
      - task-builder auto-skips logic-reviewer for single-purpose tasks
      - orchestrator caps fan-out at 1 (sequential tasks)
      - orchestrator clamps tier ceiling to T2 (cheap dispatch by default)
    Quality unchanged: logic-gap sweep, edge-case categories, audit-gate all still mandatory.

[ ] Standard or larger (default)
    All Phases run with full rigor, fan-out, and per-task tier calibration.
```

Save selection to `session.yml.pipeline_mode` (atomic write: tmp + rename). Valid values: `lite`, `standard`. Power-user flag `--mode=lite|standard` bypasses the prompt with the same semantics.

**Recommendation surfaced after the answer:** if `lite` selected and `planned_phases` still includes `plan`, print a short note: `"Lite mode typically skips the Plan Phase. Current planned_phases keeps it — that's fine if you have a real architecture decision to capture; otherwise re-run /spec-writer with --plan='specify,tasks,implementation' to drop it."` Do not auto-mutate `planned_phases`; respect the user's earlier choice.

## Step 2.6 — Output locale (`output_locale`)

`output_locale` is the language of ALL human-facing prose the pipeline will emit (summaries, findings, blockers, the report content, `handoff.md`). It is detected from the conversation, NOT pattern-matched from prior Sessions.

1. **Detect:** infer the language the human is using in this conversation/pitch. Express it as a BCP-47 tag with a hyphen (e.g. `pt-BR`, `en-US`, `es`). Normalize any underscore form (`pt_BR`) to hyphen.
2. **Interactive mode** (no PM bypass): confirm via `AskUserQuestion` (binary), defaulting to the detected tag:
   ```
   I'll generate all human-facing content (summaries, findings, report, handoff)
   in <language name> (<tag>). Use this language?
   [ ] Yes, use <tag>
   [ ] No, choose another  (free-form: enter a BCP-47 tag)
   ```
   On a free-form answer, normalize to a hyphenated BCP-47 tag.
3. **PM bypass** (`session.yml.auto_approved_by == "pm"`, detected later at 6.5): there is no human to confirm. Write the **detected** tag directly. If detection is inconclusive, write `en`. Do NOT run `AskUserQuestion`.
4. **Fallback:** if detection yields nothing usable and you are interactive, offer `en` as the default in the question. The stored value is never empty — absent downstream means `en`, but spec-writer always writes an explicit value.
5. Save to `session.yml.output_locale` (atomic write: tmp + rename).

Power-user flag `--locale=<tag>` bypasses detection and the prompt with explicit semantics (normalized to hyphen). See [`shared/concepts/output-locale.md`](../../../shared/concepts/output-locale.md).
