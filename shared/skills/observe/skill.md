---
name: observe
description: Opens the observability contract for a free coding session — creates the Session state file that wakes the capture/attention hooks, states the minimal trail vocabulary, then gets out of the way. Cross-squad, harness-led; conducts no Phase and has ZERO opinions about how to implement. Use with /observe "<short intent>" at the start of feature work you want tracked (cost, time, attention, decisions) in aiOS.
---

# Observe — open the observability contract (auxiliary)

`/observe "<intent>"` instruments THIS session: from here on, the deployed
hooks capture cost/time mechanically, flip `needs_attention` when the session
blocks on the human, and the post-hoc analyst can mine the transcript for the
delivery story. The work itself stays yours — brainstorm, plan, TDD, any skill
set, any style. This Skill conducts no Phase and never tells you how to build.

**Stone rule: this Skill has ZERO opinions about how to implement.** If a
future edit adds an implementation step ("before coding, do X"), that edit is
wrong — reject it. The execution engine is the harness + the model; ai-squad
only observes, reports, and (optionally) fences.

## When to invoke
- `/observe "fixar emails na dashboard"` — start of tracked feature work.
- `/observe` with no intent — ask the human for a one-line intent, then proceed.

## Steps

### 1. Open the contract
Generate the next free id `OBS-NNN` (scan `.agent-session/OBS-*`). Write
`.agent-session/OBS-NNN/session.yml`:

```yaml
schema_version: 1
session_id: OBS-NNN
mode: observed            # wakes track-attention; SDD machines ignore it
intent: "<the human's one-liner>"
status: in_progress
output_locale: <human's language, BCP-47>
created_at: <now, UTC ISO-8601>
```

Tell the human the contract is open and what is now captured automatically
(cost, time, attention status), then continue with whatever they asked.

### 2. Work (not this Skill's business)
No steps here, on purpose.

### 3. Trail enrichment (best effort, not load-bearing)
While working, when you make a REAL choice between alternatives or reject an
approach, append it to `decisions[]` in `session.yml` (`what`/`why`/`rejected`
/`ref`); when you verify, append `evidence[]` (cmd + result). If discipline
fades in a long session, fine — cost/time/attention stay mechanical, and the
chronicler mines the transcript afterwards. Never interrupt the work to file
reports.

### 4. Close
When the human declares the work done (or abandoned), set `status: done`
(or `status: abandoned`) in `session.yml`. The Stop hooks emit the final
cost-report; `/ship OBS-NNN` cleans up later if wanted.

## Optional governance (à la carte)
If the human asks for a write fence, record the agreed file list under
`approved_write_scope:` in `session.yml` — the deployed fence enforces it.
Without that key, no fence: free sessions stay free.

## Hard rules
- Never add implementation opinions to this Skill (stone rule above).
- Never block or slow the work to maintain the trail — observability is
  best-effort in-flight, mechanical at the edges.
- One observed Session per piece of work; resume just works (state on disk).
