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
Generate the next free id `OBS-NNN` (scan `.agent-session/OBS-*`). Get the
real timestamp via Bash (`date -u +%Y-%m-%dT%H:%M:%SZ`) — never guess the
clock. Write `.agent-session/OBS-NNN/session.yml`:

```yaml
schema_version: 1
session_id: OBS-NNN
mode: observed            # wakes track-attention; SDD machines ignore it
intent: "<the human's one-liner>"
status: in_progress
output_locale: <human's language, BCP-47>
created_at: <now, UTC ISO-8601>
base_sha: <git rev-parse HEAD>   # diff anchor; capture via Bash at open
```

Tell the human the contract is open and what is now captured automatically
(cost, time, attention status), then continue with whatever they asked.

Capture `base_sha` too with `git rev-parse HEAD` (Bash) and write it into the session.yml — it is the stable anchor for the session's diff. If the repo is not a git repo (the command fails), omit the field.

### 1.5 Feature (agrupamento — pergunta única na abertura)

Every observed session belongs to a feature (a Jira card or a loose user
request). Ask ONCE, right after opening the contract — never mid-work, and
never again on resume (if `session.yml` already has a `feature:` block, read
it and move on).

1. Scan sibling `.agent-session/*/session.yml` files for existing `feature:`
   blocks; collect the ~5 most recently active (dedup by `id`).
2. Ask via `AskUserQuestion` (self-sufficient widget — instrumentation
   preference, same as step 2's): options = each recent feature as
   "<id> · <name>" (label "continuar"), plus "Nova feature" and
   "Sem feature por ora".
3. Resolve the block:
   - **Continuar**: copy `id`/`key`/`name` verbatim from the chosen block
     (string divergence is impossible by construction).
   - **Nova** with an issue-key (`^[A-Z][A-Z0-9]*-\d+$`): `key` = the key
     uppercased, `id` = same as key. If a Jira tool (MCP) is available,
     fetch the issue and set `name` = real title, plus a snapshot; if not,
     `name` = the key itself (the next session enriches it).
   - **Nova** with a free name: no `key`; `id` = `ft-<slug(name)>` (lowercase,
     accents stripped, non-alphanumerics → hyphens).
   - **Sem feature**: `id` = `ft-<slug(intent)>`, `name` = the intent. This is
     a legitimate orphan — an explicit human choice, not a failure.
4. Write the block into `session.yml` (same write as the contract or a
   follow-up edit — the deployed verify-observed-feature hook validates the
   shape and corrects YOU, the agent, if malformed):

```yaml
feature:
  key: PAY-1234              # only when an issue-key was given
  name: "Export de fatura"
  id: PAY-1234               # == key when present; ft-<slug(name)> otherwise
  jira_snapshot:             # only when key + Jira MCP available
    status: "In Progress"
    fetched_at: <now, UTC ISO-8601>
    url: "https://<site>/browse/PAY-1234"
```

This is instrumentation (like preferring AskUserQuestion in step 2), NOT an
implementation opinion — the stone rule stands: zero opinions about HOW the
work is done.

### 2. Work (not this Skill's business)
No steps here, on purpose. One instrumentation preference (not an opinion on
the work): when you need a blocking decision from the human, prefer the
`AskUserQuestion` tool over a plain-text question — the tool call is what
flips `needs_attention` mechanically for the aiOS attention column.

### 3. Trail enrichment (best effort, not load-bearing)
While working, when you make a REAL choice between alternatives or reject an
approach, record it with the trail-emit helper. It runs as a normal Bash command
and the deployed hook stamps the time mechanically, appending one chronological
line to `.agent-session/<id>/trail.jsonl`:

    python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/trail-emit.py" decision \
      --what "<the choice>" [--why "<reason>"] [--rejected "<alternative>"] [--ref "<file:line>"]

You do NOT supply the time and do NOT edit `session.yml` — the helper builds the
JSON safely from its arguments, so quotes and accents survive, and aiOS orders
the trail by the mechanical timestamp. Verifications need no special step: the
Bash commands you already run are captured mechanically as `run` markers on the
same trail, in order. This is instrumentation, not an implementation step (like
preferring AskUserQuestion in step 2) — the Skill still has ZERO opinions about
HOW you build. If discipline fades in a long session, fine — cost/time/attention
stay mechanical, and the chronicler mines the transcript afterwards. Never
interrupt the work to file reports. (Legacy `decisions[]`/`evidence[]` keys in
`session.yml` are still read as a fallback, but the helper is the path.)

### 4. Close
When the human declares the work done (or abandoned), set `status: done`
(or `status: abandoned`) AND `closed_at: <now, UTC ISO-8601>` (real clock via
Bash, like created_at) in `session.yml`. `closed_at` is load-bearing: it is the
window's end bound — the cost capture brackets every snapshot to
created_at → closed_at, so a chat session that later moves on to another
contract never leaks its spend back into this one. The Stop hooks emit the
final cost-report; `/ship OBS-NNN` cleans up later if wanted.

## Optional governance (à la carte)
If the human asks for a write fence, record the agreed file list under
`approved_write_scope:` in `session.yml` — the deployed fence enforces it.
Without that key, no fence: free sessions stay free.

## Hard rules
- Never add implementation opinions to this Skill (stone rule above).
- Never block or slow the work to maintain the trail — observability is
  best-effort in-flight, mechanical at the edges.
- One observed Session per piece of work; resume just works (state on disk).
- Close a contract before opening the next one in the same repo. Each chat
  session is adopted by ONE open contract (recorded under `observed_sessions:`
  by the hooks) and its cost is window-sliced to that contract's lifetime;
  leaving several contracts open makes the adoption of NEW chat sessions
  ambiguous (newest contract wins).
