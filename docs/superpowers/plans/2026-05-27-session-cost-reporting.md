# Session Cost Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Project note:** ai-squad does NOT dogfood its own SDD pipeline on itself. Execute this plan with manual Read/Edit/Write + the pytest suite, in the pair protocol (one task, await approval, next).
>
> **Status — IMPLEMENTED (2026-05-27).** All runtime lives in `squads/sdd/hooks/` (the only code that deploys per-repo, into `<repo>/.claude/hooks/`). This doc reflects the final locations. Two design decisions diverged from the first draft: (a) the audit-agent is **read-only** — it flags `cost_capture_incomplete` but the orchestrator does the backfill + report emission; (b) an HTML report (`report.html`) is generated automatically on session `Stop`. The only remaining manual step is the live end-to-end smoke (Task 9, Step 5).

**Goal:** Produce a real, API-equivalent dollar cost report per ai-squad session, split into planning / orchestration / implementation, accurate down to prompt-cache economics.

**Architecture:** Cost is derived from the Claude Code JSONL transcripts (per-subagent files + the main-session file), never from a live billing API. Pure-stdlib pricing applies per-model rates with the correct cache multipliers to each token bucket. Capture is filesystem-first: a `SubagentStop` hook writes one cost file per subagent and a `Stop` hook writes the main-session cost; the audit-agent reconciles against the transcripts that physically exist on disk, so a missed hook is a *visible, backfillable* gap, never a silent zero. A report aggregator sums the cost files into `cost-report.json` + a markdown table.

**Tech Stack:** Python 3.10+ (stdlib only — `json`, `pathlib`, `glob`, `fcntl`), pytest. No external deps, no OTEL collector (keeps the framework project-agnostic).

---

## Background facts (verified against real transcripts on 2026-05-27)

These are ground-truth observations the implementation depends on. Re-verify if Claude Code's transcript format changes.

1. **Transcript locations:**
   - Main session: `~/.claude/projects/<project-slug>/<sessionId>.jsonl`
   - Per-subagent: `~/.claude/projects/<project-slug>/<sessionId>/subagents/agent-<agentId>.jsonl` (one file per dispatched subagent — this is why `SubagentStop` is reliable where the old main-session `Stop` hook missed ~90%).
2. **Each assistant line carries `message.usage`** with: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation` as a **dict** `{"ephemeral_5m_input_tokens": N, "ephemeral_1h_input_tokens": M}` (plus a flat `cache_creation_input_tokens` mirror). `message.model` is recorded per line. `message.id` identifies the message; each line also has a top-level `timestamp`.
3. **Duplicate lines:** the same `message.id` appears ~3× with **identical** usage (one line per streamed content block, not incremental). **MUST dedupe by `message.id`** — counting all lines triples the cost.
4. **`input_tokens` is often tiny (e.g. 2)** when context is cache-served. This is CORRECT, not an undercount — the real volume is in `cache_read_input_tokens`. Pricing each bucket at its multiplier reproduces the API bill.

## Cost formula (the single source of truth for every task)

For one model's summed buckets, with `in` = input $/token and `out` = output $/token for that model:

```
cost = input_tokens                 * in
     + ephemeral_5m_input_tokens    * in * 1.25   # 5-minute cache write
     + ephemeral_1h_input_tokens    * in * 2.00   # 1-hour cache write
     + cache_read_input_tokens      * in * 0.10   # cache read (any TTL)
     + output_tokens                * out
