# FEAT-008 — Pipeline integrity (model drift + reviewer skip gate) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar issue #4 com duas guardas: (A) detectar drift entre `model` requested no Work Packet e `usage.model` resolvido pelo Subagent runtime; (B) bloquear `qa` dispatch quando `code-reviewer` + `logic-reviewer` não rodaram pra task, exceto se `tasks.md` declara `**Skip reviewers:** <reason>`.

**Architecture:** Gap A acrescenta validação ao `verify-output-packet.py` (Stop hook): lê o pareado `inputs/<dispatch_id>.json` (Work Packet snapshot) e compara `model` contra `usage.model` do Output Packet; drift → warning (não bloqueia Stop, pra não comer o trabalho do subagent). Gap B adiciona novo hook `verify-pipeline-completeness.py` (PreToolUse Task): quando o dispatch alvo é `qa` pra task T, verifica em `dispatch-manifest.json` que existem CR + LR done/needs_review pra T, ou `tasks.md` carrega `**Skip reviewers:**` na task T. Drift = block.

**Tech Stack:** Python 3.8+ stdlib, Markdown.

---

## File Structure

**Modify:**
- `squads/sdd/hooks/verify-output-packet.py` — adicionar `_check_model_drift` opcional + emit warning quando drift
- `squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py` — tests novos para drift detection
- `squads/sdd/skills/orchestrator/skill.md` — hard rule "Reviewer mandatory" + `**Skip reviewers:**` syntax doc
- `shared/concepts/effort.md` — reforçar precedência canonical
- `squads/sdd/hooks/claude-hooks.json` — wire novo hook

**Create:**
- `squads/sdd/hooks/verify-pipeline-completeness.py` — novo hook PreToolUse Task
- `squads/sdd/hooks/__tests__/test_verify_pipeline_completeness.py` — tests

---

## Task 1: Gap A — failing test for model drift detection

**Files:**
- Test: `squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py`

- [ ] **Step 1: Survey existing tests for verify-output-packet**

Run: `grep -n "def test_\|model\|class Test" squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py | head -20`

Identificar pattern de helpers (write fake packet, run hook).

- [ ] **Step 2: Add a TestModelDrift class at end of file (before `if __name__`)**

```python
class TestFEAT008ModelDriftDetection(unittest.TestCase):
    """Drift between Work Packet `model` and Output Packet `usage.model`
    emits a warning to stderr but does NOT block Stop (the subagent's work
    has already happened by Stop time — blocking would discard it)."""

    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp())
        self._task_dir = self._tmp / "T-001"
        (self._task_dir / "inputs").mkdir(parents=True)
        (self._task_dir / "outputs").mkdir(parents=True)

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _write_paired_packets(self, requested_model: str, resolved_model: str) -> Path:
        dispatch_id = "d-T-001-dev-l1"
        # Work Packet snapshot (orchestrator writes this per skill.md L318)
        wp_path = self._task_dir / "inputs" / f"{dispatch_id}.json"
        wp_path.write_text(json.dumps({
            "spec_id": "FEAT-099",
            "dispatch_id": dispatch_id,
            "to_role": "dev",
            "model": requested_model,
            "effort": "high",
        }), encoding="utf-8")
        # Output Packet
        op_path = self._task_dir / "outputs" / f"{dispatch_id}.json"
        op_path.write_text(json.dumps({
            "spec_id": "FEAT-099",
            "dispatch_id": dispatch_id,
            "role": "dev",
            "status": "done",
            "summary": "ok",
            "evidence": [],
            "usage": {
                "total_tokens": 100,
                "tool_uses": 1,
                "duration_ms": 10,
                "model": resolved_model,
            },
        }), encoding="utf-8")
        return op_path

    def test_drift_emits_warning_does_not_block(self):
        op = self._write_paired_packets(requested_model="sonnet", resolved_model="opus")
        from verify_output_packet import _check_model_drift
        warnings = _check_model_drift(op)
        self.assertTrue(warnings, "expected warning when model resolved differs from requested")
        joined = " ".join(warnings).lower()
        self.assertIn("sonnet", joined)
        self.assertIn("opus", joined)

    def test_match_emits_no_warning(self):
        op = self._write_paired_packets(requested_model="sonnet", resolved_model="claude-sonnet-4-5")
        from verify_output_packet import _check_model_drift
        warnings = _check_model_drift(op)
        # Substring match: "sonnet" appears in usage.model → considered matching.
        self.assertEqual(warnings, [])

    def test_no_work_packet_no_warning(self):
        # Output Packet exists but no paired Work Packet — silent (not our problem).
        dispatch_id = "d-T-002-dev-l1"
        op_path = self._task_dir / "outputs" / f"{dispatch_id}.json"
        op_path.write_text(json.dumps({
            "spec_id": "FEAT-099",
            "dispatch_id": dispatch_id,
            "role": "dev",
            "status": "done",
            "summary": "ok",
            "evidence": [],
            "usage": {"total_tokens": 100, "tool_uses": 1, "duration_ms": 10, "model": "opus"},
        }), encoding="utf-8")
        from verify_output_packet import _check_model_drift
        warnings = _check_model_drift(op_path)
        self.assertEqual(warnings, [])
```

