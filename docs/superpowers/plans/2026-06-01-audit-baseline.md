# Audit Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the audit-agent's Check 6 from flagging human-inherited working-tree dirt (e.g. a `.gitignore` edited before Phase 4) as `orchestrator_edited_source` fraud — by capturing a deterministic pre-pipeline baseline and exempting it, while keeping real orchestrator source-editing terminal.

**Architecture:** Two layers. (1) **Baseline (always, PM + HOTL):** a `PreToolUse(Task)` hook snapshots the dirty working tree before the first dispatch (the first dispatch is always `dev`); a shared helper computes `delta = dirty_now − baseline`; Check 6 reconciles only the `delta` against dev packets and exempts the baseline, recording the exemption as evidence. The baseline file is made off-limits to the orchestrator by the existing write-guard (attestation: the untrusted orchestrator cannot measure or rewrite its own baseline). (2) **Human confirmation (HOTL only):** when Check 6 still blocks on `orchestrator_edited_source` and a human is present, the orchestrator shows `git diff` per orphan path and asks the human — once, via `AskUserQuestion` — to authorize it as their own concurrent edit. PM-autonomous never opens this path (fail-safe stays blocked).

**Tech Stack:** Python 3.8+ stdlib only (no PyYAML), pytest. Hook wiring in `claude-hooks.json`. Markdown instruction edits to `audit-agent.md` and the orchestrator Skill. The framework is NOT dogfooded on this repo — edits here are manual (Read/Edit/Write), executed with TDD + pytest where the surface is Python.

---

## Background context (read before starting)