```

The buckets are disjoint (`input_tokens` excludes cached tokens), so there is no double counting.

## File structure

| File | Responsibility |
|---|---|
| `squads/sdd/hooks/model_prices.json` | Per-model base rates (input/output $ per Mtok). The one file to update when prices change. |
| `squads/sdd/hooks/pricing.py` | `cost_for_usage(usage, model, prices)` — applies the formula. Cache multipliers are universal constants here. |
| `squads/sdd/hooks/transcript_cost.py` | `extract_transcript_cost(path, prices)` — parse one JSONL, dedupe by `message.id`, sum buckets per model, price. |
| `squads/sdd/hooks/capture-subagent-cost.py` | `SubagentStop` hook. Writes `.agent-session/<FEAT>/costs/agent-<agentId>.json`. No manifest mutation, no lock contention. |
| `squads/sdd/hooks/capture-session-cost.py` | `Stop` hook. Writes `.agent-session/<FEAT>/costs/session-<sessionId>.json`, bracketed into planning vs orchestration by `phase_history` timestamps. |
| `squads/sdd/hooks/cost_report.py` | `build_cost_report(session_dir)` — sum all `costs/*.json` → rollup; `backfill_missing(...)` — write-capable recovery of missed captures (called by the orchestrator). |
| `squads/sdd/hooks/cost-report.py` | Thin CLI. Runtime (deployed): `python3 .claude/hooks/cost-report.py <FEAT-NNN>` → writes `cost-report.json` + prints markdown. |
| `squads/sdd/hooks/session_report.py` | `build_html_report(session_dir, diff_provider)` — renders the HTML report (cost + per-dispatch review + git diff), all content HTML-escaped. |
| `squads/sdd/hooks/generate-session-report.py` | `Stop` hook. Writes `.agent-session/<FEAT>/report.html` at session end when a pipeline is active (guard: `costs/` exists). |
| `squads/sdd/agents/audit-agent.md` | + read-only completeness check: counts on-disk cost files vs expected dispatches; flags `cost_capture_incomplete` (never writes). |
| `squads/sdd/skills/orchestrator/skill.md` | Handoff step 9: backfill missed captures + emit the cost report via `.claude/hooks/`. |
| `shared/schemas/output-packet.schema.json`, `dispatch-manifest.schema.json` | Remove dead `capture-subagent-usage.py` references; mark `usage` legacy (cost lives in `costs/*.json`). |
| `squads/sdd/hooks/claude-hooks.json`, `cursor-hooks.json` | Register hooks: SubagentStop → `capture-subagent-cost`; Stop → `capture-session-cost`, `generate-session-report`. |
| `packages/cli/components/**` | Synced via `npm run sync` (prepare hook); gitignored, ships in the npm tarball. |

---

## Task 1: Model price config + loader

**Files:**
- Create: `squads/sdd/hooks/model_prices.json`
- Create: `squads/sdd/hooks/__tests__/test_model_prices.py`

> **Data-sourcing note (not a placeholder):** the dollar rates below MUST be set from the official Anthropic pricing page (platform.claude.com pricing) at implementation time. The values shown are the structurally-correct shape with last-known published rates for Sonnet/Haiku and a clearly-marked TODO for any model whose public rate you must confirm. Confirm every rate before committing.

- [ ] **Step 1: Create the config file**

`squads/sdd/hooks/model_prices.json`:

```json
{
  "_comment": "Base per-model rates in USD per 1,000,000 tokens. Cache multipliers (5m write 1.25x, 1h write 2x, read 0.1x) are universal and live in pricing.py, NOT here. Update these from platform.claude.com pricing when rates change. Keys are exact model ids as they appear in transcript message.model.",
  "_verify_before_commit": "Confirm every rate against the official pricing page on the commit date.",
  "models": {
    "claude-opus-4-7":   { "input_per_mtok": 15.0, "output_per_mtok": 75.0 },
    "claude-sonnet-4-6": { "input_per_mtok": 3.0,  "output_per_mtok": 15.0 },
    "claude-haiku-4-5":  { "input_per_mtok": 1.0,  "output_per_mtok": 5.0 }
  }
}
```

- [ ] **Step 2: Write the failing test**

`squads/sdd/hooks/__tests__/test_model_prices.py`:

```python
import importlib.util
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("pricing", str(_LIB / "pricing.py"))
pricing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pricing)


def test_load_prices_returns_known_models():
    prices = pricing.load_prices()
    assert "claude-opus-4-7" in prices
    assert prices["claude-opus-4-7"]["input_per_mtok"] > 0
    assert prices["claude-opus-4-7"]["output_per_mtok"] > 0


def test_load_prices_custom_path(tmp_path):
    p = tmp_path / "prices.json"
    p.write_text(json.dumps({"models": {"m": {"input_per_mtok": 2.0, "output_per_mtok": 4.0}}}))
    prices = pricing.load_prices(p)
    assert prices["m"] == {"input_per_mtok": 2.0, "output_per_mtok": 4.0}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_model_prices.py -v`
Expected: FAIL — `pricing.py` does not exist yet (ModuleNotFoundError / exec error).

- [ ] **Step 4: Implement `load_prices` (minimal — full pricing.py comes in Task 2)**

Create `squads/sdd/hooks/pricing.py` with just the loader for now:

```python
"""ai-squad cost pricing — pure stdlib. Applies per-model rates + universal cache multipliers."""
import json
from pathlib import Path

_DEFAULT_PRICES = Path(__file__).resolve().parent / "model_prices.json"


def load_prices(path=None):
    """Return {model_id: {input_per_mtok, output_per_mtok}} from the config file."""
    path = Path(path) if path else _DEFAULT_PRICES
    data = json.loads(path.read_text(encoding="utf-8"))
    return data["models"]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_model_prices.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/hooks/model_prices.json squads/sdd/hooks/pricing.py squads/sdd/hooks/__tests__/test_model_prices.py
git commit -m "feat(cost): model price config + loader"
```

---

## Task 2: `cost_for_usage` — apply the formula

**Files:**
- Modify: `squads/sdd/hooks/pricing.py`
- Create: `squads/sdd/hooks/__tests__/test_pricing.py`

- [ ] **Step 1: Write the failing test**

`squads/sdd/hooks/__tests__/test_pricing.py`:

```python
import importlib.util
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("pricing", str(_LIB / "pricing.py"))
pricing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pricing)

# rate of 1,000,000 $/Mtok == $1 per token: makes the arithmetic exact and readable.
PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}


def test_plain_input_output():
    usage = {"input_tokens": 10, "output_tokens": 5}
    r = pricing.cost_for_usage(usage, "m", PRICES)
    # 10*$1 + 5*$2 = $20
    assert r["cost_usd"] == 20.0
    assert r["priced"] is True


def test_cache_buckets_use_multipliers():
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_input_tokens": 100,                 # *0.10 -> 10
        "cache_creation": {"ephemeral_5m_input_tokens": 100,  # *1.25 -> 125
                           "ephemeral_1h_input_tokens": 100}, # *2.00 -> 200
    }
    r = pricing.cost_for_usage(usage, "m", PRICES)
    assert r["cost_usd"] == 335.0  # (10 + 125 + 200) * $1


def test_flat_cache_creation_fallback_assumes_5m():
    usage = {"cache_creation_input_tokens": 100}  # no dict form
    r = pricing.cost_for_usage(usage, "m", PRICES)
    assert r["cost_usd"] == 125.0  # 100 * 1.25 * $1


def test_unknown_model_is_flagged_not_zeroed():
    r = pricing.cost_for_usage({"input_tokens": 10}, "unknown", PRICES)
    assert r["priced"] is False
    assert r["cost_usd"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_pricing.py -v`
Expected: FAIL — `cost_for_usage` not defined.

- [ ] **Step 3: Implement `cost_for_usage`**

Append to `squads/sdd/hooks/pricing.py`:

```python
# Universal prompt-cache multipliers (relative to base input rate). Anthropic pricing model.
CACHE_WRITE_5M_MULT = 1.25
CACHE_WRITE_1H_MULT = 2.00
CACHE_READ_MULT = 0.10


def _write_buckets(usage):
    """Return (tokens_5m, tokens_1h) from either the dict or flat cache_creation form."""
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        return cc.get("ephemeral_5m_input_tokens", 0), cc.get("ephemeral_1h_input_tokens", 0)
    # Flat fallback: assume 5-minute TTL (Claude Code default) when not broken out.
    return usage.get("cache_creation_input_tokens", 0), 0


def cost_for_usage(usage, model, prices):
    """Compute API-equivalent USD cost for one model's summed token buckets.

    Returns {cost_usd, priced, model, billable_input_tokens, output_tokens}.
    On an unknown model, priced=False and cost_usd=None (never silently 0).
    """
    rates = prices.get(model)
    output = usage.get("output_tokens", 0)
    inp = usage.get("input_tokens", 0)
    read = usage.get("cache_read_input_tokens", 0)
    w5, w1 = _write_buckets(usage)
    if rates is None:
        return {"cost_usd": None, "priced": False, "model": model,
                "billable_input_tokens": inp, "output_tokens": output}
    in_rate = rates["input_per_mtok"] / 1_000_000
    out_rate = rates["output_per_mtok"] / 1_000_000
    cost = (inp
            + w5 * CACHE_WRITE_5M_MULT
            + w1 * CACHE_WRITE_1H_MULT
            + read * CACHE_READ_MULT) * in_rate + output * out_rate
    return {"cost_usd": round(cost, 6), "priced": True, "model": model,
            "billable_input_tokens": inp, "output_tokens": output}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_pricing.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/pricing.py squads/sdd/hooks/__tests__/test_pricing.py
git commit -m "feat(cost): cost_for_usage with cache-aware multipliers"
```

---

## Task 3: Transcript extraction (dedupe + per-model sum)

**Files:**
- Create: `squads/sdd/hooks/transcript_cost.py`
- Create: `squads/sdd/hooks/__tests__/test_transcript_cost.py`
- Create (fixture): `squads/sdd/hooks/__tests__/fixtures/sample_transcript.jsonl`

- [ ] **Step 1: Create the fixture transcript**

`squads/sdd/hooks/__tests__/fixtures/sample_transcript.jsonl` (note: `msg_a` is duplicated to prove dedupe; one user line and one no-usage line to prove they're ignored):

```
{"type":"user","timestamp":"2026-05-27T10:00:00Z","message":{"role":"user"}}
{"type":"assistant","timestamp":"2026-05-27T10:00:01Z","message":{"id":"msg_a","model":"m","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}
{"type":"assistant","timestamp":"2026-05-27T10:00:01Z","message":{"id":"msg_a","model":"m","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}
{"type":"assistant","timestamp":"2026-05-27T10:05:00Z","message":{"id":"msg_b","model":"m","usage":{"input_tokens":0,"output_tokens":0,"cache_read_input_tokens":100,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":0}}}}
```

- [ ] **Step 2: Write the failing test**

`squads/sdd/hooks/__tests__/test_transcript_cost.py`:

```python
import importlib.util
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("transcript_cost", str(_LIB / "transcript_cost.py"))
tc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tc)

PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}
FIXTURE = _DIR / "fixtures" / "sample_transcript.jsonl"


def test_dedupes_by_message_id():
    r = tc.extract_transcript_cost(FIXTURE, PRICES)
    # msg_a counted ONCE: 10*$1 + 5*$2 = 20 ; msg_b: 100 read *0.1*$1 = 10 ; total 30
    assert r["total_cost_usd"] == 30.0
    assert r["by_model"]["m"]["messages"] == 2


def test_missing_file_returns_zero_not_crash():
    r = tc.extract_transcript_cost(Path("/no/such/file.jsonl"), PRICES)
    assert r["total_cost_usd"] == 0.0
    assert r["error"] is not None


def test_unpriced_model_surfaces_in_report():
    r = tc.extract_transcript_cost(FIXTURE, {})  # no models priced
    assert "m" in r["unpriced_models"]
    assert r["total_cost_usd"] == 0.0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_transcript_cost.py -v`
Expected: FAIL — `transcript_cost.py` not found.

- [ ] **Step 4: Implement extraction**

`squads/sdd/hooks/transcript_cost.py`:

```python
"""Extract API-equivalent cost from one Claude Code JSONL transcript. Pure stdlib."""
import json
from pathlib import Path

from pricing import cost_for_usage  # same-dir import via spec loader in tests; see note below

_BUCKET_KEYS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


def _accumulate(agg, usage):
    for k in _BUCKET_KEYS:
        agg[k] = agg.get(k, 0) + usage.get(k, 0)
    cc = usage.get("cache_creation")
    if isinstance(cc, dict):
        agg["ephemeral_5m_input_tokens"] = agg.get("ephemeral_5m_input_tokens", 0) + cc.get("ephemeral_5m_input_tokens", 0)
        agg["ephemeral_1h_input_tokens"] = agg.get("ephemeral_1h_input_tokens", 0) + cc.get("ephemeral_1h_input_tokens", 0)


def extract_transcript_cost(path, prices, since=None, until=None):
    """Sum usage per model across UNIQUE assistant messages, then price.

    since/until: optional ISO8601 strings to bracket by top-level `timestamp`
    (used for phase attribution in the main-session capture).
    Returns {total_cost_usd, by_model:{model:{...buckets, cost_usd, messages}},
             unpriced_models:[...], error}.
    """
    path = Path(path)
    seen = set()
    per_model = {}
    counts = {}
    err = None
    try:
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    o = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if o.get("type") != "assistant":
                    continue
                ts = o.get("timestamp")
                if since and ts and ts < since:
                    continue
                if until and ts and ts > until:
                    continue
                m = o.get("message") or {}
                mid = m.get("id")
                usage = m.get("usage")
                if not mid or not isinstance(usage, dict) or mid in seen:
                    continue
                seen.add(mid)
                model = m.get("model", "unknown")
                _accumulate(per_model.setdefault(model, {}), usage)
                counts[model] = counts.get(model, 0) + 1
    except OSError as e:
        return {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": [], "error": str(e)}

    total = 0.0
    unpriced = []
    by_model = {}
    for model, buckets in per_model.items():
        priced = cost_for_usage(buckets, model, prices)
        entry = dict(buckets)
        entry["messages"] = counts[model]
        entry["cost_usd"] = priced["cost_usd"]
        if priced["priced"]:
            total += priced["cost_usd"]
        else:
            unpriced.append(model)
        by_model[model] = entry
    return {"total_cost_usd": round(total, 6), "by_model": by_model,
            "unpriced_models": unpriced, "error": err}
```

> **Import note:** the test loads `transcript_cost.py` via spec loader, which doesn't put `pricing` on `sys.path`. Make the import robust by inserting the lib dir on `sys.path` at the top of `transcript_cost.py` before `from pricing import cost_for_usage`:
> ```python
> import sys
> from pathlib import Path as _P
> sys.path.insert(0, str(_P(__file__).resolve().parent))
> ```

- [ ] **Step 5: Add the sys.path shim, then run tests**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_transcript_cost.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Smoke-test against a REAL transcript**

Run (sanity, not committed):
```bash
python3 -c "import sys; sys.path.insert(0,'squads/sdd/hooks'); import transcript_cost as t, pricing; import glob,os; f=max(glob.glob(os.path.expanduser('~/.claude/projects/-Users-gabrielandrade-Developer-ai-squad/*.jsonl')),key=os.path.getmtime); print(t.extract_transcript_cost(f, pricing.load_prices()))"
```
Expected: a plausible dollar figure with `unpriced_models: []`. If a model shows up unpriced, add it to `model_prices.json`.

- [ ] **Step 7: Commit**

```bash
git add squads/sdd/hooks/transcript_cost.py squads/sdd/hooks/__tests__/test_transcript_cost.py squads/sdd/hooks/__tests__/fixtures/sample_transcript.jsonl
git commit -m "feat(cost): transcript extraction with message-id dedupe"
```

---

## Task 4: `SubagentStop` capture hook (per-agent cost file)

**Files:**
- Create: `squads/sdd/hooks/capture-subagent-cost.py`
- Create: `squads/sdd/hooks/__tests__/test_capture_subagent_cost.py`

**Design:** the hook writes ONE file `.agent-session/<FEAT>/costs/agent-<agentId>.json`. It does NOT mutate the dispatch manifest (no lock contention — the failure mode that killed the old design). The report aggregator (Task 6) and audit reconciliation (Task 7) join these files. Idempotent (skip if the cost file already exists) and fail-open (any error → exit 0, never block a session).

- [ ] **Step 1: Write the failing test**

`squads/sdd/hooks/__tests__/test_capture_subagent_cost.py`:

```python
import importlib.util
import json
import os
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("capture_subagent_cost", str(_HOOKS / "capture-subagent-cost.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


def _make_transcript(p):
    p.write_text(
        '{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":'
        '{"id":"x","model":"m","usage":{"input_tokens":10,"output_tokens":5}}}\n'
    )


def test_writes_cost_file(tmp_path):
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    prices = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}

    out = mod.capture(agent_id="abc", transcript_path=str(tr),
                      session_dir=session_dir, prices=prices)

    f = session_dir / "costs" / "agent-abc.json"
    assert f.exists()
    data = json.loads(f.read_text())
    assert data["agent_id"] == "abc"
    assert data["total_cost_usd"] == 20.0
    assert out == 0


def test_idempotent_skip(tmp_path):
    tr = tmp_path / "agent-abc.jsonl"
    _make_transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    (session_dir / "costs").mkdir(parents=True)
    existing = session_dir / "costs" / "agent-abc.json"
    existing.write_text('{"agent_id":"abc","total_cost_usd":999.0}')
    prices = {"m": {"input_per_mtok": 1.0, "output_per_mtok": 1.0}}

    mod.capture(agent_id="abc", transcript_path=str(tr), session_dir=session_dir, prices=prices)
    assert json.loads(existing.read_text())["total_cost_usd"] == 999.0  # untouched


def test_missing_transcript_fails_open(tmp_path):
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    rc = mod.capture(agent_id="abc", transcript_path=str(tmp_path / "nope.jsonl"),
                     session_dir=session_dir, prices={})
    assert rc == 0  # never blocks
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_capture_subagent_cost.py -v`
Expected: FAIL — module/`capture` not defined.

- [ ] **Step 3: Implement the hook**

`squads/sdd/hooks/capture-subagent-cost.py`:

```python
#!/usr/bin/env python3
"""ai-squad SubagentStop hook — capture-subagent-cost.

Writes one cost file per subagent: .agent-session/<FEAT>/costs/agent-<agentId>.json
Filesystem-first: no manifest mutation, no lock. Idempotent + fail-open.
The audit-agent reconciles these against the subagent transcripts on disk.
"""
import glob
import json
import os
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
_SHARED_LIB = _HOOKS_DIR.parent.parent.parent / "shared" / "lib"
for _p in (str(_HOOKS_DIR), str(_SHARED_LIB)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pricing  # noqa: E402
import transcript_cost  # noqa: E402
from hook_runtime import resolve_project_root  # noqa: E402


def _find_active_session_dir(repo_root: Path) -> Path | None:
    """Newest .agent-session/<ID>/ that has a session.yml. Best-effort."""
    base = repo_root / ".agent-session"
    if not base.is_dir():
        return None
    candidates = [d for d in base.iterdir() if (d / "session.yml").exists()]
    if not candidates:
        return None
    return max(candidates, key=lambda d: d.stat().st_mtime)


def capture(agent_id, transcript_path, session_dir, prices):
    """Core logic (unit-testable). Returns process exit code (always 0)."""
    try:
        session_dir = Path(session_dir)
        out_dir = session_dir / "costs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = out_dir / f"agent-{agent_id}.json"
        if out_file.exists():  # idempotent
            return 0
        result = transcript_cost.extract_transcript_cost(transcript_path, prices)
        payload = {
            "agent_id": agent_id,
            "transcript_path": str(transcript_path),
            "scope": "implementation",
            **result,
        }
        tmp = out_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, out_file)  # atomic
    except Exception as e:  # fail-open — never block a session
        print(f"capture-subagent-cost: {e}", file=sys.stderr)
    return 0


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    agent_id = payload.get("agent_id") or "unknown"
    transcript_path = payload.get("agent_transcript_path")
    repo_root = resolve_project_root(payload)
    session_dir = _find_active_session_dir(Path(repo_root))
    if session_dir is None:
        return 0
    # Fallback: if payload lacks the path, glob the newest subagent transcript.
    if not transcript_path:
        hits = glob.glob(os.path.expanduser(f"~/.claude/projects/*/*/subagents/agent-{agent_id}.jsonl"))
        transcript_path = max(hits, key=os.path.getmtime) if hits else None
    if not transcript_path:
        return 0
    return capture(agent_id, transcript_path, session_dir, pricing.load_prices())


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_capture_subagent_cost.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/capture-subagent-cost.py squads/sdd/hooks/__tests__/test_capture_subagent_cost.py
git commit -m "feat(cost): SubagentStop hook writes per-agent cost file"
```

---

## Task 5: `Stop` capture hook (planning vs orchestration brackets)

**Files:**
- Create: `squads/sdd/hooks/capture-session-cost.py`
- Create: `squads/sdd/hooks/__tests__/test_capture_session_cost.py`

**Design:** on main-session Stop, parse the main transcript and split its cost by `phase_history` timestamps in `session.yml`: messages before `pipeline_started_at` → `planning`; at/after → `orchestration`. If `pipeline_started_at` is empty (planning-only session, the recommended-mode session 1), everything is `planning`. Writes `.agent-session/<FEAT>/costs/session-<sessionId>.json`. Fail-open.

- [ ] **Step 1: Write the failing test**

`squads/sdd/hooks/__tests__/test_capture_session_cost.py`:

```python
import importlib.util
import json
from pathlib import Path