- [ ] **Step 3: Run — expect ImportError**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_output_packet_roles.TestFEAT008ModelDriftDetection -v 2>&1 | tail -10`

Expected: errors (ImportError: cannot import `_check_model_drift`).

- [ ] **Step 4: Commit**

```bash
git add squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py
git commit -m "test(verify-output-packet): cover model drift detection (FEAT-008 Gap A)"
```

---

## Task 2: Gap A — implement `_check_model_drift` in verify-output-packet.py

**Files:**
- Modify: `squads/sdd/hooks/verify-output-packet.py`

- [ ] **Step 1: Add `_check_model_drift` function**

Adicione esta função antes do `def main()`:

```python
def _check_model_drift(output_packet_path: Path) -> list[str]:
    """FEAT-008 Gap A: compare Work Packet `model` with Output Packet `usage.model`.

    Returns a list of warning strings (empty when no drift or when the paired
    Work Packet is absent). Never blocks — emits warnings only.

    Drift heuristic: the canonical model (e.g. "sonnet") is expected to appear
    as a substring of the resolved model id (e.g. "claude-sonnet-4-5-...").
    Comparison is case-insensitive. When the substring is absent, drift is
    reported.
    """
    try:
        op = json.loads(output_packet_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    usage = op.get("usage")
    if not isinstance(usage, dict):
        return []
    resolved = usage.get("model")
    if not isinstance(resolved, str) or not resolved:
        return []

    dispatch_id = op.get("dispatch_id")
    if not isinstance(dispatch_id, str) or not dispatch_id:
        return []

    # Paired Work Packet lives one dir up, in inputs/.
    wp_path = output_packet_path.parent.parent / "inputs" / f"{dispatch_id}.json"
    try:
        wp = json.loads(wp_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []

    requested = wp.get("model")
    if not isinstance(requested, str) or not requested:
        return []

    if requested.lower() in resolved.lower():
        return []

    return [
        f"model_drift: dispatch_id={dispatch_id} requested='{requested}' "
        f"resolved='{resolved}' — Task tool model param may have been dropped"
    ]
```

- [ ] **Step 2: Wire `_check_model_drift` into main()**

Localize a função `main()` em `verify-output-packet.py`. Adicione, próximo do final do happy path (depois das validations OK, antes de retornar 0), emissão de warning a stderr:

Run: `grep -n "def main\|return 0\|packet_path" squads/sdd/hooks/verify-output-packet.py | head -20`

Localizar onde o packet_path está resolvido e emitir:

```python
    # FEAT-008 Gap A: model drift warning (non-blocking).
    for w in _check_model_drift(packet_path):
        print(f"verify-output-packet: WARN {w}", file=sys.stderr)
```

(Insira antes do `return 0` final do happy path. Procurar a variável `packet_path` ou equivalente — usar a variável existente que aponta pro Output Packet.)

- [ ] **Step 3: Run tests**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_output_packet_roles.TestFEAT008ModelDriftDetection -v 2>&1 | tail -10`

Expected: 3 tests pass.

- [ ] **Step 4: Run full hook test suite — verify no regression**

Run: `python3 -m unittest discover squads/sdd/hooks/__tests__/ 2>&1 | tail -3`

Expected: still green.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/verify-output-packet.py
git commit -m "feat(verify-output-packet): warn on model drift (FEAT-008 Gap A)"
```

---

## Task 3: Gap A — document precedence in shared/concepts/effort.md

**Files:**
- Modify: `shared/concepts/effort.md`

- [ ] **Step 1: Find a good location for the precedence note**

Run: `grep -n "## \|model\|precedence" shared/concepts/effort.md | head -20`

- [ ] **Step 2: Add a "Model precedence" subsection**

Adicionar onde fizer sentido (provavelmente depois da seção que descreve Tier × Loop ou onde override é mencionado):

```markdown
## Model precedence (FEAT-008)

A precedência canônica que determina o modelo efetivo no runtime, de mais alta pra mais baixa:

1. **Task tool `model` parameter** — único campo que controla o run-model do subagent. O orchestrator DEVE passá-lo em todo dispatch de role tiered (`dev`, `code-reviewer`, `logic-reviewer`, `qa`).
2. **Agent file frontmatter `model:`** — fallback documental; só é honrado quando (1) é omitido. Pode ser silenciosamente ignorado por mudanças no runtime do Claude Code.
3. **Parent session's model** — default implícito quando (1) e (2) ausentes. Inerentemente errado pra dispatches tiered (tipicamente opus no orchestrator, mas o subagent pode precisar de haiku/sonnet).

**Enforcement:** `verify-tier-calibration.py` (PreToolUse) bloqueia dispatches sem `model` no Task tool. `verify-output-packet.py` (Stop) emite warning quando `usage.model` resolvido diverge de `model` do Work Packet — defesa pós-fato.

**Work Packet `model: ...`** é descritivo (pro subagent auto-conhecer seu tier), nunca enforced no runtime.
```

- [ ] **Step 3: Commit**

```bash
git add shared/concepts/effort.md
git commit -m "docs(effort): document model precedence canonical (FEAT-008 Gap A)"
```

---

## Task 4: Gap B — failing tests for verify-pipeline-completeness.py

**Files:**
- Create: `squads/sdd/hooks/__tests__/test_verify_pipeline_completeness.py`

- [ ] **Step 1: Write the new test module**

```python
#!/usr/bin/env python3
"""Tests for verify-pipeline-completeness.py (FEAT-008 Gap B)."""
from __future__ import annotations

import atexit
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path

# Skill-scope gate stub
_ORCH_TRANSCRIPT = Path(tempfile.NamedTemporaryFile(
    mode="w", suffix=".jsonl", delete=False
).name)
_ORCH_TRANSCRIPT.write_text(
    "Base directory for this Skill: /tmp/.claude/skills/orchestrator\n",
    encoding="utf-8",
)
atexit.register(lambda: _ORCH_TRANSCRIPT.unlink(missing_ok=True))

_HOOK_PATH = Path(__file__).resolve().parents[1] / "verify-pipeline-completeness.py"
_spec = importlib.util.spec_from_file_location("verify_pipeline_completeness", _HOOK_PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
main = _mod.main


def _payload(prompt: str, session_id: str | None = None, project_dir: str | None = None) -> dict:
    return {
        "tool_input": {"prompt": prompt, "model": "haiku", "subagent_type": "qa"},
        "transcript_path": str(_ORCH_TRANSCRIPT),
        "cwd": project_dir or "/tmp",
    }


def _run_main(payload: dict, env_project_dir: str | None = None) -> tuple[int, str]:
    sys.stdin = StringIO(json.dumps(payload))
    captured = StringIO()
    saved_stdout = sys.stdout
    sys.stdout = captured
    saved_env = os.environ.get("CLAUDE_PROJECT_DIR")
    try:
        if env_project_dir:
            os.environ["CLAUDE_PROJECT_DIR"] = env_project_dir
        rc = main()
    finally:
        sys.stdout = saved_stdout
        if saved_env is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = saved_env
        sys.stdin = sys.__stdin__
    return rc, captured.getvalue()


def _make_workpacket(task_id: str, session_id: str, subagent_type: str) -> str:
    return (
        "WorkPacket:\n"
        "```yaml\n"
        f"session_id: {session_id}\n"
        f"task_id: {task_id}\n"
        f"subagent_type: {subagent_type}\n"
        "```\n"
    )


class TestPipelineCompleteness(unittest.TestCase):
    def setUp(self) -> None:
        self._project = Path(tempfile.mkdtemp())
        self._session_dir = self._project / ".agent-session"
        self._session_dir.mkdir()
        self._feat_dir = self._session_dir / "FEAT-099"
        self._feat_dir.mkdir()

    def tearDown(self) -> None:
        import shutil
        shutil.rmtree(self._project, ignore_errors=True)

    def _write_manifest(self, dispatches: list[dict]) -> None:
        (self._feat_dir / "dispatch-manifest.json").write_text(
            json.dumps({
                "schema_version": 1,
                "expected_pipeline": [],
                "actual_dispatches": dispatches,
            }),
            encoding="utf-8",
        )

    def _write_tasks_md(self, body: str) -> None:
        (self._feat_dir / "tasks.md").write_text(body, encoding="utf-8")

    def test_non_qa_dispatch_silent_allow(self):
        prompt = _make_workpacket("T-001", "FEAT-099", "dev")
        payload = {
            "tool_input": {"prompt": prompt, "model": "haiku", "subagent_type": "dev"},
            "transcript_path": str(_ORCH_TRANSCRIPT),
        }
        rc, out = _run_main(payload, env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_qa_with_cr_and_lr_done_allow(self):
        self._write_tasks_md("## T-001 task\n**Tier:** T1\n")
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
            {"task_id": "T-001", "role": "code-reviewer", "status": "done"},
            {"task_id": "T-001", "role": "logic-reviewer", "status": "needs_review"},
        ])
        prompt = _make_workpacket("T-001", "FEAT-099", "qa")
        payload = {
            "tool_input": {"prompt": prompt, "model": "haiku", "subagent_type": "qa"},
            "transcript_path": str(_ORCH_TRANSCRIPT),
        }
        rc, out = _run_main(payload, env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    def test_qa_without_cr_lr_blocked(self):
        self._write_tasks_md("## T-001 task\n**Tier:** T1\n")
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
        ])
        prompt = _make_workpacket("T-001", "FEAT-099", "qa")
        payload = {
            "tool_input": {"prompt": prompt, "model": "haiku", "subagent_type": "qa"},
            "transcript_path": str(_ORCH_TRANSCRIPT),
        }
        rc, out = _run_main(payload, env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertTrue(out.strip(), f"expected block payload, got: {out!r}")
        result = json.loads(out)
        self.assertEqual(result["decision"], "block")
        self.assertIn("pipeline_incomplete", result["reason"])

    def test_qa_without_cr_lr_but_skip_marker_allow(self):
        self._write_tasks_md(
            "## T-001 task\n**Tier:** T1\n**Skip reviewers:** budget — cost cap exception per Gap A\n"
        )
        self._write_manifest([
            {"task_id": "T-001", "role": "dev", "status": "done"},
        ])
        prompt = _make_workpacket("T-001", "FEAT-099", "qa")
        payload = {
            "tool_input": {"prompt": prompt, "model": "haiku", "subagent_type": "qa"},
            "transcript_path": str(_ORCH_TRANSCRIPT),
        }
        rc, out = _run_main(payload, env_project_dir=str(self._project))
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run — expect failures (hook does not exist yet)**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_pipeline_completeness -v 2>&1 | tail -10`

Expected: ImportError (file not found).

- [ ] **Step 3: Commit**

```bash
git add squads/sdd/hooks/__tests__/test_verify_pipeline_completeness.py
git commit -m "test(verify-pipeline-completeness): cover qa gate with skip exception"
```

---

## Task 5: Gap B — create verify-pipeline-completeness.py

**Files:**
- Create: `squads/sdd/hooks/verify-pipeline-completeness.py`

- [ ] **Step 1: Create the hook file**

```python
#!/usr/bin/env python3
"""ai-squad PreToolUse hook — verify-pipeline-completeness (FEAT-008 Gap B).

Fires on Task dispatches under the orchestrator Skill. When the targeted
subagent is `qa`, verifies that the pipeline pre-conditions are satisfied:
both `code-reviewer` AND `logic-reviewer` have produced a non-pending
Output Packet for the same task_id, OR the task in `tasks.md` carries
a `**Skip reviewers:** <reason>` marker.

Drift → block with `pipeline_incomplete`. Non-qa dispatches: silent allow.

Pure stdlib. Python 3.8+.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import detect_active_skill


_WP_FENCED = re.compile(
    r"WorkPacket:\s*\n```(?:ya?ml)?\s*\n(.*?)```", re.DOTALL,
)
_WP_INLINE = re.compile(
    r"```(?:ya?ml)?\s*\nWorkPacket:\s*\n(.*?)```", re.DOTALL,
)
_KV_RE = re.compile(
    r"^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*?)[ \t]*$", re.MULTILINE,
)
_SKIP_REVIEWERS_RE = re.compile(
    r"\*\*Skip reviewers:\*\*\s*(.+)", re.IGNORECASE,
)
_REVIEWER_DONE_STATUSES = frozenset({"done", "needs_review"})


def _parse_wp(prompt: str) -> dict[str, str]:
    m = _WP_FENCED.search(prompt) or _WP_INLINE.search(prompt)
    if not m:
        return {}
    body = m.group(1)
    out: dict[str, str] = {}
    for km in _KV_RE.finditer(body):
        key = km.group(1)
        val = km.group(2).strip()
        if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
            val = val[1:-1]
        out[key] = val
    return out


def _resolve_session_dir() -> Path | None:
    pd = os.environ.get("CLAUDE_PROJECT_DIR", "")
    if not pd:
        return None
    sd = Path(pd) / ".agent-session"
    return sd if sd.is_dir() else (Path(pd) if Path(pd).is_dir() else None)


def _has_skip_marker(tasks_md: Path, task_id: str) -> bool:
    try:
        content = tasks_md.read_text(encoding="utf-8", errors="replace")
    except (OSError, IOError):
        return False
    # Find the task's section.
    section_re = re.compile(
        r"^##\s+" + re.escape(task_id) + r"\b.*$", re.MULTILINE,
    )
    m = section_re.search(content)
    if m is None:
        return False
    section_start = m.end()
    next_re = re.compile(r"\n##\s+", re.MULTILINE)
    nm = next_re.search(content, section_start)
    section = content[section_start:(nm.start() if nm else len(content))]
    return _SKIP_REVIEWERS_RE.search(section) is not None


def _reviewers_done_for_task(manifest: dict, task_id: str) -> tuple[bool, bool]:
    """Return (has_code_reviewer_done, has_logic_reviewer_done)."""
    cr = lr = False
    for entry in manifest.get("actual_dispatches") or []:
        if not isinstance(entry, dict):
            continue
        if entry.get("task_id") != task_id:
            continue
        role = entry.get("role")
        status = entry.get("status")
        if status not in _REVIEWER_DONE_STATUSES:
            continue
        if role == "code-reviewer":
            cr = True
        elif role == "logic-reviewer":
            lr = True
    return cr, lr


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0  # fail open

    if detect_active_skill(payload) != "orchestrator":
        return 0

    tool_input = payload.get("tool_input") or {}
    if not isinstance(tool_input, dict):
        return 0
    prompt = tool_input.get("prompt", "")
    subagent_type = tool_input.get("subagent_type", "")
    if isinstance(subagent_type, str):
        subagent_type = subagent_type.strip().lower()
    else:
        subagent_type = ""

    if subagent_type != "qa":
        # Only gate qa dispatches. dev / CR / LR / audit-agent: silent allow.
        return 0

    wp = _parse_wp(prompt if isinstance(prompt, str) else "")
    task_id = wp.get("task_id", "")
    session_id = wp.get("session_id", "")
    if not task_id or not session_id:
        # Cannot verify without identifiers — fail open.
        return 0

    session_dir = _resolve_session_dir()
    if session_dir is None:
        return 0

    feat_dir = session_dir / session_id
    manifest_path = feat_dir / "dispatch-manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        # First dispatch — no manifest yet. Cannot enforce.
        return 0
    if not isinstance(manifest, dict):
        return 0

    cr_done, lr_done = _reviewers_done_for_task(manifest, task_id)
    if cr_done and lr_done:
        return 0

    # One or both reviewers missing — last-chance escape: `**Skip reviewers:**`
    # marker in tasks.md for this task.
    tasks_md = feat_dir / "tasks.md"
    if tasks_md.exists() and _has_skip_marker(tasks_md, task_id):
        return 0

    missing = []
    if not cr_done:
        missing.append("code-reviewer")
    if not lr_done:
        missing.append("logic-reviewer")
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"pipeline_incomplete: qa dispatch for {task_id} requires "
            f"{', '.join(missing)} with status in {{done, needs_review}} first; "
            f"or declare `**Skip reviewers:** <reason>` in the task section "
            f"of {tasks_md} (FEAT-008 Gap B)"
        ),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Make executable**

```bash
chmod +x squads/sdd/hooks/verify-pipeline-completeness.py
```

- [ ] **Step 3: Run tests**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_pipeline_completeness -v 2>&1 | tail -10`

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add squads/sdd/hooks/verify-pipeline-completeness.py
git commit -m "feat(hooks): add verify-pipeline-completeness.py for qa gate (FEAT-008 Gap B)"
```

---

## Task 6: Gap B — wire hook in claude-hooks.json

**Files:**
- Modify: `squads/sdd/hooks/claude-hooks.json`

- [ ] **Step 1: Add the PreToolUse Task entry**

Inspecione o array `PreToolUse` em `squads/sdd/hooks/claude-hooks.json`. Localize a entry com `"matcher": "Task"` (verify-tier-calibration.py). Adicione um segundo hook command no mesmo array `hooks` daquela entry (ou crie outra entry com matcher Task — JSON permite múltiplas entries):

Adicionar (preferência: dentro do `hooks` array da entry "Task" existente, depois do hook de tier-calibration):

```json
          {
            "type": "command",
            "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/verify-pipeline-completeness.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/verify-pipeline-completeness.py\"",
            "timeout": 5
          }
```

(Match o padrão dos hooks existentes — fail-open guard `[ -f ... ] || exit 0`.)

- [ ] **Step 2: Validate JSON**

Run: `python3 -c "import json; json.load(open('squads/sdd/hooks/claude-hooks.json')); print('json ok')"`

Expected: `json ok`.

- [ ] **Step 3: Mirror to cursor-hooks.json if needed**

Run: `cat squads/sdd/hooks/cursor-hooks.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps([k for k in d.get('hooks',{}).keys()]))"`

Se cursor-hooks.json também tem matcher Task pra verify-tier-calibration, adicionar verify-pipeline-completeness lá também (mesmo path, mesmo timeout). Caso contrário, skip.

- [ ] **Step 4: Commit**

```bash
git add squads/sdd/hooks/claude-hooks.json squads/sdd/hooks/cursor-hooks.json
git commit -m "chore(hooks): wire verify-pipeline-completeness on PreToolUse Task"
```

---

## Task 7: Gap B — orchestrator skill hard rule + `**Skip reviewers:**` syntax

**Files:**
- Modify: `squads/sdd/skills/orchestrator/skill.md`

- [ ] **Step 1: Locate the "Per-task state machine" or pipeline-canonical section**

Run: `grep -n "Per-task\|state machine\|pipeline\|qa\|code-reviewer" squads/sdd/skills/orchestrator/skill.md | head -20`

- [ ] **Step 2: Add a hard-rule subsection**

Adicionar próximo da seção que descreve o pipeline (dev → CR ‖ LR → QA). Texto:

```markdown
### Reviewer mandatoriness (FEAT-008 Gap B)

Code-reviewer e logic-reviewer são **mandatórios** entre `dev` e `qa` para toda task do tipo dev. Pular CR/LR sem registro explícito é proibido — `verify-pipeline-completeness.py` (PreToolUse Task) bloqueia o `qa` dispatch caso CR + LR não tenham status `done` ou `needs_review` no manifesto.

**Exceção explícita:** quando o PM/orchestrator avalia que o custo dos reviewers não se justifica para uma task específica (e.g. one-line fix, doc-only edit), pode declarar isenção em `tasks.md` na seção da task:

```markdown
## T-XXX titulo

**Tier:** T1
**Skip reviewers:** budget — single-line docs typo fix, no logic surface
```

O marker libera o `qa` gate. Sem o marker, qualquer skip é bloqueado. Esta exceção é audit-visible: audit-agent reporta tasks com skip-reviewers como `pipeline_stage_skipped` finding (severity `warning`, not blocker).
```

- [ ] **Step 3: Commit**

```bash
git add squads/sdd/skills/orchestrator/skill.md
git commit -m "feat(orchestrator): hard rule reviewer mandatory + Skip reviewers escape (FEAT-008 Gap B)"
```

---

## Task 8: Sync runtime hook copies

**Files:**
- Sync verify-pipeline-completeness.py + verify-output-packet.py to runtime copies

- [ ] **Step 1: Copy to runtime locations**

```bash
cp squads/sdd/hooks/verify-pipeline-completeness.py .claude/hooks/verify-pipeline-completeness.py
cp squads/sdd/hooks/verify-pipeline-completeness.py packages/cli/.claude/hooks/verify-pipeline-completeness.py
cp squads/sdd/hooks/verify-pipeline-completeness.py packages/cli/components/sdd/hooks/verify-pipeline-completeness.py
cp squads/sdd/hooks/verify-output-packet.py .claude/hooks/verify-output-packet.py
cp squads/sdd/hooks/verify-output-packet.py packages/cli/.claude/hooks/verify-output-packet.py
cp squads/sdd/hooks/verify-output-packet.py packages/cli/components/sdd/hooks/verify-output-packet.py
```

- [ ] **Step 2: Verify checksums**

```bash
md5 -q squads/sdd/hooks/verify-pipeline-completeness.py .claude/hooks/verify-pipeline-completeness.py packages/cli/.claude/hooks/verify-pipeline-completeness.py packages/cli/components/sdd/hooks/verify-pipeline-completeness.py
md5 -q squads/sdd/hooks/verify-output-packet.py .claude/hooks/verify-output-packet.py packages/cli/.claude/hooks/verify-output-packet.py packages/cli/components/sdd/hooks/verify-output-packet.py
```

Expected: 4 linhas iguais por hook.

- [ ] **Step 3: No commit (runtime copies are gitignored)**

Verificar:

```bash
git status -s
```

Expected: tudo limpo (mudanças runtime gitignored).

---

## Task 9: Verification

- [ ] **Step 1: Run all hook tests**

Run: `python3 -m unittest discover squads/sdd/hooks/__tests__/ 2>&1 | tail -3`

Expected: green.

- [ ] **Step 2: Verify issue #4 AC checklist**

- [ ] Output Packet de LR tem `model_resolved_to: claude-sonnet-*` quando dispatchado com `model: sonnet` — coberto via `usage.model` + drift warning (Task 2)
- [ ] Drift entre `model_requested` e `model_resolved_to` warns (não block — defensive) (Task 2)
- [ ] Re-rodar `/pm FEAT-006 --resume` não pula CR/LR sem `**Skip reviewers:**` — coberto pelo hook + tests (Task 5)
- [ ] `verify-pipeline-completeness.py` cobre happy + skip-justified + violation (Task 4 tests)
- [ ] Precedência documentada em `shared/concepts/effort.md` (Task 3)

---

## Self-Review

**Spec coverage:**
- Gap A model drift detection → Task 1 (tests), Task 2 (impl), Task 3 (docs).
- Gap B reviewer gate → Task 4 (tests), Task 5 (hook), Task 6 (wiring), Task 7 (orchestrator).
- Runtime sync → Task 8.

**Placeholder scan:** nenhum TBD/TODO.

**Type consistency:** `_check_model_drift(Path) -> list[str]`. `_parse_wp(str) -> dict[str,str]`. `_reviewers_done_for_task(dict, str) -> tuple[bool,bool]`. `_has_skip_marker(Path, str) -> bool`. Consistente.

Plano OK.

---

## Execution

Execução inline via `superpowers:executing-plans`.