The bug, from a real run (`ai-squad-os` FEAT-001, 64 dispatches, 22/22 ACs, 265 tests green): the human had edited `.gitignore` **before** starting Phase 4. The audit-agent's Check 6 runs `git diff --name-only HEAD` and demands the dirty set equal the union of every dev packet's `files_changed[]` (minus `.agent-session/`). The pre-existing `.gitignore` matched no dev packet → `orchestrator_edited_source` → `blocker_kind: bypass_detected`. Because a `blocked` audit is terminal by anti-fraud design (issue #1), the orchestrator was forced to refuse the handoff of fully-integral work. Design doc: [`docs/superpowers/specs/2026-06-01-audit-baseline-design.md`](../specs/2026-06-01-audit-baseline-design.md).

**The fix is baseline-awareness.** Check 6 today has no "photo" of what was already dirty before Phase 4. We give it one, captured by a deterministic hook (not the orchestrator LLM — attestation: a non-trusted component cannot measure itself), and protected from later rewriting by the existing `guard-session-scope` hook.

**Key files:**
- Canonical source (edit + commit ONLY here): `squads/sdd/hooks/` (Python), `squads/sdd/agents/` (agent markdown), `squads/sdd/skills/orchestrator/` (orchestrator markdown)
- Tests: `squads/sdd/hooks/__tests__/` (pytest), `squads/sdd/agents/__tests__/` (manual QA scenario doc — new)

**⚠ Packaging — do NOT sync `components/` by hand.** `packages/cli/components/` is **git-ignored build output** (`packages/cli/.gitignore` line 1), regenerated from `squads/sdd/` by `packages/cli/scripts/sync-components.mjs` on `prepack`/`prepare` (before `npm pack`/`publish`). The sync does `rm -rf components/` then re-copies, dropping `__tests__/` and `__pycache__/`. So **edit and commit only the canonical `squads/sdd/` source** — a manual `cp` into `components/` is wiped on the next sync and a `git add` of it is a gitignored no-op. To validate the publish path, run `npm --prefix packages/cli run sync` (Task 6).

**Run tests with:** `python3 -m pytest squads/sdd/hooks/__tests__/ -q` (run from repo root).

**Why the markdown changes aren't pytest:** Check 6 and the orchestrator handoff are LLM instructions (the audit-agent runs on Haiku), not Python — you cannot `pytest` a model's reasoning. So the error-prone arithmetic (set subtraction) is extracted into the deterministic, unit-tested helper `audit_baseline.py` (Task 1), and the agent's behavior is verified by a manual QA scenario doc (Task 4). This keeps the model out of the math.

**Invariants you must NOT break:**
- Anti-fraude (issue #1): source dirtied **during** the pipeline with no dev packet stays `orchestrator_edited_source` / `bypass_detected`. The baseline exempts only what was dirty **before** the first dispatch.
- `blocked` stays terminal; the orchestrator cannot re-dispatch the audit to flip a verdict. Layer 2 is a human authorization at handoff, NOT a re-audit.
- Layer 2 unblocks **only** `orchestrator_edited_source`. Every other blocker_kind / finding kind (`role_mismatch`, `pipeline_stage_skipped`, `ac_not_validated`, `schema_violation`, `missing_output_packet`, `orphan_output_packet`) stays terminal — a question cannot make a stage have run or a packet exist.
- The orchestrator still cannot edit source (`guard-session-scope`); the baseline file becomes off-limits to it too.
- Project-agnostic: no project names, local conventions, or other repos' skills in any code.

**Cursor note (decided up front):** Cursor's `preToolUse` has no `Task` matcher (only `Shell`), so the baseline hook cannot fire there. On Cursor the baseline is simply absent → Check 6 takes its `baseline_present: false` fail-safe (whole-tree compare, bias toward blocked) and, with a human present, Layer 2 can still unblock. This mirrors how Spec B left `register-impl-session` best-effort on Cursor. Rejected alternative: inventing a Cursor `Shell` pre-hook to approximate the trigger — it would fire on every shell call, not once before the first dispatch, and add complexity for a degraded path the fail-safe already covers.

---

## Task 1: Shared helper — `audit_baseline.py` (dirty-set source of truth + delta)

**Files:**
- Create: `squads/sdd/hooks/audit_baseline.py`
- Create: `squads/sdd/hooks/__tests__/test_audit_baseline.py`
- (No manual `components/` sync — regenerated at pack; see Background.)

- [ ] **Step 1: Write the failing tests**

Create `squads/sdd/hooks/__tests__/test_audit_baseline.py`:

```python
import importlib.util
import json
import subprocess
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "audit_baseline", str(_LIB / "audit_baseline.py"))
ab = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ab)


def _git(repo, *args):
    subprocess.run(["git", "-C", str(repo), *args],
                   check=True, capture_output=True, text=True)


def test_dirty_paths_lists_modified_and_untracked(tmp_path):
    _git(tmp_path, "init")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "tracked.txt").write_text("a\n")
    _git(tmp_path, "add", "tracked.txt")
    _git(tmp_path, "commit", "-m", "init")
    (tmp_path / "tracked.txt").write_text("b\n")   # modified
    (tmp_path / "new.txt").write_text("x\n")        # untracked
    got = ab.dirty_paths(tmp_path)
    assert got == ["new.txt", "tracked.txt"]        # sorted


def test_dirty_paths_empty_outside_git(tmp_path):
    # Not a work tree -> best-effort empty, never a crash.
    assert ab.dirty_paths(tmp_path) == []


def test_load_baseline_absent_returns_none(tmp_path):
    assert ab.load_baseline(tmp_path) is None


def test_load_baseline_reads_dirty_paths(tmp_path):
    (tmp_path / ab.BASELINE_FILENAME).write_text(
        json.dumps({"schema_version": 1, "dirty_paths": ["b", "a"]}))
    assert ab.load_baseline(tmp_path) == ["a", "b"]   # sorted


def test_load_baseline_malformed_returns_none(tmp_path):
    (tmp_path / ab.BASELINE_FILENAME).write_text("{ not json")
    assert ab.load_baseline(tmp_path) is None


def test_compute_subtracts_baseline(tmp_path, monkeypatch):
    monkeypatch.setattr(ab, "dirty_paths", lambda p: [".gitignore", "src/a.ts"])
    (tmp_path / ab.BASELINE_FILENAME).write_text(
        json.dumps({"schema_version": 1, "dirty_paths": [".gitignore"]}))
    rep = ab.compute(tmp_path, tmp_path)
    assert rep["baseline_present"] is True
    assert rep["delta"] == ["src/a.ts"]          # introduced by the pipeline
    assert rep["exempted"] == [".gitignore"]     # pre-existing, never a finding


def test_compute_absent_baseline_delta_is_whole_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(ab, "dirty_paths", lambda p: ["src/a.ts"])
    rep = ab.compute(tmp_path, tmp_path)
    assert rep["baseline_present"] is False
    assert rep["delta"] == ["src/a.ts"]          # nothing exempted
    assert rep["exempted"] == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_audit_baseline.py -v`
Expected: collection error / FAIL — `audit_baseline.py` does not exist yet.

- [ ] **Step 3: Create `audit_baseline.py`**

Create `squads/sdd/hooks/audit_baseline.py`:

```python
#!/usr/bin/env python3
"""ai-squad helper — audit baseline (Spec A).

Shared, deterministic computation behind the audit-agent's Check 6 baseline
exemption. NOT a hook: it is imported by capture-baseline.py (to snapshot the
working tree) and invoked as a read-only CLI by the audit-agent (to compute the
delta the agent reconciles against dev packets).

The single source of truth for "what counts as a dirty path" lives here
(`dirty_paths`), so the baseline snapshot and the Check 6 comparison can never
drift apart — the set subtraction only lines up if both sides parse git the same
way.

Pure stdlib. Python 3.8+. Read-only: only runs `git status`, never writes.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

BASELINE_FILENAME = "audit-baseline.json"


def dirty_paths(project_dir) -> list:
    """Repo-relative paths currently dirty in the working tree.

    Uses `git status --porcelain` — the unified notion of "dirty" shared by the
    baseline snapshot and Check 6 (the legacy Check 6 used `git diff --name-only
    HEAD`, which ignored untracked files; porcelain covers both, so the
    subtraction is exact). Returns a sorted list. Any git failure (not a work
    tree, git missing) yields [] — callers treat that as best-effort, never crash.
    """
    try:
        out = subprocess.run(
            ["git", "-C", str(project_dir), "status", "--porcelain"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    paths = set()
    for line in out.stdout.splitlines():
        if len(line) < 4:
            continue
        path = line[3:]                       # strip the 2-char XY status + space
        if " -> " in path:                    # renamed: "ORIG -> NEW"; keep NEW
            path = path.split(" -> ", 1)[1]
        paths.add(path)
    return sorted(paths)


def load_baseline(session_dir):
    """Return the baseline's dirty_paths list, or None when no usable baseline
    exists (feature predates the hook, capture never ran, or the file is
    corrupt). None drives the audit-agent's whole-tree fail-safe."""
    f = Path(session_dir) / BASELINE_FILENAME
    if not f.exists():
        return None
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    paths = data.get("dirty_paths") if isinstance(data, dict) else None
    return sorted(paths) if isinstance(paths, list) else None


def compute(project_dir, session_dir) -> dict:
    """Reconcile the current dirty set against the baseline.

    Returns:
      baseline_present: bool  — False => audit must use the whole-tree fail-safe.
      dirty_now: sorted list  — everything dirty now.
      baseline:  sorted list  — what was dirty before Phase 4 ([] if absent).
      delta:     sorted list  — dirty_now - baseline (pipeline-introduced; these
                                still require a dev packet to be legitimate).
      exempted:  sorted list  — dirty_now & baseline (pre-existing; never a finding).
    """
    now = dirty_paths(project_dir)
    base = load_baseline(session_dir)
    present = base is not None
    base = base or []
    base_set = set(base)
    delta = sorted(p for p in now if p not in base_set)
    exempted = sorted(p for p in now if p in base_set)
    return {
        "baseline_present": present,
        "dirty_now": now,
        "baseline": base,
        "delta": delta,
        "exempted": exempted,
    }


def main(argv) -> int:
    # CLI: audit_baseline.py <spec_id>  -> prints compute() as JSON.
    # project_dir = CWD (the audit-agent runs from the consumer repo root);
    # session_dir = .agent-session/<spec_id>/.
    if len(argv) < 2:
        print(json.dumps({"error": "usage: audit_baseline.py <spec_id>"}))
        return 2
    project_dir = Path.cwd()
    session_dir = project_dir / ".agent-session" / argv[1]
    print(json.dumps(compute(project_dir, session_dir), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_audit_baseline.py -v`
Expected: all PASS (7 tests).

- [ ] **Step 5: Commit (canonical source only)**

```bash
git add squads/sdd/hooks/audit_baseline.py squads/sdd/hooks/__tests__/test_audit_baseline.py
git commit -m "feat(audit): add audit_baseline helper — shared dirty-set + baseline delta (Spec A)"
```
(`components/` is git-ignored and regenerated at pack — do not add it.)

---

## Task 2: Capture hook — `capture-baseline.py` at first dispatch

**Files:**
- Create: `squads/sdd/hooks/capture-baseline.py`
- Create: `squads/sdd/hooks/__tests__/test_capture_baseline.py`
- Modify: `squads/sdd/hooks/claude-hooks.json` (add to the `PreToolUse`/`Task` block)
- (No manual `components/` sync — regenerated at pack; see Background.)

- [ ] **Step 1: Write the failing tests**

Create `squads/sdd/hooks/__tests__/test_capture_baseline.py`:

```python
import importlib.util
import io
import json
from pathlib import Path

_LIB = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location(
    "capture_baseline", str(_LIB / "capture-baseline.py"))
cb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cb)


def _wire(monkeypatch, skill, repo_root, dirty, session_id="SESS-1"):
    monkeypatch.setattr(cb, "detect_active_skill", lambda p: skill)
    monkeypatch.setattr(cb, "resolve_project_root", lambda p: repo_root)
    monkeypatch.setattr(cb.audit_baseline, "dirty_paths", lambda p: dirty)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"session_id": session_id})))


def test_captures_baseline_on_first_orchestrator_dispatch(tmp_path, monkeypatch):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "orchestrator", tmp_path, dirty=[".gitignore", "README.md"])
    assert cb.main() == 0
    data = json.loads((sd / "audit-baseline.json").read_text())
    assert data["dirty_paths"] == [".gitignore", "README.md"]
    assert data["captured_at_session"] == "SESS-1"


def test_idempotent_does_not_overwrite_existing_baseline(tmp_path, monkeypatch):
    # --resume / --restart must REUSE the original baseline, never recapture
    # (recapturing would absorb the prior run's edits as pre-existing).
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    (sd / "audit-baseline.json").write_text('{"schema_version": 1, "dirty_paths": ["original"]}')
    _wire(monkeypatch, "orchestrator", tmp_path, dirty=["something-else"])
    assert cb.main() == 0
    data = json.loads((sd / "audit-baseline.json").read_text())
    assert data["dirty_paths"] == ["original"]   # untouched


def test_skips_when_not_orchestrator(tmp_path, monkeypatch):
    sd = tmp_path / ".agent-session" / "FEAT-001"
    sd.mkdir(parents=True)
    (sd / "session.yml").write_text("id: FEAT-001\n")
    _wire(monkeypatch, "dev", tmp_path, dirty=["x"])
    assert cb.main() == 0
    assert not (sd / "audit-baseline.json").exists()


def test_skips_when_no_session(tmp_path, monkeypatch):
    _wire(monkeypatch, "orchestrator", tmp_path, dirty=["x"])   # no .agent-session/
    assert cb.main() == 0   # no crash, nothing written
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_capture_baseline.py -v`
Expected: collection error / FAIL — `capture-baseline.py` does not exist yet.

- [ ] **Step 3: Create `capture-baseline.py`**

Create `squads/sdd/hooks/capture-baseline.py`:

```python
#!/usr/bin/env python3
"""ai-squad PreToolUse(Task) hook — capture-baseline.

Captures a one-time "dirty baseline" snapshot of the working tree the FIRST time
an orchestrator session dispatches a Task. The first Phase 4 dispatch is always a
`dev`, so this fires immediately before any source edit — recording the files
already modified BEFORE the pipeline touched anything (human-inherited dirt or a
concurrent human edit), which the audit-agent's Check 6 must NOT mistake for
orchestrator source-editing fraud.

Why a hook, not the orchestrator: attestation / Root of Trust — the orchestrator
LLM (already observed skipping steps, issue #1) cannot trustworthily measure its
own baseline. A deterministic shell-run hook is the measurer; the companion
guard-session-scope hook then makes audit-baseline.json off-limits to the
orchestrator, so it cannot be rewritten after capture.

Idempotent by existence: writes only if audit-baseline.json is absent. A
--resume or --restart run REUSES the original baseline and never recaptures
(recapturing on restart would absorb the previous run's edits as pre-existing).
The baseline lives at the session root (a sibling of outputs/), so --restart —
which wipes only outputs/ — preserves it.

Skill-scope gated to `orchestrator`. Fail-open: never blocks the dispatch.
Pure stdlib. Python 3.8+.
"""
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

import audit_baseline  # noqa: E402
from hook_runtime import detect_active_skill, resolve_project_root  # noqa: E402


def find_active_session(project_dir):
    """Newest .agent-session/<ID>/ that has a session.yml. Reliable here because
    the orchestrator just wrote its own session.yml, so it is the freshest."""
    base = Path(project_dir) / ".agent-session"
    if not base.is_dir():
        return None
    cands = [p for p in base.iterdir() if (p / "session.yml").exists()]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    # Only an orchestrator session has a baseline to capture; the first dispatch
    # is the moment just before the first source edit.
    if detect_active_skill(payload) != "orchestrator":
        return 0
    project_dir = resolve_project_root(payload)
    session_dir = find_active_session(project_dir)
    if session_dir is None:
        return 0
    baseline = session_dir / audit_baseline.BASELINE_FILENAME
    if baseline.exists():
        return 0   # idempotent — capture once; reuse on --resume/--restart
    snapshot = {
        "schema_version": 1,
        "captured_at_session": payload.get("session_id"),
        "dirty_paths": audit_baseline.dirty_paths(project_dir),
    }
    try:
        tmp = baseline.with_name(baseline.name + ".tmp")
        tmp.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
        tmp.replace(baseline)   # atomic publish
    except OSError as e:        # fail-open — never block the dispatch
        print(f"capture-baseline: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_capture_baseline.py -v`
Expected: all PASS (4 tests).

- [ ] **Step 5: Wire `claude-hooks.json` — add capture-baseline to PreToolUse(Task)**

In `squads/sdd/hooks/claude-hooks.json`, in the existing `PreToolUse` block whose `"matcher": "Task"` (currently lines 36-50), ADD a new entry to that block's `hooks` array, after `verify-pipeline-completeness.py`:

```json
          {
            "type": "command",
            "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-baseline.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/capture-baseline.py\"",
            "timeout": 5
          }
```

Leave `cursor-hooks.json` unchanged (no `Task` matcher in Cursor — see the Cursor note in Background; the baseline is absent there and Check 6 falls back).

- [ ] **Step 6: Verify the JSON wiring is correct**

Run:
```bash
python3 -c "
import json
h = json.load(open('squads/sdd/hooks/claude-hooks.json'))
task = next(b for b in h['hooks']['PreToolUse'] if b.get('matcher') == 'Task')
cmds = ' '.join(x['command'] for x in task['hooks'])
assert 'capture-baseline' in cmds, 'capture-baseline not in PreToolUse(Task)'
print('OK: capture-baseline is under PreToolUse(Task)')
"
```
Expected: `OK: capture-baseline is under PreToolUse(Task)`

- [ ] **Step 7: Commit (canonical source only)**

```bash
git add squads/sdd/hooks/capture-baseline.py squads/sdd/hooks/__tests__/test_capture_baseline.py squads/sdd/hooks/claude-hooks.json
git commit -m "feat(audit): capture pre-Phase-4 dirty baseline at first dispatch (Spec A L1)"
```
(`components/` is git-ignored and regenerated at pack — do not add it.)

---

## Task 3: Protect the baseline — extend `guard-session-scope.py`

**Files:**
- Modify: `squads/sdd/hooks/guard-session-scope.py` (deny orchestrator writes to `audit-baseline.json`)
- Modify: `squads/sdd/hooks/__tests__/test_guard_session_scope.py` (new deny test)
- (No manual `components/` sync — regenerated at pack; see Background.)

- [ ] **Step 1: Write the failing test**

Add to `squads/sdd/hooks/__tests__/test_guard_session_scope.py` (inside `class TestGuardSessionScope`, after `test_deny_outputs_packet`):

```python
    # --- Spec A: the audit baseline is off-limits to the orchestrator ---
    def test_deny_audit_baseline(self):
        result, _ = _run_hook(self._payload(".agent-session/FEAT-010/audit-baseline.json"))
        self.assertEqual(_decision(result), "deny")
        self.assertIn("baseline", result["hookSpecificOutput"]["permissionDecisionReason"].lower())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_guard_session_scope.py::TestGuardSessionScope::test_deny_audit_baseline -v`
Expected: FAIL — the guard currently allows `audit-baseline.json` (it's a non-`outputs/` path inside `.agent-session/`, so it hits the `return 0` allow branch), so `result == {}` and `_decision(result) == ""`.

- [ ] **Step 3: Import the baseline filename constant in the guard**

In `squads/sdd/hooks/guard-session-scope.py`, REPLACE the import line (currently line 31):

```python
from hook_runtime import edit_target_path, resolve_project_root, tool_input_dict
```

with:

```python
from audit_baseline import BASELINE_FILENAME
from hook_runtime import edit_target_path, resolve_project_root, tool_input_dict
```

- [ ] **Step 4: Add the baseline deny branch**

In `squads/sdd/hooks/guard-session-scope.py`, in `main()`, REPLACE the `.agent-session/`-relative block (currently lines 113-132, beginning `if rel is not None:` and ending with the `return 0  # other .agent-session/ ...` line):

```python
    if rel is not None:
        # rel = <spec_id>/<subdir>/...  — outputs/ is subagent-owned, off-limits.
        parts = rel.parts
        if len(parts) >= 2 and parts[1] == "outputs":
            decision = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Orchestrator must not write Output Packets. Path '{file_path}' is "
                        f"under .agent-session/<spec_id>/outputs/, authored exclusively by "
                        f"subagents. Editing it is evidence tampering — a blocked audit is "
                        f"terminal; recover with /orchestrator --restart "
                        f"(see squads/sdd/skills/orchestrator/skill.md step 8)."
                    ),
                }
            }
            print(json.dumps(decision))
            return 0
        return 0  # other .agent-session/ paths (manifest, inputs/, session.yml, ...) — allowed
```

with (adds the `audit-baseline.json` deny branch before the allow `return 0`):

```python
    if rel is not None:
        # rel = <spec_id>/<subdir-or-file>/...  — some entries are off-limits.
        parts = rel.parts
        if len(parts) >= 2 and parts[1] == "outputs":
            decision = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Orchestrator must not write Output Packets. Path '{file_path}' is "
                        f"under .agent-session/<spec_id>/outputs/, authored exclusively by "
                        f"subagents. Editing it is evidence tampering — a blocked audit is "
                        f"terminal; recover with /orchestrator --restart "
                        f"(see squads/sdd/skills/orchestrator/skill.md step 8)."
                    ),
                }
            }
            print(json.dumps(decision))
            return 0
        if len(parts) == 2 and parts[1] == BASELINE_FILENAME:
            # The audit baseline is the Root of Trust for Check 6 — captured by
            # the deterministic capture-baseline hook. The orchestrator rewriting
            # it could hide source edits from the audit (Spec A attestation).
            decision = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": (
                        f"Orchestrator must not write the audit baseline. Path '{file_path}' "
                        f"is the deterministic pre-Phase-4 dirty snapshot captured by "
                        f"capture-baseline.py (Root of Trust for audit Check 6). Rewriting it "
                        f"would let source edits escape detection (Spec A)."
                    ),
                }
            }
            print(json.dumps(decision))
            return 0
        return 0  # other .agent-session/ paths (manifest, inputs/, session.yml, ...) — allowed
```

- [ ] **Step 5: Run the guard test suite to verify it passes (no regressions)**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_guard_session_scope.py -v`
Expected: all PASS, including the new `test_deny_audit_baseline` and the existing `test_allow_manifest` / `test_allow_session_yml` (manifest and session.yml have `parts[1]` other than `outputs`/`audit-baseline.json`, so they still hit the allow branch).

- [ ] **Step 6: Commit (canonical source only)**

```bash
git add squads/sdd/hooks/guard-session-scope.py squads/sdd/hooks/__tests__/test_guard_session_scope.py
git commit -m "feat(audit): make audit-baseline.json off-limits to the orchestrator (Spec A)"
```
(`components/` is git-ignored and regenerated at pack — do not add it.)

---

## Task 4: Make Check 6 baseline-aware — `audit-agent.md`

**Files:**
- Modify: `squads/sdd/agents/audit-agent.md` (Check 6 — call the helper, reconcile `delta`, exempt baseline with evidence, absent-fallback)
- Create: `squads/sdd/agents/__tests__/test_audit_baseline_scenarios.md` (manual QA scenario doc — note: `__tests__/` is dropped by the pack sync, so it ships nowhere; it lives in source only)
- (No manual `components/` sync — regenerated at pack; see Background.)

> **Why no pytest here:** Check 6 is an LLM instruction run on Haiku, not Python. The error-prone arithmetic is already deterministic and unit-tested in `audit_baseline.py` (Task 1). This task changes the *instruction* so the agent calls that helper and consumes its output, and verifies the agent's behavior with a manual QA scenario doc (the repo's existing precedent for agent behavior is the scenario doc `squads/sdd/skills/__tests__/test_pm_bypass_integration.md`).

- [ ] **Step 1: Rewrite Check 6 to be baseline-aware**

In `squads/sdd/agents/audit-agent.md`, REPLACE the Check 6 paragraph (currently line 70, beginning `**Check 6 — Source-file ownership (non-edit invariant).**`):

```markdown
**Check 6 — Source-file ownership (non-edit invariant).** Run `git diff --name-only HEAD`; aggregate the union of `files_changed[]` across all `dev` packets. The two sets MUST be equal (excluding `.agent-session/` paths — orchestrator-managed). A working-tree file covered by no `dev` packet → `severity: blocker, audit_finding_kind: orchestrator_edited_source` (orchestrator edited directly). If git is unavailable (not a working tree) → emit `kind: absence` evidence + a `severity: major` warning instead of `blocker` (best-effort fallback).
```

with:

```markdown
**Check 6 — Source-file ownership (non-edit invariant, baseline-aware).** First compute the dirty/baseline delta — do NOT eyeball `git diff`. Run `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/audit_baseline.py" <spec_id>` (read-only; same allowed pattern as the Phase 4 sweep's `verify-output-packet.py` call). It prints JSON `{baseline_present, dirty_now[], baseline[], delta[], exempted[]}`, where `dirty_now` is `git status --porcelain` (the unified definition of "dirty" — covers modified AND untracked), `delta` is what the pipeline introduced, and `exempted` is what was already dirty before Phase 4. Aggregate the union of `files_changed[]` across all `dev` packets, then:

- **`baseline_present: true`:** reconcile **`delta[]`** (NOT `dirty_now[]`) against the dev-packet union, excluding `.agent-session/` paths. A path in `delta[]` covered by no `dev` packet → `severity: blocker, audit_finding_kind: orchestrator_edited_source` (orchestrator edited directly). Paths in `exempted[]` are pre-existing (human-inherited or concurrent human edits) and are NEVER a finding. Record them once as `kind: file` evidence, `ref: audit-baseline.json`, `note: "<N> path(s) exempted as pre-existing (baseline)"` — surfaced, never silently dropped (mirrors cost-report's `excluded_subagents`).
- **`baseline_present: false`** (feature predates the hook, or capture never ran — e.g. Cursor, which has no Task matcher): FAIL-SAFE — reconcile the whole tree (`dirty_now[]` ≡ dev-packet union, excluding `.agent-session/`); any uncovered path → `orchestrator_edited_source`. Add one `kind: absence` evidence `note: "baseline absent — whole-tree compare"`. Bias toward `blocked`.
- **git unavailable** (`dirty_now` empty AND `baseline_present: false` because not a work tree) → emit `kind: absence` evidence + a `severity: major` warning instead of `blocker` (best-effort fallback, unchanged).

Per-path, not per-content: an exempted path is exempt entirely, even if a dev also edited it (consistent with the legacy Check 6; the orchestrator cannot exploit this — `guard-session-scope` blocks it from editing source at all).
```

- [ ] **Step 2: Create the QA scenario doc**

Create `squads/sdd/agents/__tests__/test_audit_baseline_scenarios.md`:

````markdown
# QA Scenario — Audit Baseline (Spec A, Check 6)

> **Executor:** qa Subagent (or a human running the audit-agent against fixtures).
> **Source of truth:** `squads/sdd/agents/audit-agent.md` Check 6;
> `squads/sdd/hooks/audit_baseline.py`.
> **Why manual:** Check 6 is an LLM instruction (Haiku), not Python. The set
> arithmetic it relies on is unit-tested in `test_audit_baseline.py`; these
> scenarios verify the agent CONSUMES that helper correctly.

Each scenario seeds a synthetic `.agent-session/FEAT-TEST/` and a working tree,
then runs the audit-agent and asserts the Output Packet.

## Scenario 1 — pre-existing dirt is exempted (the FEAT-001 bug)
- Baseline: `audit-baseline.json` with `dirty_paths: [".gitignore"]`.
- Working tree: `.gitignore` dirty (no dev packet touches it); `src/a.ts` dirty WITH a dev packet.
- Expect: `status: done`. `.gitignore` does NOT produce `orchestrator_edited_source`.
  Evidence includes `note: "1 path(s) exempted as pre-existing (baseline)"`.

## Scenario 2 — real orchestrator edit still blocks
- Baseline: `audit-baseline.json` with `dirty_paths: []`.
- Working tree: `src/secret.ts` dirty, covered by NO dev packet.
- Expect: `status: blocked, blocker_kind: bypass_detected`, one
  `orchestrator_edited_source` finding for `src/secret.ts`. (Anti-fraude intact.)

## Scenario 3 — baseline absent → fail-safe
- No `audit-baseline.json`.
- Working tree: `.gitignore` dirty, no dev packet.
- Expect: `status: blocked` (whole-tree compare), evidence
  `note: "baseline absent — whole-tree compare"`. With a human present, Layer 2
  (orchestrator) can later authorize `.gitignore` — see the Layer 2 scenario doc.

## Scenario 4 — concurrent human edit during the run (NOT in baseline)
- Baseline: `audit-baseline.json` with `dirty_paths: []` (clean at start).
- Working tree: human edits `docs/x.md` mid-run; no dev packet.
- Expect: `status: blocked` `orchestrator_edited_source` for `docs/x.md`. The
  audit cannot know it was the human — this is Layer 2's job (Task 5), not the
  baseline's. (Documents the deliberate Layer 1/Layer 2 split.)
````

- [ ] **Step 3: Commit (canonical source only)**

```bash
git add squads/sdd/agents/audit-agent.md squads/sdd/agents/__tests__/test_audit_baseline_scenarios.md
git commit -m "feat(audit): Check 6 exempts pre-existing baseline dirt (Spec A L1)"
```
(`components/` is git-ignored and regenerated at pack — do not add it.)

---

## Task 5: Layer 2 — human authorization at handoff (orchestrator)

**Files:**
- Modify: `squads/sdd/skills/orchestrator/skill.md` (step 8 — Layer 2 exception for `orchestrator_edited_source` only)
- Modify: `squads/sdd/skills/orchestrator/handoff.md` (bypass_detected opening line — note ownership blocks may be human-authorized)
- (No manual `components/` sync — regenerated at pack; see Background.)

> **Why no pytest here:** the orchestrator is a Skill (LLM instruction + `AskUserQuestion`), not Python. Behavior is verified by the scenario doc from Task 4 plus the GAP-B precedent (`shared/concepts/pm-bypass.md` already validates the "human authorizes once via AskUserQuestion" pattern). The human-present signal reuses GAP B's `auto_approved_by`.

- [ ] **Step 1: Insert the Layer 2 exception into step 8**

In `squads/sdd/skills/orchestrator/skill.md`, in step 8, REPLACE the `status: blocked` bullet (currently line 180):

```markdown
- **`status: blocked`** (any `blocker_kind`) → DO NOT emit a normal handoff. Set `current_phase: escalated`, emit the **audit-failure handoff** ([`handoff.md`](handoff.md)) selecting the narrative by `blocker_kind` (`bypass_detected` / `schema_violation` / `pipeline_stage_skipped` / other). Save to `handoff.md`. Stop.
```

with:

```markdown
- **`status: blocked`** (any `blocker_kind`) → DO NOT emit a normal handoff. **First**, apply the Layer 2 environment-block exception below if it qualifies; otherwise set `current_phase: escalated`, emit the **audit-failure handoff** ([`handoff.md`](handoff.md)) selecting the narrative by `blocker_kind` (`bypass_detected` / `schema_violation` / `pipeline_stage_skipped` / other). Save to `handoff.md`. Stop.
  - **Layer 2 — human ownership authorization (Spec A; `orchestrator_edited_source` ONLY).** Qualifies iff ALL three hold: (1) `blocker_kind: bypass_detected`; (2) **every** blocking finding has `audit_finding_kind: orchestrator_edited_source` (if even one other finding kind is present — `role_mismatch`, `pipeline_stage_skipped`, `ac_not_validated`, `schema_violation`, `missing_output_packet`, `orphan_output_packet` — it does NOT qualify and stays terminal); (3) a human is present (`auto_approved_by` ≠ `"pm"` in `session.yml` — PM-autonomous never opens this path). When it qualifies, for EACH `orchestrator_edited_source` finding's path: run `git diff <path>` (read-only), show the diff, and ask via `AskUserQuestion` **once**: *"`<path>` was modified, but no dev agent declared it — either you edited it manually, or something wrote outside the pipeline. Do you recognize this change as yours?"*
    - **Yes** → that path is an authorized human edit; drop the finding and append to `session.yml.notes` an `audit_override: { path: <path>, authorized_by: human, audit_dispatch_id: <id> }` entry. If, after asking about every such path, no blocking findings remain → proceed to step 9 (ownership audit treated as passed). The handoff records the authorization(s).
    - **No** → real bypass; keep the finding, set `current_phase: escalated`, emit the `bypass_detected` audit-failure handoff. Stop.
  - This NEVER re-dispatches the audit (a `blocked` verdict stays terminal — Layer 2 is a handoff-time human decision, not a second audit) and NEVER edits files under `outputs/` (`guard-session-scope` blocks it). The honesty of the question is the defense: showing the full diff and naming the risk lets the human decide with real information. Mirrors GAP B — the orchestrator never self-certifies; only the human authority authorizes, once.
```

- [ ] **Step 2: Note the exception in the bypass handoff narrative**

In `squads/sdd/skills/orchestrator/handoff.md`, REPLACE the `bypass_detected` opening-line bullet (currently line 37):

```markdown
  - bypass_detected:   The dispatch manifest does not reconcile with actual execution — the orchestrator likely bypassed Subagent dispatch and did the work directly (or fabricated outputs).
```

with:

```markdown
  - bypass_detected:   The dispatch manifest does not reconcile with actual execution — the orchestrator likely bypassed Subagent dispatch and did the work directly (or fabricated outputs). (If the only findings were `orchestrator_edited_source` and a human was present, the Layer 2 authorization in skill.md step 8 ran first; this refusal means it was unavailable — PM-autonomous — or the human denied the change.)
```

- [ ] **Step 3: Commit (canonical source only)**

```bash
git add squads/sdd/skills/orchestrator/skill.md squads/sdd/skills/orchestrator/handoff.md
git commit -m "feat(orchestrator): Layer 2 — human authorizes orchestrator_edited_source at handoff (Spec A L2)"
```
(`components/` is git-ignored and regenerated at pack — do not add it.)

---

## Task 6: Final verification

- [ ] **Step 1: Run the entire hook test suite**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/ -q`
Expected: all PASS, no errors. (New: `test_audit_baseline.py`, `test_capture_baseline.py`, and the new `test_deny_audit_baseline` in `test_guard_session_scope.py`.)

- [ ] **Step 2: Validate the publish path — regenerate `components/` from source**

`components/` is git-ignored build output; the real check is that the pack-time sync reproduces this plan's files from `squads/sdd/`. Run the sync and confirm the new files land (and that `__tests__/` are correctly dropped):

```bash
npm --prefix packages/cli run sync
for f in audit_baseline.py capture-baseline.py guard-session-scope.py claude-hooks.json; do
  test -f "packages/cli/components/sdd/hooks/$f" && echo "OK hooks/$f" || echo "MISSING hooks/$f"
done
test -f packages/cli/components/sdd/agents/audit-agent.md && echo "OK agents/audit-agent.md" || echo "MISSING agents/audit-agent.md"
for f in skill.md handoff.md; do
  test -f "packages/cli/components/sdd/skills/orchestrator/$f" && echo "OK orchestrator/$f" || echo "MISSING orchestrator/$f"
done
test ! -d packages/cli/components/sdd/agents/__tests__ && echo "OK __tests__ excluded from bundle" || echo "WARN __tests__ bundled"
```
Expected: all `OK ...`, no `MISSING`, and `__tests__` excluded. (No `git add` of `components/` — it is gitignored.)

- [ ] **Step 3: End-to-end smoke of the helper CLI against a synthetic session (read-only)**

Reproduces the FEAT-001 shape in a throwaway temp repo — confirms `.gitignore` lands in `exempted`, not `delta`.

Run:
```bash
python3 - <<'PY'
import json, subprocess, tempfile, pathlib, importlib.util
tmp = pathlib.Path(tempfile.mkdtemp())
def git(*a): subprocess.run(["git","-C",str(tmp),*a], check=True, capture_output=True)
git("init"); git("config","user.email","t@t"); git("config","user.name","t")
(tmp/".gitignore").write_text("node_modules\n"); git("add",".gitignore"); git("commit","-m","init")
# a tracked src tree already exists (realistic); dev later adds src/a.ts into it
(tmp/"src").mkdir(); (tmp/"src"/"existing.ts").write_text("e\n"); git("add","src/existing.ts"); git("commit","-m","src")
# human dirties .gitignore BEFORE the pipeline; pipeline later adds src/a.ts
(tmp/".gitignore").write_text("node_modules\ndist\n")
sd = tmp/".agent-session"/"FEAT-001"; sd.mkdir(parents=True)
(sd/"session.yml").write_text("id: FEAT-001\n")
(sd/"audit-baseline.json").write_text(json.dumps({"schema_version":1,"dirty_paths":[".gitignore"]}))
(tmp/"src"/"a.ts").write_text("export const x = 1\n")
spec = importlib.util.spec_from_file_location("ab","squads/sdd/hooks/audit_baseline.py")
ab = importlib.util.module_from_spec(spec); spec.loader.exec_module(ab)
rep = ab.compute(tmp, sd)
print("baseline_present:", rep["baseline_present"])
print("dirty_now:", rep["dirty_now"])
print("delta:", rep["delta"])         # expect ['src/a.ts']
print("exempted:", rep["exempted"])   # expect ['.gitignore']
assert rep["delta"] == ["src/a.ts"] and rep["exempted"] == [".gitignore"], rep
print("OK: pre-existing .gitignore exempted; pipeline edit in delta; .agent-session excluded")
PY
```
Expected: `baseline_present: True`, `delta: ['src/a.ts']`, `exempted: ['.gitignore']`, `.agent-session/` absent from `dirty_now`, `OK: ...`. (Note: `dirty_paths` uses `--untracked-files=all` so files in a new untracked dir are listed file-by-file, and it excludes `.agent-session/` itself — see the Task 1 fix commit.)

- [ ] **Step 4: Final commit (only if Step 1-2 surfaced any uncommitted sync)**

```bash
git status --short
# If anything is unstaged from a sync, add and commit:
# git add -A && git commit -m "chore(audit): sync deployed-template copies (Spec A)"
```

---

## Self-review (completed at plan-write time)

**Spec coverage** (against `2026-06-01-audit-baseline-design.md` §"Superfície de implementação"):
1. Hook `capture-baseline.py`, `PreToolUse(Task)`, orchestrator-scoped, idempotent, writes protected path → **Task 2**. ✔
2. `guard-session-scope.py` extends off-limits to the baseline path → **Task 3**. ✔
3. `audit-agent.md` Check 6: read baseline, compute delta, exempt with evidence, absent-fallback, unify "dirty" definition → **Task 4** (arithmetic in the helper, **Task 1**). ✔
4. Orchestrator step 8 / handoff Layer 2: `git diff` + `AskUserQuestion`, restricted to `orchestrator_edited_source`, human-present gate → **Task 5**. ✔
5. Packaging → `components/` is git-ignored, regenerated from `squads/sdd/` by the pack-time sync; validated by `npm run sync` in **Task 6**. No manual copy/commit. ✔
6. Tests: pre-existing exempted (T4 Scenario 1 + T1 `test_compute_subtracts_baseline`); concurrent human edit via Layer 2 (T4 Scenario 4 + T5); real fraud still blocked (T4 Scenario 2 + helper keeps it in `delta`); baseline-absent fail-safe (T4 Scenario 3 + T1 `test_compute_absent_baseline`); other blocker_kinds not Layer-2-unblockable (T5 step 1 condition 2). ✔

**Design boundary checks:** Layer 2 restricted to `orchestrator_edited_source` only (T5 cond. 2); `blocked` stays terminal, no re-audit (T5 closing note); baseline reused on `--resume`/`--restart`, never recaptured (T2 idempotency test + baseline at session root survives the `outputs/`-only restart wipe); attestation — hook writes, guard forbids orchestrator rewrite (T2 + T3).

**Type/name consistency:** `BASELINE_FILENAME = "audit-baseline.json"` defined once in `audit_baseline.py` (T1) and imported by the guard (T3) and the capture hook (T2); helper output keys `baseline_present`/`dirty_now`/`baseline`/`delta`/`exempted` are identical across the helper (T1), its tests (T1), the agent instruction (T4), and the smoke test (T6).

**Placeholder scan:** none — every code/instruction step carries full content.