_HOOKS = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("capture_session_cost", str(_HOOKS / "capture-session-cost.py"))
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)

PRICES = {"m": {"input_per_mtok": 1_000_000.0, "output_per_mtok": 2_000_000.0}}


def _transcript(p):
    lines = [
        '{"type":"assistant","timestamp":"2026-05-27T10:00:00Z","message":{"id":"plan1","model":"m","usage":{"input_tokens":10,"output_tokens":0}}}',
        '{"type":"assistant","timestamp":"2026-05-27T12:00:00Z","message":{"id":"impl1","model":"m","usage":{"input_tokens":20,"output_tokens":0}}}',
    ]
    p.write_text("\n".join(lines) + "\n")


def test_splits_by_pipeline_start(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    out = mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                      pipeline_started_at="2026-05-27T11:00:00Z", prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 10.0       # plan1 only
    assert data["orchestration"]["total_cost_usd"] == 20.0  # impl1 only
    assert out == 0


def test_no_pipeline_start_is_all_planning(tmp_path):
    tr = tmp_path / "sess.jsonl"
    _transcript(tr)
    session_dir = tmp_path / ".agent-session" / "FEAT-001"
    session_dir.mkdir(parents=True)
    mod.capture(session_id="sess", transcript_path=str(tr), session_dir=session_dir,
                pipeline_started_at=None, prices=PRICES)
    data = json.loads((session_dir / "costs" / "session-sess.json").read_text())
    assert data["planning"]["total_cost_usd"] == 30.0
    assert data["orchestration"]["total_cost_usd"] == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_capture_session_cost.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

`squads/sdd/hooks/capture-session-cost.py`:

```python
#!/usr/bin/env python3
"""ai-squad Stop hook — capture-session-cost.

Splits the main-session transcript cost into planning vs orchestration by the
pipeline start timestamp from session.yml, and writes
.agent-session/<FEAT>/costs/session-<sessionId>.json. Fail-open.
"""
import json
import os
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
_SHARED_LIB = _HOOKS_DIR.parent.parent.parent / "shared" / "lib"
for _p in (str(_HOOKS_DIR), str(_SHARED_LIB)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import pricing  # noqa: E402
import transcript_cost  # noqa: E402
from hook_runtime import resolve_project_root  # noqa: E402


def capture(session_id, transcript_path, session_dir, pipeline_started_at, prices):
    try:
        session_dir = Path(session_dir)
        out_dir = session_dir / "costs"
        out_dir.mkdir(parents=True, exist_ok=True)
        if pipeline_started_at:
            planning = transcript_cost.extract_transcript_cost(transcript_path, prices, until=pipeline_started_at)
            orchestration = transcript_cost.extract_transcript_cost(transcript_path, prices, since=pipeline_started_at)
        else:
            planning = transcript_cost.extract_transcript_cost(transcript_path, prices)
            orchestration = {"total_cost_usd": 0.0, "by_model": {}, "unpriced_models": [], "error": None}
        payload = {"session_id": session_id, "scope": "session",
                   "planning": planning, "orchestration": orchestration}
        out_file = out_dir / f"session-{session_id}.json"
        tmp = out_file.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        os.replace(tmp, out_file)
    except Exception as e:
        print(f"capture-session-cost: {e}", file=sys.stderr)
    return 0


def _read_pipeline_start(session_dir: Path):
    """Cheap YAML read without PyYAML — grep the single line."""
    sy = session_dir / "session.yml"
    if not sy.exists():
        return None
    for line in sy.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("pipeline_started_at:"):
            val = line.split(":", 1)[1].strip().strip('"').strip("'")
            return val or None
    return None


def _find_active_session_dir(repo_root: Path):
    base = repo_root / ".agent-session"
    if not base.is_dir():
        return None
    cands = [d for d in base.iterdir() if (d / "session.yml").exists()]
    return max(cands, key=lambda d: d.stat().st_mtime) if cands else None


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    session_id = payload.get("session_id") or "unknown"
    transcript_path = payload.get("transcript_path")
    if not transcript_path:
        return 0
    repo_root = Path(resolve_project_root(payload))
    session_dir = _find_active_session_dir(repo_root)
    if session_dir is None:
        return 0
    return capture(session_id, transcript_path, session_dir,
                   _read_pipeline_start(session_dir), pricing.load_prices())


if __name__ == "__main__":
    sys.exit(main())
```

> **Note on `transcript_path` in the Stop payload:** Claude Code's `Stop` hook payload includes the main-session `transcript_path` and `session_id`. Verify field names against the running version during implementation; if absent, glob `~/.claude/projects/<slug>/<session_id>.jsonl`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_capture_session_cost.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/capture-session-cost.py squads/sdd/hooks/__tests__/test_capture_session_cost.py
git commit -m "feat(cost): Stop hook splits session cost into planning/orchestration"
```

---

## Task 6: Report aggregator + CLI

**Files:**
- Create: `squads/sdd/hooks/cost_report.py`
- Create: `squads/sdd/hooks/__tests__/test_cost_report.py`
- Create: `squads/sdd/hooks/cost-report.py`

- [ ] **Step 1: Write the failing test**

`squads/sdd/hooks/__tests__/test_cost_report.py`:

```python
import importlib.util
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("cost_report", str(_LIB / "cost_report.py"))
cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cr)


