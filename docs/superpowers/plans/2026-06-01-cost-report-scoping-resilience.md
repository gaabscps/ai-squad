# Cost-report Scoping Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `cost-report` from silently zeroing the implementation cost when scoping excludes every subagent — fix the root timing race, detect over-exclusion, and recover or alarm loudly.

**Architecture:** Three layers. (1) Root fix: the orchestrator's implementation-session id is registered at the *first dispatch* (`PreToolUse(Task)`) instead of at session `Stop`, so the authoritative allow-list exists before the cost report is generated. (2) Detection: a sanity floor in `build_cost_report` trips when the report kept 0 subagents but excluded N>0. (3) Reaction: when tripped, attempt a safe recovery (single dominant parent cluster + a `dispatch-manifest.json` count witness); if recovery is ambiguous, mark the report `scoping_suspect` and render a loud WARNING instead of presenting `$0` as valid.

**Tech Stack:** Python 3.8+ stdlib only (no PyYAML), pytest. Hook wiring in `claude-hooks.json` / `cursor-hooks.json`. The framework is NOT dogfooded on this repo — edits here are manual (Read/Edit/Write), executed with TDD + pytest.

---

## Background context (read before starting)

The bug, confirmed from a real run (`ai-squad-os` FEAT-001): the cost report ran at handoff time, **before** the orchestrator session's own `Stop` hooks fired. Those `Stop` hooks (`capture-session-cost`, `register-impl-session`) write the orchestrator session's provenance markers. So at report time the orchestrator session was invisible to both scoping mechanisms — the authoritative allow-list (`implementation_sessions:` in `session.yml`, absent) and the disk-cross-validation fallback (`present_sessions`, which lacked the orchestrator's own session id). All 66 implementation subagents were excluded; `implementation_cost_usd` and `orchestration_cost_usd` both went to `$0`; the report showed `$6.55` when the true total was `~$57.62`. Design doc: [`docs/superpowers/specs/2026-06-01-cost-report-scoping-resilience-design.md`](../specs/2026-06-01-cost-report-scoping-resilience-design.md).

**Key files:**
- Canonical source (the ONLY place to edit): `squads/sdd/hooks/`
- Tests: `squads/sdd/hooks/__tests__/`

> **CORRECTION (discovered during execution):** `packages/cli/components/` is **gitignored and auto-generated** by `packages/cli/scripts/sync-components.mjs` (runs on `prepack`/publish, copying `squads/` → `components/`). It must NEVER be edited by hand or committed. **Every "Sync ... / cp ... components" step and any `git add ...packages/cli/components...` below is superseded — skip them.** Edit only `squads/sdd/...`; the publish step regenerates the bundle. The packaged copy verification in Task 5 is likewise unnecessary.

**Run tests with:** `python3 -m pytest squads/sdd/hooks/__tests__/ -q` (run from repo root).

**Invariants you must NOT break:**
- GAP A (cli 0.9.0): read-scoping must never inflate the total with contamination from another project/feature. Recovery only re-includes the dominant local cluster, gated by the manifest — never indiscriminate.
- Project-agnostic: no project names, local conventions, or other repos' skills in any code.
- `total_cost_usd` stays a number (the aiOS cost observer sums it); when scoping is suspect, signal via the `scoping_suspect` flag + markdown WARNING, do NOT null the numeric fields.

---

## Task 1: Root fix — register the implementation session at first dispatch

**Files:**
- Modify: `squads/sdd/hooks/register-impl-session.py` (remove the manifest gate; update docstring)
- Modify: `squads/sdd/hooks/__tests__/test_register_impl_session.py` (replace the no-manifest skip test)
- Modify: `squads/sdd/hooks/claude-hooks.json` (move `register-impl-session` from `Stop` to `PreToolUse`/`Task`)
- Sync: `packages/cli/components/sdd/hooks/register-impl-session.py`, `packages/cli/components/sdd/hooks/claude-hooks.json`

- [ ] **Step 1: Replace the failing no-manifest test**

In `squads/sdd/hooks/__tests__/test_register_impl_session.py`, DELETE `test_main_skips_without_manifest` (lines 81-89) and replace it with this test. At `PreToolUse(Task)` the dispatch itself is the signal a pipeline is running, so registration must happen even before `dispatch-manifest.json` exists:

```python
def test_main_registers_without_manifest(tmp_path, monkeypatch):
    # At PreToolUse(Task) the dispatch IS the signal a pipeline is running —
    # the manifest may not exist on the first dispatch. Register anyway.
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "orchestrator", tmp_path)
    assert ris.main() == 0
    assert '- "AAA"' in (sd / "session.yml").read_text()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_register_impl_session.py::test_main_registers_without_manifest -v`
Expected: FAIL — the current `main()` returns 0 without registering because `dispatch-manifest.json` is absent (the gate at lines 88-89), so `'- "AAA"'` is not in `session.yml`.

- [ ] **Step 3: Remove the manifest gate in `main()`**

In `squads/sdd/hooks/register-impl-session.py`, DELETE these lines from `main()` (currently lines 86-89):

```python
    # Only register when a Phase 4 pipeline actually ran (manifest present) —
    # an orchestrator session that dispatched nothing has no subagents to scope.
    if not (session_dir / "dispatch-manifest.json").exists():
        return 0
```

- [ ] **Step 4: Update the module docstring to reflect the new trigger**

In `squads/sdd/hooks/register-impl-session.py`, REPLACE the docstring (lines 2-21) with:

```python
"""ai-squad PreToolUse(Task) hook — register-impl-session.

Wired (Claude Code) under PreToolUse with matcher `Task`. Fires on each Task
dispatch from an orchestrator session and records that session's own id (from
the hook payload — therefore trustworthy, never an mtime guess) into
`implementation_sessions:` in the active feature's session.yml.

Why at first-dispatch, not at Stop: build_cost_report scopes which subagents
belong to a feature by their parent session id, and the cost report is emitted
at handoff time — BEFORE the session ends. Registering at Stop wrote this
provenance too late (the report had already run and excluded every subagent —
the FEAT-001 "$0 implementation" bug). PreToolUse(Task) fires before the first
dispatch, so the allow-list exists before the report. See
cost_report._read_implementation_sessions.

Skill-scope gated to `orchestrator` (the only authoritative source of the
implementation session id) and idempotent + accumulative: each orchestrator
session that dispatches registers its own id once; a --resume run adds the
resumed session too, so no dispatching session is ever orphaned.

Fail-open: never blocks the dispatch. Pure stdlib.
"""
```

- [ ] **Step 5: Run the register-impl-session tests to verify they pass**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_register_impl_session.py -v`
Expected: PASS — all tests, including the new `test_main_registers_without_manifest`. (`test_main_registers_on_orchestrator_stop` and `test_main_skips_when_not_orchestrator` still pass: they create a manifest but the code no longer checks for it, and the orchestrator-skill gate is unchanged.)

- [ ] **Step 6: Re-wire `claude-hooks.json` — move register-impl-session to PreToolUse(Task)**

In `squads/sdd/hooks/claude-hooks.json`:

(a) DELETE this entry from the `Stop` array (currently lines 64-67):

```json
          {
            "type": "command",
            "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py\""
          },
```

(b) ADD it to the existing `PreToolUse` block whose `"matcher": "Task"` (currently lines 36-50), as a new entry in that block's `hooks` array, after `verify-pipeline-completeness.py`:

```json
          {
            "type": "command",
            "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/register-impl-session.py\"",
            "timeout": 5
          }
```

Leave `cursor-hooks.json` unchanged: Cursor has no `Task` matcher under `preToolUse`, so `register-impl-session` stays on `stop` there (best-effort; the detection+recovery layers in Tasks 2-3 cover any residual under-count).

- [ ] **Step 7: Verify the JSON wiring is correct**

Run:
```bash
python3 -c "
import json
h = json.load(open('squads/sdd/hooks/claude-hooks.json'))
stop = json.dumps(h['hooks']['Stop'])
assert 'register-impl-session' not in stop, 'still in Stop'
task = next(b for b in h['hooks']['PreToolUse'] if b.get('matcher') == 'Task')
cmds = ' '.join(x['command'] for x in task['hooks'])
assert 'register-impl-session' in cmds, 'not in PreToolUse(Task)'
print('OK: register-impl-session is under PreToolUse(Task), not Stop')
"
```
Expected: `OK: register-impl-session is under PreToolUse(Task), not Stop`

- [ ] **Step 8: Sync the deployed template copies**

Run:
```bash
cp squads/sdd/hooks/register-impl-session.py packages/cli/components/sdd/hooks/register-impl-session.py
cp squads/sdd/hooks/claude-hooks.json packages/cli/components/sdd/hooks/claude-hooks.json
diff -q squads/sdd/hooks/register-impl-session.py packages/cli/components/sdd/hooks/register-impl-session.py
diff -q squads/sdd/hooks/claude-hooks.json packages/cli/components/sdd/hooks/claude-hooks.json
```
Expected: both `diff -q` print nothing (files identical).

- [ ] **Step 9: Commit**

```bash
git add squads/sdd/hooks/register-impl-session.py squads/sdd/hooks/__tests__/test_register_impl_session.py squads/sdd/hooks/claude-hooks.json packages/cli/components/sdd/hooks/register-impl-session.py packages/cli/components/sdd/hooks/claude-hooks.json
git commit -m "fix(cost): register impl session at first dispatch, not at Stop (Spec B root)"
```

---

## Task 2: Detection + fail-loud — sanity floor and scoping_suspect

**Files:**
- Modify: `squads/sdd/hooks/cost_report.py` (`build_cost_report`: collect excluded records, add `scoping_suspect`; `render_markdown`: WARNING + "unknown" cell)
- Modify: `squads/sdd/hooks/__tests__/test_cost_report.py` (new tests)
- Sync: `packages/cli/components/sdd/hooks/cost_report.py`

- [ ] **Step 1: Write the failing detection test**

Add to `squads/sdd/hooks/__tests__/test_cost_report.py` (the `_agent(aid, parent, cost)` helper already exists at line 288):

```python
# --- Spec B: scoping resilience -------------------------------------------------

def test_scoping_suspect_when_all_excluded_and_no_manifest(tmp_path):
    # The FEAT-001 shape: an allow-list/present-set that matches nothing, so
    # every implementation agent is excluded and 0 are kept. With NO manifest to
    # witness a real run, the report must NOT present $0 as valid — it flags
    # scoping_suspect and stays incomplete.
    (tmp_path / "session.yml").write_text(
        'id: FEAT-001\nimplementation_sessions:\n  - "WRONG"\n')
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-a.json").write_text(_agent("a", "REAL", 2.0))
    (costs / "agent-b.json").write_text(_agent("b", "REAL", 3.0))
    rep = cr.build_cost_report(tmp_path)
    assert rep["subagent_count"] == 0
    assert rep["excluded_subagents"] == 2
    assert rep["scoping_suspect"] is True
    assert rep["complete"] is False
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py::test_scoping_suspect_when_all_excluded_and_no_manifest -v`
Expected: FAIL with `KeyError: 'scoping_suspect'` (the report dict has no such key yet).

- [ ] **Step 3: Collect excluded records in `build_cost_report`**

In `squads/sdd/hooks/cost_report.py`, in `build_cost_report`, REPLACE the counter init (currently line 184 `excluded = 0`) with:

```python
    excluded_records = []  # (parent_session, cost_obj) for each out-of-scope agent
```

Then REPLACE the implementation-scope exclusion branch (currently lines 271-275):

```python
            elif scope == "implementation":
                if not _agent_in_scope(_parent_session(d.get("transcript_path")),
                                       allowed_sessions, present_sessions):
                    excluded += 1
                    continue
```

with:

```python
            elif scope == "implementation":
                parent = _parent_session(d.get("transcript_path"))
                if not _agent_in_scope(parent, allowed_sessions, present_sessions):
                    excluded_records.append((parent, d))
                    continue
```

- [ ] **Step 4: Add the sanity floor + scoping_suspect after the loop**

In `squads/sdd/hooks/cost_report.py`, immediately AFTER the `if costs.is_dir():` scan loop ends and BEFORE the line `total = round(planning + orchestration + implementation, 6)` (currently line 281), INSERT:

```python
    # Sanity floor (Spec B): if scoping kept 0 subagents but excluded some, the
    # allow-list/fallback is broken (e.g. the report ran before the orchestrator
    # session's provenance was written), NOT contamination — contamination always
    # leaves some legit agents standing. Never present $0 as valid here.
    recovered = 0
    scoping_suspect = False
    if subagents == 0 and excluded_records:
        scoping_suspect = True  # recovery is added in Task 3
    excluded = len(excluded_records)
```

- [ ] **Step 5: Surface the new fields in the report dict**

In `squads/sdd/hooks/cost_report.py`, in the returned dict, ADD two keys right after the `"excluded_subagents": excluded,` line (currently line 299):

```python
        # Implementation subagents recovered after the sanity floor tripped
        # (Spec B); 0 in the normal path.
        "recovered_subagents": recovered,
        # True when scoping kept 0 subagents but excluded some AND recovery was
        # not safe — the implementation cost is NOT trustworthy. Consumers must
        # not treat the total as final when this is set.
        "scoping_suspect": scoping_suspect,
```

- [ ] **Step 6: Run the detection test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py::test_scoping_suspect_when_all_excluded_and_no_manifest -v`
Expected: PASS.

- [ ] **Step 7: Write the failing render test**

Add to `squads/sdd/hooks/__tests__/test_cost_report.py`:

```python
def test_markdown_warns_and_hides_zero_when_scoping_suspect(tmp_path):
    (tmp_path / "session.yml").write_text(
        'id: FEAT-001\nimplementation_sessions:\n  - "WRONG"\n')
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-a.json").write_text(_agent("a", "REAL", 2.0))
    rep = cr.build_cost_report(tmp_path)
    md = cr.render_markdown(rep, "FEAT-001")
    assert "SCOPING" in md.upper()           # a loud warning line exists
    assert "unknown" in md.lower()           # implementation cell is not a bare $0.0000
```

- [ ] **Step 8: Run the render test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py::test_markdown_warns_and_hides_zero_when_scoping_suspect -v`
Expected: FAIL — `render_markdown` currently always prints the `$0.0000` implementation cell and has no scoping warning.

- [ ] **Step 9: Update `render_markdown`**

In `squads/sdd/hooks/cost_report.py`, in `render_markdown`, FIRST insert a computed cell variable on the line immediately before `lines = [` (currently line 316). A nested f-string with escaped quotes would be a SyntaxError on Python < 3.12, so compute it separately:

```python
    impl_cell = "unknown" if rep.get("scoping_suspect") else f"${rep['implementation_cost_usd']:.4f}"
```

THEN REPLACE the implementation row line (currently line 323):

```python
        f"| Implementation ({rep['subagent_count']} subagents) | ${rep['implementation_cost_usd']:.4f} | {fmt_tokens(rep['tokens']['by_phase']['implementation']['total'])} |",
```

with:

```python
        f"| Implementation ({rep['subagent_count']} subagents) | {impl_cell} | {fmt_tokens(rep['tokens']['by_phase']['implementation']['total'])} |",
```

THEN ADD a warning block right after the `if not rep["complete"]:` block (currently lines 326-327) and before the `excluded_subagents` NOTE:

```python
    if rep.get("scoping_suspect"):
        lines += ["", "> **WARNING — SCOPING BROKEN:** kept 0 implementation subagents "
                      f"but excluded {rep['excluded_subagents']} cost file(s) present on disk. "
                      "The implementation cost is NOT trustworthy — do not treat this total "
                      "as final. See the Spec B design doc."]
    if rep.get("recovered_subagents"):
        lines += ["", f"> NOTE: Recovered {rep['recovered_subagents']} implementation "
                      "subagent(s) after the scoping sanity floor tripped "
                      "(dominant cluster + manifest witness)."]
```

- [ ] **Step 10: Run the render test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py::test_markdown_warns_and_hides_zero_when_scoping_suspect -v`
Expected: PASS.

- [ ] **Step 11: Run the full cost_report suite (no regressions)**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py -q`
Expected: all PASS. In particular the existing GAP A tests (`test_read_scoping_*`) still pass: they keep ≥1 subagent, so the floor never trips and `scoping_suspect` stays `False`.

- [ ] **Step 12: Sync and commit**

```bash
cp squads/sdd/hooks/cost_report.py packages/cli/components/sdd/hooks/cost_report.py
diff -q squads/sdd/hooks/cost_report.py packages/cli/components/sdd/hooks/cost_report.py
git add squads/sdd/hooks/cost_report.py squads/sdd/hooks/__tests__/test_cost_report.py packages/cli/components/sdd/hooks/cost_report.py
git commit -m "feat(cost): sanity floor + scoping_suspect when report excludes all subagents (Spec B detect)"
```

---

## Task 3: Recovery — dominant cluster + manifest witness (Option A)

**Files:**
- Modify: `squads/sdd/hooks/cost_report.py` (add `_attempt_scope_recovery`; wire it into the floor)
- Modify: `squads/sdd/hooks/__tests__/test_cost_report.py` (recover / ambiguous / GAP-A-still-excluded tests)
- Sync: `packages/cli/components/sdd/hooks/cost_report.py`

- [ ] **Step 1: Write the failing recovery test**

Add to `squads/sdd/hooks/__tests__/test_cost_report.py`. Helper to write a manifest with N dispatches:

```python
def _manifest(n):
    return json.dumps({"schema_version": 1, "spec_id": "FEAT-001",
                       "actual_dispatches": [{"dispatch_id": f"d{i}"} for i in range(n)]})


def test_recovers_dominant_cluster_with_manifest_witness(tmp_path):
    # FEAT-001 shape: allow-list matches nothing → all excluded, 0 kept. A
    # manifest witnesses 3 real dispatches and the excluded agents share ONE
    # dominant parent → safe to recover that cluster.
    (tmp_path / "session.yml").write_text(
        'id: FEAT-001\nimplementation_sessions:\n  - "WRONG"\n')
    (tmp_path / "dispatch-manifest.json").write_text(_manifest(3))
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-a.json").write_text(_agent("a", "REAL", 2.0))
    (costs / "agent-b.json").write_text(_agent("b", "REAL", 3.0))
    (costs / "agent-c.json").write_text(_agent("c", "REAL", 1.0))
    rep = cr.build_cost_report(tmp_path)
    assert rep["scoping_suspect"] is False
    assert rep["recovered_subagents"] == 3
    assert rep["subagent_count"] == 3
    assert rep["implementation_cost_usd"] == 6.0
    assert rep["excluded_subagents"] == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py::test_recovers_dominant_cluster_with_manifest_witness -v`
Expected: FAIL — Task 2 only sets `scoping_suspect=True`; nothing is recovered, so `recovered_subagents == 0` and `subagent_count == 0`.

- [ ] **Step 3: Add the `_attempt_scope_recovery` helper**

In `squads/sdd/hooks/cost_report.py`, ADD this function right after `_agent_in_scope` (after its closing line, currently line 140):

```python
def _attempt_scope_recovery(excluded_records, session_dir):
    """Decide which excluded implementation agents are safe to recover.

    Called only when the sanity floor tripped (kept 0 subagents, excluded N>0) —
    a broken allow-list/timing race, not contamination. Returns the list of
    (parent, cost_obj) records to re-include, or [] to fail loud.

    Safe to recover (Option A — dual confirmation) iff:
      - dispatch-manifest.json witnesses a real run here: a non-empty
        actual_dispatches list of length M; and
      - the excluded agents are dominated by a SINGLE parent session (the
        signature of one orchestrator run, not heterogeneous contamination):
        the largest by-parent cluster covers >= half of the excluded agents; and
      - the excluded count N is the same order of magnitude as M (N <= 2*M) —
        a 2804-vs-64 pile is contamination, not this run.
    Only the dominant cluster is recovered (stragglers stay excluded — the
    conservative choice; legitimate multi-session resumes are already handled at
    the root by PreToolUse(Task) registration). The 0.5 / 2x thresholds are v1
    and tunable; see the Spec B design doc, edge case 3.
    """
    n = len(excluded_records)
    try:
        manifest = json.loads(
            (Path(session_dir) / "dispatch-manifest.json").read_text(encoding="utf-8"))
        m = len(manifest.get("actual_dispatches") or [])
    except (OSError, json.JSONDecodeError, AttributeError, TypeError):
        m = 0
    if m < 1 or n > 2 * m:
        return []
    by_parent = {}
    for parent, d in excluded_records:
        by_parent.setdefault(parent, []).append((parent, d))
    _, dominant = max(by_parent.items(), key=lambda kv: len(kv[1]))
    if len(dominant) < 0.5 * n:
        return []
    return dominant
```

- [ ] **Step 4: Wire recovery into the sanity floor**

In `squads/sdd/hooks/cost_report.py`, REPLACE the floor block added in Task 2 (the `if subagents == 0 and excluded_records:` block):

```python
    recovered = 0
    scoping_suspect = False
    if subagents == 0 and excluded_records:
        scoping_suspect = True  # recovery is added in Task 3
    excluded = len(excluded_records)
```

with:

```python
    recovered = 0
    scoping_suspect = False
    if subagents == 0 and excluded_records:
        to_recover = _attempt_scope_recovery(excluded_records, session_dir)
        if to_recover:
            recover_keys = {id(d) for _, d in to_recover}
            for _parent, d in to_recover:
                ic, iu = _phase_cost(d)
                implementation += ic
                unpriced |= iu
                subagents += 1
                _absorb(d.get("by_model"), "implementation")
            recovered = len(to_recover)
            excluded_records = [r for r in excluded_records if id(r[1]) not in recover_keys]
        else:
            scoping_suspect = True
    excluded = len(excluded_records)
```

- [ ] **Step 5: Run the recovery test to verify it passes**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py::test_recovers_dominant_cluster_with_manifest_witness -v`
Expected: PASS.

- [ ] **Step 6: Write the ambiguity + GAP-A-protection tests**

Add to `squads/sdd/hooks/__tests__/test_cost_report.py`:

```python
def test_fails_loud_when_excluded_count_dwarfs_manifest(tmp_path):
    # A huge pile relative to what the run declared (the 2804-vs-64 shape) is
    # contamination, not this run — do NOT recover; stay scoping_suspect.
    (tmp_path / "session.yml").write_text(
        'id: FEAT-001\nimplementation_sessions:\n  - "WRONG"\n')
    (tmp_path / "dispatch-manifest.json").write_text(_manifest(1))  # M=1
    costs = tmp_path / "costs"; costs.mkdir()
    for i in range(6):  # N=6 > 2*M
        (costs / f"agent-{i}.json").write_text(_agent(str(i), "REAL", 1.0))
    rep = cr.build_cost_report(tmp_path)
    assert rep["scoping_suspect"] is True
    assert rep["recovered_subagents"] == 0
    assert rep["subagent_count"] == 0


def test_fails_loud_when_no_dominant_cluster(tmp_path):
    # Excluded agents spread across many parents with no clear dominant (<50%)
    # look like heterogeneous contamination → ambiguous → fail loud.
    (tmp_path / "session.yml").write_text(
        'id: FEAT-001\nimplementation_sessions:\n  - "WRONG"\n')
    (tmp_path / "dispatch-manifest.json").write_text(_manifest(4))
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-a.json").write_text(_agent("a", "P1", 1.0))
    (costs / "agent-b.json").write_text(_agent("b", "P2", 1.0))
    (costs / "agent-c.json").write_text(_agent("c", "P3", 1.0))
    (costs / "agent-d.json").write_text(_agent("d", "P4", 1.0))
    rep = cr.build_cost_report(tmp_path)
    assert rep["scoping_suspect"] is True
    assert rep["recovered_subagents"] == 0


def test_gap_a_minority_contamination_still_excluded(tmp_path):
    # Recovery must NOT reopen GAP A: when some legit agents ARE kept (count>0),
    # the floor never trips, so minority foreign contamination stays excluded.
    (tmp_path / "session.yml").write_text(
        'id: FEAT-001\nimplementation_sessions:\n  - "AAA"\n')
    (tmp_path / "dispatch-manifest.json").write_text(_manifest(1))
    costs = tmp_path / "costs"; costs.mkdir()
    (costs / "agent-mine.json").write_text(_agent("mine", "AAA", 2.0))
    (costs / "agent-foreign.json").write_text(_agent("foreign", "BBB", 99.0))
    rep = cr.build_cost_report(tmp_path)
    assert rep["subagent_count"] == 1
    assert rep["implementation_cost_usd"] == 2.0
    assert rep["excluded_subagents"] == 1
    assert rep["scoping_suspect"] is False
    assert rep["recovered_subagents"] == 0
```

- [ ] **Step 7: Run the new tests to verify they pass**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py -k "fails_loud or gap_a_minority or recovers_dominant" -v`
Expected: all PASS.

- [ ] **Step 8: Run the full cost_report suite (no regressions)**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_cost_report.py -q`
Expected: all PASS.

- [ ] **Step 9: Sync and commit**

```bash
cp squads/sdd/hooks/cost_report.py packages/cli/components/sdd/hooks/cost_report.py
diff -q squads/sdd/hooks/cost_report.py packages/cli/components/sdd/hooks/cost_report.py
git add squads/sdd/hooks/cost_report.py squads/sdd/hooks/__tests__/test_cost_report.py packages/cli/components/sdd/hooks/cost_report.py
git commit -m "feat(cost): safe recovery via dominant cluster + manifest witness (Spec B react)"
```

---

## Task 4: Orchestrator handoff — do not claim a cost when scoping is suspect

**Files:**
- Modify: `squads/sdd/skills/orchestrator/skill.md` (step 9 cost-report instruction)
- Sync: `packages/cli/components/sdd/skills/orchestrator/skill.md` (if a packaged copy exists — verify first)

- [ ] **Step 1: Update step 9 to mention scoping_suspect**

In `squads/sdd/skills/orchestrator/skill.md`, REPLACE the last sentence of the step-9 cost-report bullet (currently line 198, the sentence beginning "Include the one-line total in the handoff;") with:

```markdown
  Include the one-line total in the handoff; if the audit raised `cost_capture_incomplete`, OR the report's `complete` is false, OR the report's `scoping_suspect` is true, flag the gap explicitly and do NOT present the total (or the implementation figure) as final — when `scoping_suspect` is true the implementation cost was excluded wholesale and is untrustworthy.
```

- [ ] **Step 2: Verify whether a packaged copy of skill.md exists and sync it**

Run:
```bash
F=packages/cli/components/sdd/skills/orchestrator/skill.md
if [ -f "$F" ]; then cp squads/sdd/skills/orchestrator/skill.md "$F"; diff -q squads/sdd/skills/orchestrator/skill.md "$F"; else echo "no packaged copy — nothing to sync"; fi
```
Expected: either `diff -q` prints nothing (synced), or "no packaged copy — nothing to sync".

- [ ] **Step 3: Commit**

```bash
git add squads/sdd/skills/orchestrator/skill.md
git add packages/cli/components/sdd/skills/orchestrator/skill.md 2>/dev/null || true
git commit -m "docs(orchestrator): flag scoping_suspect in handoff cost report (Spec B)"
```

---

## Task 5: Final verification

- [ ] **Step 1: Run the entire hook test suite**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/ -q`
Expected: all PASS, no errors.

- [ ] **Step 2: Confirm source ↔ deployed-template parity for every file this plan touched**

Run:
```bash
for f in register-impl-session.py claude-hooks.json cost_report.py; do
  diff -q "squads/sdd/hooks/$f" "packages/cli/components/sdd/hooks/$f" && echo "OK $f" || echo "DRIFT $f"
done
```
Expected: `OK register-impl-session.py`, `OK claude-hooks.json`, `OK cost_report.py`.

- [ ] **Step 3: Sanity-check the rebuilt report against the real run that exposed the bug (read-only)**

This reproduces the fix end-to-end on the FEAT-001 data. It does NOT modify that repo — it imports the patched module and rebuilds the report in memory.

Run:
```bash
python3 -c "
import importlib.util, pathlib
p = pathlib.Path('squads/sdd/hooks/cost_report.py')
spec = importlib.util.spec_from_file_location('cost_report', str(p))
cr = importlib.util.module_from_spec(spec); spec.loader.exec_module(cr)
sd = '/Users/gabrielandrade/Developer/ai-squad-os/.agent-session/FEAT-001'
import os
if os.path.isdir(sd):
    rep = cr.build_cost_report(sd)
    print('subagent_count:', rep['subagent_count'])
    print('recovered_subagents:', rep['recovered_subagents'])
    print('scoping_suspect:', rep['scoping_suspect'])
    print('implementation_cost_usd:', rep['implementation_cost_usd'])
else:
    print('FEAT-001 data not present — skipping live check')
"
```
Expected (if the data is present): `scoping_suspect: False`, `recovered_subagents` ≈ 66, and `implementation_cost_usd` ≈ `13.30` — the cost that previously vanished is now recovered. (The `session.yml` there has no `implementation_sessions:`, so the fallback excludes everything → the floor trips → recovery via the dominant cluster + the 64-dispatch manifest.)

- [ ] **Step 4: Final commit (only if Step 1-2 surfaced any uncommitted sync)**

```bash
git status --short
# If anything is unstaged from a sync, add and commit:
# git add -A && git commit -m "chore(cost): sync deployed-template copies (Spec B)"
```