def test_aggregates_planning_and_implementation(tmp_path):
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "session-s1.json").write_text(json.dumps({
        "scope": "session",
        "planning": {"total_cost_usd": 4.0, "unpriced_models": []},
        "orchestration": {"total_cost_usd": 1.0, "unpriced_models": []},
    }))
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 2.0, "agent_id": "a", "unpriced_models": []}))
    (costs / "agent-b.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 3.0, "agent_id": "b", "unpriced_models": []}))

    rep = cr.build_cost_report(tmp_path)
    assert rep["planning_cost_usd"] == 4.0
    assert rep["orchestration_cost_usd"] == 1.0
    assert rep["implementation_cost_usd"] == 5.0
    assert rep["total_cost_usd"] == 10.0
    assert rep["subagent_count"] == 2


def test_flags_unpriced_models(tmp_path):
    costs = tmp_path / "costs"
    costs.mkdir()
    (costs / "agent-a.json").write_text(json.dumps({
        "scope": "implementation", "total_cost_usd": 0.0, "agent_id": "a",
        "unpriced_models": ["mystery-model"]}))
    rep = cr.build_cost_report(tmp_path)
    assert "mystery-model" in rep["unpriced_models"]
    assert rep["complete"] is False


def test_markdown_renders(tmp_path):
    (tmp_path / "costs").mkdir()
    rep = cr.build_cost_report(tmp_path)
    md = cr.render_markdown(rep, "FEAT-001")
    assert "FEAT-001" in md
    assert "Total" in md
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement aggregator + renderer**

`squads/sdd/hooks/cost_report.py`:

```python
"""Aggregate per-agent + session cost files into one report. Pure stdlib."""
import json
from pathlib import Path


def build_cost_report(session_dir):
    session_dir = Path(session_dir)
    costs = session_dir / "costs"
    planning = orchestration = implementation = 0.0
    subagents = 0
    unpriced = set()
    if costs.is_dir():
        for f in sorted(costs.glob("*.json")):
            try:
                d = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            scope = d.get("scope")
            if scope == "session":
                planning += (d.get("planning") or {}).get("total_cost_usd") or 0.0
                orchestration += (d.get("orchestration") or {}).get("total_cost_usd") or 0.0
                for sub in ("planning", "orchestration"):
                    unpriced.update((d.get(sub) or {}).get("unpriced_models") or [])
            elif scope == "implementation":
                implementation += d.get("total_cost_usd") or 0.0
                subagents += 1
                unpriced.update(d.get("unpriced_models") or [])
    total = round(planning + orchestration + implementation, 6)
    return {
        "planning_cost_usd": round(planning, 6),
        "orchestration_cost_usd": round(orchestration, 6),
        "implementation_cost_usd": round(implementation, 6),
        "total_cost_usd": total,
        "subagent_count": subagents,
        "unpriced_models": sorted(unpriced),
        "complete": len(unpriced) == 0,
    }


def render_markdown(rep, task_id):
    lines = [
        f"## Cost report — {task_id}",
        "",
        "| Phase | Cost (USD) |",
        "|---|---|",
        f"| Planning (spec/design/tasks) | ${rep['planning_cost_usd']:.4f} |",
        f"| Orchestration (Phase 4 driver) | ${rep['orchestration_cost_usd']:.4f} |",
        f"| Implementation ({rep['subagent_count']} subagents) | ${rep['implementation_cost_usd']:.4f} |",
        f"| **Total** | **${rep['total_cost_usd']:.4f}** |",
    ]
    if not rep["complete"]:
        lines += ["", f"> ⚠️ Unpriced models (cost incomplete): {', '.join(rep['unpriced_models'])}"]
    return "\n".join(lines)
```

- [ ] **Step 4: Create the CLI**

`squads/sdd/hooks/cost-report.py`:

```python
#!/usr/bin/env python3
"""CLI: python3 squads/sdd/hooks/cost-report.py <FEAT-NNN> [--session-base .agent-session]
Writes <session_dir>/cost-report.json and prints the markdown table."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "shared" / "lib"))
import cost_report  # noqa: E402


def main(argv):
    if not argv:
        print("usage: cost-report.py <FEAT-NNN> [base_dir]", file=sys.stderr)
        return 2
    task_id = argv[0]
    base = Path(argv[1]) if len(argv) > 1 else Path(".agent-session")
    session_dir = base / task_id
    rep = cost_report.build_cost_report(session_dir)
    (session_dir / "cost-report.json").write_text(json.dumps(rep, indent=2), encoding="utf-8")
    print(cost_report.render_markdown(rep, task_id))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 5: Run tests + smoke the CLI**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py -v`
Expected: PASS (3 passed).

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/hooks/cost_report.py squads/sdd/hooks/__tests__/test_cost_report.py squads/sdd/hooks/cost-report.py
git commit -m "feat(cost): report aggregator + cost-report CLI"
```

---

## Task 7: Audit-agent reconciliation (the enforcement gate)

**Files:**
- Modify: `squads/sdd/agents/audit-agent.md` (add reconciliation check + backfill instruction)

**Goal:** make a missed capture a *visible, recoverable* fact. The audit-agent enumerates the subagent transcripts that physically exist for the session and verifies each has a cost file; for any gap it backfills via `transcript_cost`, and if it still can't, it emits a finding so the report is marked incomplete rather than silently undercounting.

- [ ] **Step 1: Read the current audit-agent checks**

Run: `grep -n "Check\|reconcil\|warnings.json\|Output Packet" squads/sdd/agents/audit-agent.md | head -40`
Confirm the existing 6-check structure and the `## Phase 4 sweep` section (where the cost rollup will be appended).

- [ ] **Step 2: Add the cost-capture reconciliation check**

Insert a new check after the existing manifest-vs-outputs reconciliation. Exact text to add (adapt heading numbering to match the file's existing scheme):

The audit-agent is **read-only** — it DETECTS and FLAGS gaps, it never writes cost files. Backfill + report emission are the orchestrator's job at handoff (write authority). This split keeps the verifier pure.

```markdown
## Phase 4 sweep — cost-capture completeness (read-only)

1. Count expected per-subagent cost files: `actual_dispatches[]` entries with role in
   {dev, code-reviewer, logic-reviewer, qa} that produced an Output Packet.
2. Count actual: `ls .agent-session/<task_id>/costs/agent-*.json | wc -l`.
3. If actual < expected (or costs/ absent), emit a finding
   `severity: warning, audit_finding_kind: cost_capture_incomplete`. NON-blocking —
   it does not fail the pipeline; it marks the cost report `complete: false`.

Principle: the on-disk subagent transcripts are ground truth; the SubagentStop hook
is the fast path, this count is the safety net. A miss surfaces as
cost_capture_incomplete, never as a silently low total.
```

- [ ] **Step 3: Wire backfill + report emission into the orchestrator handoff (write-capable)**

In `orchestrator/skill.md` step 9 (pipeline-end handoff), before emitting the handoff — the cost runtime is vendored in the per-repo hooks dir, so it resolves in any consumer repo:

```markdown
1. Backfill any missed capture (glob this session's subagent transcripts; import from .claude/hooks):
   python3 -c "import sys; sys.path.insert(0,'.claude/hooks'); import cost_report,pricing,glob,os; \
     print(cost_report.backfill_missing('.agent-session/<task_id>', \
       glob.glob(os.path.expanduser('~/.claude/projects/*/*/subagents/agent-*.jsonl')), pricing.load_prices()))"
2. Emit the report: python3 .claude/hooks/cost-report.py <task_id>  (writes .agent-session/<task_id>/cost-report.json)
3. Include the one-line total in the handoff; if complete=false, flag unpriced models / uncaptured agents.
```

- [ ] **Step 4: Verify the markdown is well-formed and references resolve**

Run: `grep -n "cost-report.py\|cost_capture_incomplete\|Check 7" squads/sdd/agents/audit-agent.md`
Expected: the new check and rollup are present and reference the real CLI path.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/agents/audit-agent.md
git commit -m "feat(cost): audit-agent reconciles cost capture against on-disk transcripts"
```

---

## Task 8: Schema cleanup (resolve the dangling `usage` contract)

**Files:**
- Modify: `shared/schemas/output-packet.schema.json`
- Modify: `shared/schemas/dispatch-manifest.schema.json`

**Context:** these schemas still describe the deleted `capture-subagent-usage.py` hook. The new design records cost in `costs/*.json` files, not in the Output Packet, so the `usage` field's description must be corrected (it stays nullable; the new capture is out-of-band).

- [ ] **Step 1: Fix the output-packet `usage` description**

In `shared/schemas/output-packet.schema.json`, find the `usage` property (~line 347). Replace the description:

- Old: `"Per-dispatch token usage, populated by capture-subagent-usage.py Stop hook. Required for all roles except pm-orchestrator. Set to null when emitting; hook fills it in."`
- New: `"Reserved. Per-dispatch cost is captured out-of-band into .agent-session/<task_id>/costs/agent-<agentId>.json by the capture-subagent-cost.py SubagentStop hook; this field stays null. Kept for backward compatibility."`

- [ ] **Step 2: Fix the dispatch-manifest `usage` + provenance references**

In `shared/schemas/dispatch-manifest.schema.json`:
- Line ~168: replace `"Optional: per-dispatch token usage captured by capture-subagent-usage.py Stop hook"` with `"Optional. Cost is recorded out-of-band in costs/agent-<agentId>.json; see capture-subagent-cost.py."`
- Lines ~331-337: the `source` enum description mentioning `platform_captured | self_reported` and `pm_handoff.json` — update to describe the cost-file mechanism, or remove the `source` sub-field if it is no longer referenced by any consumer. Grep first: `grep -rn "platform_captured\|self_reported" squads shared .claude --include=*.py --include=*.md`. Only remove if there are zero live consumers.

- [ ] **Step 3: Verify schemas still parse + tests pass**

Run:
```bash
python3 -c "import json; json.load(open('shared/schemas/output-packet.schema.json')); json.load(open('shared/schemas/dispatch-manifest.schema.json')); print('ok')"
python3 -m pytest squads/sdd/hooks/__tests__ squads/sdd/hooks/__tests__ -q
```
Expected: `ok` + all tests pass (no test asserts the old description text).

- [ ] **Step 4: Commit**

```bash
git add shared/schemas/output-packet.schema.json shared/schemas/dispatch-manifest.schema.json
git commit -m "fix(schema): replace dead capture-subagent-usage refs with cost-file mechanism"
```

---

## Task 9: Hook registration + component sync + deploy verification

**Files:**
- Modify: `squads/sdd/hooks/claude-hooks.json`
- Modify: `squads/sdd/hooks/cursor-hooks.json`
- Verify: `packages/cli/components/**` (regenerated by sync)

- [ ] **Step 1: Register `capture-subagent-cost` on SubagentStop**

In `squads/sdd/hooks/claude-hooks.json`, in the existing `SubagentStop` array (which already holds `verify-output-packet.py`), add a second hook entry mirroring the fail-open guard pattern:

```json
{
  "type": "command",
  "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-subagent-cost.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-subagent-cost.py\""
}
```

- [ ] **Step 2: Register `capture-session-cost` on Stop**

In the same file's `Stop` array (which holds `verify-pm-handoff-clean.py` + `verify-audit-dispatch.py`), add:

```json
{
  "type": "command",
  "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-session-cost.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-session-cost.py\""
}
```

- [ ] **Step 3: Mirror both into `cursor-hooks.json`**

Open `squads/sdd/hooks/cursor-hooks.json`, find the equivalent SubagentStop/Stop sections, and add the same two commands in Cursor's format (match the existing entries' shape in that file).

- [ ] **Step 4: Sync components + run full suite**

Run:
```bash
cd packages/cli && npm run sync && cd ../..
git diff --stat packages/cli/components | head
python3 -m pytest squads/sdd/hooks/__tests__ squads/sdd/hooks/__tests__ .claude/hooks/__tests__ -q
```
Expected: components show the two new hook files synced; all tests pass.

- [ ] **Step 5: End-to-end smoke (manual, recommended-mode shape)**

In a throwaway consumer repo (NOT this one), `ai-squad deploy`, run a minimal `/spec-writer` session through to a paused state, then `--resume` a Phase 4. Confirm `.agent-session/<FEAT>/costs/` fills with `session-*.json` + `agent-*.json`, that `report.html` is written at session end, and that `python3 .claude/hooks/cost-report.py <FEAT>` prints a populated table. Document the observed numbers in the commit body.

- [ ] **Step 6: Commit + bump CLI**

```bash
git add squads/sdd/hooks/claude-hooks.json squads/sdd/hooks/cursor-hooks.json packages/cli/components
# bump packages/cli/package.json version (minor) per repo convention, then:
git add packages/cli/package.json
git commit -m "feat(cost): register capture hooks + sync components"
```

---

## Self-review checklist (run before declaring done)

1. **Planning cost** — Task 5 captures it; recommended-mode session 1 = all planning (no `pipeline_started_at`). ✅
2. **Orchestration ("PM thinking") cost** — Task 5 brackets it after `pipeline_started_at`; recommended-mode session 2 isolates it. ✅
3. **Per-subagent implementation cost** — Task 4 writes one file per subagent. ✅
4. **API-equivalent accuracy w/ cache** — Task 2 formula prices all five buckets with correct multipliers; Task 3 dedupes by `message.id`. ✅
5. **No silent loss (enforce capture)** — Task 7 reconciles against on-disk transcripts; gaps backfill or surface as `cost_capture_incomplete`. ✅
6. **Autonomous mode degrades gracefully** — single-session split by timestamp, labeled approximate via the same Task 5 bracketing. ✅
7. **Dangling-schema debt** — Task 8 resolves the turn-1 findings. ✅
8. **Project-agnostic** — no OTEL/infra dependency; pure stdlib. ✅

## Open items to confirm during execution (not blockers, but verify)
- Exact field names in the `SubagentStop` payload (`agent_id`, `agent_transcript_path`) and `Stop` payload (`session_id`, `transcript_path`) on the running Claude Code version. Fallback globs are coded, but prefer the payload.
- Real per-model rates in `model_prices.json` from the official pricing page (Task 1).
- Whether `dispatch-manifest.schema.json`'s `source`/`platform_captured` sub-field has any live consumer before removing it (Task 8 Step 2).
```
