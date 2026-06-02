# Integridade de escrita da Fase 4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que os dois artefatos de disco da Fase 4 — o Output Packet de cada dispatch e o `dispatch-manifest.json` — sempre persistam íntegros, mesmo sob morte abrupta de subagent (anomalia de plataforma) ou escrita repetida.

**Architecture:** Dois componentes independentes. **C-2 (manifesto):** um CLI dedicado `manifest_append.py` envelopa o `atomic_manifest_mutate` já existente (tmp+rename+lock sidecar); o orchestrator passa a chamá-lo em vez de editar JSON na mão. **C-1 (packet):** um hook novo `PostToolUse(Task)` (`verify-dispatch-packet.py`) detecta deterministicamente, logo após cada `Task` retornar, se o packet aterrissou; se não, surfacea a lacuna via `additionalContext`, e o orchestrator re-dispara (contador próprio `packet_retries`, teto 2, depois `blocked` terminal). Defesa em profundidade: `SubagentStop` (já existe) cobre término limpo; o novo `PostToolUse` cobre morte abrupta; o audit (já existe) é a rede terminal.

**Tech Stack:** Python 3.8+ stdlib (hooks e CLI), JSON Schema, YAML (`session.yml`), Markdown (skills). Testes em `unittest`. CLI de deploy em Node (`packages/cli`).

**Referência de design:** [`docs/superpowers/specs/2026-06-01-phase4-write-integrity-design.md`](../specs/2026-06-01-phase4-write-integrity-design.md).

**Convenção de commit:** Conventional Commits. **Nunca** incluir o trailer `Co-Authored-By`.

**Nota de ordem:** C-2 primeiro (mecânico, baixo risco, constrói momentum), depois C-1 (mexe no loop de dispatch). Cada task produz mudança auto-contida.

---

## File Structure

**Criar:**
- `squads/sdd/hooks/manifest_append.py` — CLI de append atômico ao manifesto (C-2).
- `squads/sdd/hooks/verify-dispatch-packet.py` — hook `PostToolUse(Task)` de detecção de packet (C-1).
- `squads/sdd/hooks/__tests__/test_manifest_append.py` — testes do CLI.
- `squads/sdd/hooks/__tests__/test_verify_dispatch_packet.py` — testes do hook.

**Modificar:**
- `squads/sdd/skills/orchestrator/SKILL.md` — step 1b (chamar o CLI), steps 3/4 (reagir ao hook + re-dispatch), frontmatter (registrar o hook PostToolUse), preflight (incluir os arquivos novos).
- `squads/sdd/skills/orchestrator/dispatch-manifest.md` — regra de append via CLI.
- `squads/sdd/hooks/claude-hooks.json` — registrar `PostToolUse(Task)`.
- `shared/templates/session.yml` — adicionar `packet_retries: 0` em `task_states[T-XXX]`.
- `shared/concepts/session.md` — documentar `packet_retries`.

**Sincronizar (não editar à mão):**
- `packages/cli/components/sdd/...` — cópia empacotada, gerada por `npm run sync`.

---

## Componente C-2 — integridade do manifesto

### Task 1: CLI `manifest_append.py` (append atômico ao manifesto)

**Files:**
- Create: `squads/sdd/hooks/manifest_append.py`
- Test: `squads/sdd/hooks/__tests__/test_manifest_append.py`

O CLI recebe o caminho do manifesto e um objeto JSON de dispatch (via stdin), e o anexa a `actual_dispatches[]` usando `atomic_manifest_mutate` ([`_pm_shared.py:299`](../../../squads/sdd/hooks/_pm_shared.py)). Saída em stdout: `{"appended": true, "actual_dispatches_count": <n>}` em sucesso; exit 0. Em erro (manifesto inexistente / JSON inválido / stdin malformado): `{"appended": false, "error": "..."}` em stderr, exit 1.

- [ ] **Step 1: Escrever o teste que falha**

Criar `squads/sdd/hooks/__tests__/test_manifest_append.py`:

```python
#!/usr/bin/env python3
"""Tests for manifest_append.py — atomic append to dispatch-manifest.json."""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_CLI = _HOOKS_DIR / "manifest_append.py"


def _run_cli(manifest_path: Path, dispatch_json: str) -> tuple[dict, int]:
    """Invoke the CLI with manifest path as argv[1] and dispatch JSON on stdin."""
    result = subprocess.run(
        [sys.executable, str(_CLI), str(manifest_path)],
        input=dispatch_json,
        capture_output=True,
        text=True,
        timeout=10,
        env=os.environ,
    )
    out = (result.stdout or result.stderr).strip()
    parsed = json.loads(out) if out else {}
    return parsed, result.returncode


def _seed_manifest(tmp: Path) -> Path:
    manifest = {
        "schema_version": 1,
        "spec_id": "FEAT-001",
        "expected_pipeline": [{"task_id": "T-001", "required_roles": ["dev"]}],
        "actual_dispatches": [],
    }
    p = tmp / "dispatch-manifest.json"
    p.write_text(json.dumps(manifest, indent=2))
    return p


class TestManifestAppend(unittest.TestCase):
    def setUp(self):
        self._tmp = Path(tempfile.mkdtemp())

    def test_append_adds_entry(self):
        manifest = _seed_manifest(self._tmp)
        entry = {"dispatch_id": "d-T-001-dev-l1", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": 1}
        out, rc = _run_cli(manifest, json.dumps(entry))
        self.assertEqual(rc, 0)
        self.assertTrue(out["appended"])
        self.assertEqual(out["actual_dispatches_count"], 1)
        doc = json.loads(manifest.read_text())
        self.assertEqual(doc["actual_dispatches"][0]["dispatch_id"], "d-T-001-dev-l1")
        # expected_pipeline untouched
        self.assertEqual(len(doc["expected_pipeline"]), 1)

    def test_missing_manifest_errors(self):
        out, rc = _run_cli(self._tmp / "nope.json", json.dumps({"dispatch_id": "x"}))
        self.assertEqual(rc, 1)
        self.assertFalse(out["appended"])
        self.assertIn("not found", out["error"].lower())

    def test_malformed_stdin_errors(self):
        manifest = _seed_manifest(self._tmp)
        out, rc = _run_cli(manifest, "{not json")
        self.assertEqual(rc, 1)
        self.assertFalse(out["appended"])

    def test_concurrent_appends_no_corruption(self):
        manifest = _seed_manifest(self._tmp)

        def worker(i: int):
            _run_cli(manifest, json.dumps(
                {"dispatch_id": f"d-T-001-dev-l{i}", "task_id": "T-001",
                 "role": "dev", "status": "done", "review_loop": i}))

        threads = [threading.Thread(target=worker, args=(i,)) for i in range(1, 11)]
        for t in threads: t.start()
        for t in threads: t.join()
        doc = json.loads(manifest.read_text())  # must be valid JSON
        self.assertEqual(len(doc["actual_dispatches"]), 10)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_manifest_append -v`
Expected: FAIL — `manifest_append.py` não existe (todos os casos erram ao invocar o CLI ausente).

- [ ] **Step 3: Implementar o CLI**

Criar `squads/sdd/hooks/manifest_append.py`:

```python
#!/usr/bin/env python3
"""
ai-squad CLI: python3 manifest_append.py <manifest_path>  (dispatch JSON on stdin)

Atomically append one dispatch entry to dispatch-manifest.json's
actual_dispatches[]. Replaces the orchestrator's by-hand JSON editing, which
could (and did) corrupt the manifest. Wraps _pm_shared.atomic_manifest_mutate
(tmp + rename + sidecar fcntl lock) so the write is atomic and concurrency-safe.

stdin: a single JSON object — the actual_dispatches[] entry to append.
stdout (success): {"appended": true, "actual_dispatches_count": <n>}  -> exit 0
stderr (failure): {"appended": false, "error": "<reason>"}            -> exit 1

Pure stdlib. Python 3.8+.
"""
import json
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from _pm_shared import atomic_manifest_mutate


def _fail(reason: str) -> int:
    print(json.dumps({"appended": False, "error": reason}), file=sys.stderr)
    return 1


def main(argv: list) -> int:
    if len(argv) < 1:
        return _fail("usage: manifest_append.py <manifest_path> (dispatch JSON on stdin)")
    manifest_path = Path(argv[0])

    try:
        raw = sys.stdin.read()
        entry = json.loads(raw)
    except (json.JSONDecodeError, ValueError) as exc:
        return _fail(f"malformed dispatch JSON on stdin ({exc})")
    if not isinstance(entry, dict):
        return _fail("dispatch entry must be a JSON object")

    count_holder = {}

    def mutator(doc: dict) -> dict:
        dispatches = doc.get("actual_dispatches")
        if not isinstance(dispatches, list):
            dispatches = []
            doc["actual_dispatches"] = dispatches
        dispatches.append(entry)
        count_holder["n"] = len(dispatches)
        return doc

    try:
        atomic_manifest_mutate(manifest_path, mutator)
    except FileNotFoundError:
        return _fail(f"manifest not found: {manifest_path}")
    except json.JSONDecodeError as exc:
        return _fail(f"manifest is not valid JSON ({exc})")
    except OSError as exc:
        return _fail(f"manifest write failed ({exc})")

    print(json.dumps({"appended": True, "actual_dispatches_count": count_holder["n"]}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_manifest_append -v`
Expected: PASS — 4 casos verdes.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/manifest_append.py squads/sdd/hooks/__tests__/test_manifest_append.py
git commit -m "feat(orchestrator): add manifest_append CLI for atomic dispatch-manifest writes (C-2)"
```

---

### Task 2: Orchestrator passa a usar o CLI (parar de editar o manifesto na mão)

**Files:**
- Modify: `squads/sdd/skills/orchestrator/dispatch-manifest.md`
- Modify: `squads/sdd/skills/orchestrator/SKILL.md` (step 1b)

Esta task é edição de skill (Markdown) — não há teste unitário; a aceitação é a presença das instruções corretas.

- [ ] **Step 1: Atualizar `dispatch-manifest.md` (regra de append)**

Em [`squads/sdd/skills/orchestrator/dispatch-manifest.md`](../../../squads/sdd/skills/orchestrator/dispatch-manifest.md), substituir a seção "## After every `Task` dispatch, append to `actual_dispatches[]`" pela instrução de chamar o CLI. Trocar o texto introdutório dessa seção por:

```markdown
## After every `Task` dispatch, append to `actual_dispatches[]`

NEVER hand-edit the manifest JSON. Append the entry by piping it to the atomic
CLI (it wraps a tmp + rename + sidecar-lock write that cannot corrupt the file):

```sh
printf '%s' '<dispatch entry JSON>' | python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/manifest_append.py" .agent-session/<spec_id>/dispatch-manifest.json
```

The entry has the shape below. A non-zero exit means the append failed (e.g.
manifest missing) — surface it; do not retry by editing the file by hand.
```

Manter o bloco de schema JSON da entry (campos `dispatch_id`, `task_id`, `role`, etc.) e as "Field rules" exatamente como estão.

- [ ] **Step 2: Atualizar o step 1b do `SKILL.md`**

Em [`squads/sdd/skills/orchestrator/SKILL.md:118-119`](../../../squads/sdd/skills/orchestrator/SKILL.md), a seção `### 1b. Write the dispatch manifest`. Manter a escrita inicial do manifesto (a estrutura `expected_pipeline` + `actual_dispatches: []`), mas trocar a frase "then append to it after every dispatch" para apontar ao CLI. Substituir o parágrafo por:

```markdown
### 1b. Write the dispatch manifest (Outbox + GitHub required-checks pattern)
Before any `Task` dispatch, write `.agent-session/<spec_id>/dispatch-manifest.json` with its initial structure (`expected_pipeline` + empty `actual_dispatches`). After every dispatch, append the dispatch entry by piping it to `manifest_append.py` — NEVER hand-edit the manifest JSON (by-hand edits corrupted it in FEAT-001). Full schema, the CLI call, field rules, and `--resume` behavior: [`dispatch-manifest.md`](dispatch-manifest.md). Manifest-first, dispatch-second — it is the audit trail step 8 reconciles.
```

- [ ] **Step 3: Atualizar a Hard rule de append**

Em [`squads/sdd/skills/orchestrator/SKILL.md:213`](../../../squads/sdd/skills/orchestrator/SKILL.md), a regra "Never: append to `actual_dispatches[]` without a corresponding real `Task` dispatch." Adicionar logo após ela uma nova linha:

```markdown
- Never: hand-edit `dispatch-manifest.json` with Edit/Write. Append only via `manifest_append.py` (atomic). By-hand JSON editing corrupted the manifest in FEAT-001.
```

- [ ] **Step 4: Verificar as edições**

Run: `grep -n "manifest_append.py" squads/sdd/skills/orchestrator/SKILL.md squads/sdd/skills/orchestrator/dispatch-manifest.md`
Expected: ao menos 3 ocorrências (step 1b, hard rule, dispatch-manifest.md).

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/skills/orchestrator/SKILL.md squads/sdd/skills/orchestrator/dispatch-manifest.md
git commit -m "feat(orchestrator): route manifest appends through atomic CLI, forbid hand-editing (C-2)"
```

---

## Componente C-1 — integridade do Output Packet

### Task 3: Adicionar `packet_retries` ao schema do `session.yml`

**Files:**
- Modify: `shared/templates/session.yml` (bloco `task_states`, ~linhas 62-75)
- Modify: `shared/concepts/session.md` (seção de `task_states`, ~linhas 200-217)

Edição de schema/doc — sem teste unitário; aceitação via inspeção.

- [ ] **Step 1: Adicionar o campo ao template**

Em [`shared/templates/session.yml`](../../../shared/templates/session.yml), no exemplo comentado de `task_states[T-XXX]`, adicionar a linha `packet_retries` logo após `blocker_calls`. O bloco comentado fica:

```yaml
task_states: {}
  # T-001:
  #   state: "pending"               # pending | running | blocked | resolved | done | pending_human | failed
  #   review_loops: 0
  #   qa_loops: 0
  #   blocker_calls: 0
  #   packet_retries: 0              # re-dispatches due to a missing/invalid Output Packet (cap: packet_retry_max=2)
  #   last_dispatch_id: ""
  #   last_diff_hash: ""
  #   last_findings_hash: ""
  #   last_finding_set_hash: ""
  #   blocker_summary: ""
  #   started_at: ""
  #   completed_at: ""
```

- [ ] **Step 2: Documentar em `session.md`**

Em [`shared/concepts/session.md`](../../../shared/concepts/session.md), na descrição dos campos de `task_states`, adicionar uma linha após a descrição de `blocker_calls`:

```markdown
- `packet_retries` (int, inicia 0): número de re-disparos do mesmo dispatch motivados por Output Packet ausente ou inválido logo após o `Task` retornar (morte abrupta do subagent, ex.: anomalia de plataforma). Contador SEPARADO de `review_loops`/`qa_loops` — falha de entrega de artefato não é dificuldade de código. Teto `packet_retry_max=2`; estourado → task `blocked` terminal (`missing_output_packet`). Preservado em `--resume`.
```

- [ ] **Step 3: Verificar**

Run: `grep -n "packet_retries" shared/templates/session.yml shared/concepts/session.md`
Expected: 1 ocorrência em cada arquivo.

- [ ] **Step 4: Commit**

```bash
git add shared/templates/session.yml shared/concepts/session.md
git commit -m "feat(session): add packet_retries counter to task_states schema (C-1)"
```

---

### Task 4: Hook `verify-dispatch-packet.py` (PostToolUse(Task), detecção)

**Files:**
- Create: `squads/sdd/hooks/verify-dispatch-packet.py`
- Test: `squads/sdd/hooks/__tests__/test_verify_dispatch_packet.py`

O hook roda na sessão do orchestrator, após cada `Task` retornar. Lê `subagent_type` e `prompt` de `tool_input`. Só age se `subagent_type` for um papel da Fase 4. Extrai `dispatch_id` do prompt, resolve a sessão ativa (`.agent-session/<spec_id>/`, mais recente por mtime), e valida `outputs/<dispatch_id>.json` reusando `validate_packet` de `verify-output-packet.py` (carregado via importlib porque o nome do arquivo tem hífen). Packet ausente OU inválido → emite `additionalContext`. Caso contrário → saída vazia (silêncio). Nunca bloqueia.

- [ ] **Step 1: Escrever o teste que falha**

Criar `squads/sdd/hooks/__tests__/test_verify_dispatch_packet.py`:

```python
#!/usr/bin/env python3
"""Tests for verify-dispatch-packet.py — PostToolUse(Task) packet detection."""
import importlib.util
import json
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent.parent
_HOOK = _HOOKS_DIR / "verify-dispatch-packet.py"


def _load_main():
    spec = importlib.util.spec_from_file_location("verify_dispatch_packet", str(_HOOK))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_main(mod, payload: dict, project_dir: Path) -> tuple[int, str]:
    stdin_bak, stdout_bak = sys.stdin, sys.stdout
    import os
    env_bak = os.environ.get("CLAUDE_PROJECT_DIR")
    os.environ["CLAUDE_PROJECT_DIR"] = str(project_dir)
    try:
        sys.stdin = StringIO(json.dumps(payload))
        buf = StringIO()
        sys.stdout = buf
        rc = mod.main()
    finally:
        sys.stdin, sys.stdout = stdin_bak, stdout_bak
        if env_bak is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = env_bak
    return rc, buf.getvalue()


_VALID_PACKET = {
    "spec_id": "FEAT-001", "dispatch_id": "d-T-001-cr-l1", "task_id": "T-001",
    "role": "code-reviewer", "status": "done", "summary": "ok",
    "evidence": [], "usage": None, "findings": [],
}


def _make_session(tmp: Path, spec_id="FEAT-001") -> Path:
    session = tmp / ".agent-session" / spec_id
    (session / "outputs").mkdir(parents=True, exist_ok=True)
    (session / "session.yml").write_text("current_owner: orchestrator\ncurrent_phase: implementation\n")
    return session


def _payload(subagent_type: str, dispatch_id: str) -> dict:
    return {
        "tool_name": "Task",
        "tool_input": {
            "subagent_type": subagent_type,
            "prompt": f"Work Packet\ndispatch_id: {dispatch_id}\ntask_id: T-001",
        },
        "tool_response": {"content": "done"},
    }


class TestVerifyDispatchPacket(unittest.TestCase):
    def setUp(self):
        self.mod = _load_main()
        self.tmp = Path(tempfile.mkdtemp())

    def test_missing_packet_emits_additional_context(self):
        _make_session(self.tmp)  # outputs/ empty -> packet missing
        rc, out = _run_main(self.mod, _payload("code-reviewer", "d-T-001-cr-l1"), self.tmp)
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        ctx = doc["hookSpecificOutput"]["additionalContext"]
        self.assertIn("d-T-001-cr-l1", ctx)
        self.assertIn("packet", ctx.lower())

    def test_valid_packet_is_silent(self):
        session = _make_session(self.tmp)
        (session / "outputs" / "d-T-001-cr-l1.json").write_text(json.dumps(_VALID_PACKET))
        rc, out = _run_main(self.mod, _payload("code-reviewer", "d-T-001-cr-l1"), self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")

    def test_invalid_packet_emits_additional_context(self):
        session = _make_session(self.tmp)
        bad = dict(_VALID_PACKET)
        del bad["status"]  # missing required field
        (session / "outputs" / "d-T-001-cr-l1.json").write_text(json.dumps(bad))
        rc, out = _run_main(self.mod, _payload("code-reviewer", "d-T-001-cr-l1"), self.tmp)
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        self.assertIn("d-T-001-cr-l1", doc["hookSpecificOutput"]["additionalContext"])

    def test_non_phase4_subagent_is_silent(self):
        _make_session(self.tmp)
        rc, out = _run_main(self.mod, _payload("Explore", "whatever"), self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")

    def test_no_dispatch_id_is_silent(self):
        _make_session(self.tmp)
        payload = {"tool_name": "Task", "tool_input": {"subagent_type": "dev", "prompt": "no id here"}}
        rc, out = _run_main(self.mod, payload, self.tmp)
        self.assertEqual(rc, 0)
        self.assertEqual(out.strip(), "")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_dispatch_packet -v`
Expected: FAIL — `verify-dispatch-packet.py` não existe (erro ao carregar via importlib).

- [ ] **Step 3: Implementar o hook**

Criar `squads/sdd/hooks/verify-dispatch-packet.py`:

```python
#!/usr/bin/env python3
"""
ai-squad PostToolUse(Task) hook — verify-dispatch-packet.

Runs in the ORCHESTRATOR session, right after each Task dispatch returns. This
is the ONLY layer that survives an abnormal subagent death (e.g. the platform's
"safety classifier unavailable" anomaly kills the subagent mid-flight, so the
SubagentStop hook — verify-output-packet.py — never fires and cannot block).

Behavior: if the just-returned dispatch is a Phase 4 role and its Output Packet
at .agent-session/<spec_id>/outputs/<dispatch_id>.json is missing OR fails the
canonical schema check, emit additionalContext naming the dispatch_id so the
orchestrator can re-dispatch (see SKILL.md steps 3/4, packet_retries cap). This
hook NEVER blocks — the Task itself "succeeded" from the tool's view; what is
missing is the artifact. The terminal safety net remains the audit gate (step 8).

Pure stdlib. Python 3.8+.
"""
import importlib.util as _ilu
import json
import re
import sys
from pathlib import Path

_HOOKS_DIR = Path(__file__).resolve().parent
if str(_HOOKS_DIR) not in sys.path:
    sys.path.insert(0, str(_HOOKS_DIR))

from hook_runtime import resolve_project_root, tool_input_dict

# Phase 4 dispatch roles that owe an Output Packet (mirrors verify-output-packet.py).
_PHASE_4_SUBAGENTS = frozenset({
    "dev", "code-reviewer", "logic-reviewer", "qa",
    "audit-agent", "committer", "blocker-specialist",
})

# Same dispatch_id token the orchestrator emits in the Work Packet prompt
# (mirrors verify-output-packet.extract_dispatch_id).
_DISPATCH_ID_RE = re.compile(r"dispatch_id:\s*[\"']?([A-Za-z0-9][A-Za-z0-9_-]{2,})")


def _load_validate_packet():
    """Load validate_packet() from verify-output-packet.py (hyphenated filename
    requires importlib). Returns the callable, or None if unavailable."""
    path = _HOOKS_DIR / "verify-output-packet.py"
    try:
        spec = _ilu.spec_from_file_location("verify_output_packet", str(path))
        if not spec or not spec.loader:
            return None
        mod = _ilu.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        return mod.validate_packet
    except Exception:
        return None


def _find_active_session(project_dir: Path) -> Path | None:
    """Most-recently-modified .agent-session/<spec_id>/ dir (mirrors
    verify-output-packet.find_active_session)."""
    sessions_root = project_dir / ".agent-session"
    if not sessions_root.is_dir():
        return None
    candidates = [p for p in sessions_root.iterdir() if p.is_dir()]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _emit_context(message: str) -> int:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": message,
        }
    }))
    return 0


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return 0  # malformed — fail silent (never block a Task)

    if payload.get("tool_name") not in (None, "Task"):
        return 0
    tool_input = tool_input_dict(payload)
    subagent_type = tool_input.get("subagent_type")
    if subagent_type not in _PHASE_4_SUBAGENTS:
        return 0  # not a Phase 4 dispatch — silent

    prompt = tool_input.get("prompt")
    if not isinstance(prompt, str):
        return 0
    m = _DISPATCH_ID_RE.search(prompt)
    if not m:
        return 0  # cannot locate dispatch_id — silent (audit remains the net)
    dispatch_id = m.group(1)

    project_dir = resolve_project_root(payload)
    session_dir = _find_active_session(project_dir)
    if session_dir is None:
        return 0  # no session to check against — silent

    packet_path = session_dir / "outputs" / f"{dispatch_id}.json"
    if not packet_path.exists():
        return _emit_context(
            f"Output Packet MISSING for dispatch_id={dispatch_id} "
            f"(role={subagent_type}) at outputs/{dispatch_id}.json. The dispatch "
            f"returned but did not persist its packet — likely an abrupt subagent "
            f"death (platform anomaly). Re-dispatch this role per SKILL.md step 4 "
            f"(increment task_states.packet_retries; cap packet_retry_max=2, then "
            f"blocked/missing_output_packet)."
        )

    validate_packet = _load_validate_packet()
    if validate_packet is None:
        return 0  # validator unavailable — defer to audit gate
    ok, reason = validate_packet(packet_path)
    if not ok:
        return _emit_context(
            f"Output Packet INVALID for dispatch_id={dispatch_id} "
            f"(role={subagent_type}): {reason}. Treat as a non-delivered artifact "
            f"and re-dispatch per SKILL.md step 4 (packet_retries; cap 2 then "
            f"blocked/missing_output_packet)."
        )
    return 0  # packet present and valid — silent


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_dispatch_packet -v`
Expected: PASS — 5 casos verdes.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/verify-dispatch-packet.py squads/sdd/hooks/__tests__/test_verify_dispatch_packet.py
git commit -m "feat(orchestrator): add PostToolUse(Task) hook detecting non-persisted Output Packets (C-1)"
```

---

### Task 5: Registrar o hook (claude-hooks.json + frontmatter + preflight)

**Files:**
- Modify: `squads/sdd/hooks/claude-hooks.json`
- Modify: `squads/sdd/skills/orchestrator/SKILL.md` (frontmatter + preflight)

Edição de config/skill — aceitação via inspeção + parse de JSON.

- [ ] **Step 1: Adicionar `PostToolUse` ao `claude-hooks.json`**

Em [`squads/sdd/hooks/claude-hooks.json`](../../../squads/sdd/hooks/claude-hooks.json), dentro de `"hooks"`, adicionar uma nova chave `"PostToolUse"` (irmã de `PreToolUse`/`Stop`/`SubagentStop`):

```json
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "[ -f \"$CLAUDE_PROJECT_DIR/.claude/hooks/verify-dispatch-packet.py\" ] || exit 0; python3 \"$CLAUDE_PROJECT_DIR/.claude/hooks/verify-dispatch-packet.py\"",
            "timeout": 10
          }
        ]
      }
    ]
```

(Inserir com vírgula correta após o array `SubagentStop`.)

- [ ] **Step 2: Validar o JSON**

Run: `python3 -c "import json; json.load(open('squads/sdd/hooks/claude-hooks.json')); print('valid')"`
Expected: `valid`.

- [ ] **Step 3: Registrar no frontmatter do orchestrator**

Em [`squads/sdd/skills/orchestrator/SKILL.md:4-28`](../../../squads/sdd/skills/orchestrator/SKILL.md), no bloco `hooks:` do frontmatter, adicionar um bloco `PostToolUse` (irmão de `PreToolUse:` e `Stop:`), mantendo o estilo dos existentes:

```yaml
  PostToolUse:
    - matcher: "Task"
      hooks:
        - type: command
          command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-dispatch-packet.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-dispatch-packet.py"'
          timeout: 10
```

Critério de dupla-registro (frontmatter + claude-hooks.json): mesmo padrão já usado por `verify-tier-calibration.py` (PreToolUse Task em ambos). O hook é read-only/informativo, então um eventual disparo duplo é inofensivo.

- [ ] **Step 4: Incluir SÓ o CLI `manifest_append.py` no preflight**

Em [`squads/sdd/skills/orchestrator/skill.md:59`](../../../squads/sdd/skills/orchestrator/skill.md), a linha `set -- verify-audit-dispatch.py ... verify-reviewer-write-path.py`. Adicionar **apenas** `manifest_append.py`:

```sh
set -- verify-audit-dispatch.py guard-session-scope.py block-git-write.py verify-tier-calibration.py verify-output-packet.py verify-reviewer-write-path.py manifest_append.py
```

Critério: o preflight protege o que é **pipeline-breaking se ausente** (skill.md:48 — "not fail-open — a missing file crashes the dispatch"). O `manifest_append.py` é CLI do qual todo append depende → entra. O `verify-dispatch-packet.py` é **fail-open/informativo** (guardado por `[ -f ] || exit 0` e retorna 0 em silêncio) — NÃO entra, espelhando o `capture-baseline.py` do Spec A, que também ficou fora do preflight por ser fail-open.

- [ ] **Step 5: Verificar**

Run: `grep -n "verify-dispatch-packet.py\|manifest_append.py" squads/sdd/skills/orchestrator/skill.md`
Expected: ≥2 ocorrências (frontmatter PostToolUse + preflight do CLI).

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/hooks/claude-hooks.json squads/sdd/skills/orchestrator/SKILL.md
git commit -m "feat(orchestrator): register verify-dispatch-packet PostToolUse hook + preflight (C-1)"
```

---

### Task 6: Orchestrator reage ao hook — re-dispatch com `packet_retries`

**Files:**
- Modify: `squads/sdd/skills/orchestrator/SKILL.md` (steps 3 e 4)

Edição de skill (prosa de protocolo) — sem teste unitário; a aceitação é a presença das regras de re-dispatch e do cap. A correção comportamental é exercitada pelos hooks/CLI já testados; aqui formaliza-se a ação do LLM.

- [ ] **Step 1: Inicializar `packet_retries` no step 1 (init de `task_states`)**

Em [`squads/sdd/skills/orchestrator/SKILL.md:115`](../../../squads/sdd/skills/orchestrator/SKILL.md) (step 1.4), a frase "Initialize `task_states` map ... (state=`pending`, loops=0, hashes=null)". Atualizar para incluir o novo contador:

```markdown
4. Initialize `task_states` map in `session.yml` with one entry per `T-XXX` (state=`pending`, review_loops=0, qa_loops=0, blocker_calls=0, packet_retries=0, hashes=null) — fresh start only; `--resume` preserves existing entries (including `packet_retries`).
```

- [ ] **Step 2: Adicionar a regra de reação ao hook no step 3 (dispatch loop)**

Em [`squads/sdd/skills/orchestrator/SKILL.md:133`](../../../squads/sdd/skills/orchestrator/SKILL.md), ao final do step 3, no ponto "When the batch returns:". Adicionar um sub-bullet ANTES de "for each Output Packet run step 4":

```markdown
- **Packet-integrity check (C-1):** after the batch returns, the `PostToolUse(Task)` hook (`verify-dispatch-packet.py`) emits `additionalContext` for any dispatch whose Output Packet did not persist or is invalid. For each such `dispatch_id`, run the packet-retry handling in step 4 BEFORE merging state — a missing packet means there is no state to merge yet.
```

- [ ] **Step 3: Adicionar o bloco de packet-retry ao step 4**

Em [`squads/sdd/skills/orchestrator/SKILL.md:143`](../../../squads/sdd/skills/orchestrator/SKILL.md), logo após a linha "After every Subagent return: atomically update `session.yml.task_states[T-XXX]` (tmp + rename)." Inserir uma nova subseção:

```markdown
**Packet-retry handling (C-1 — missing/invalid Output Packet).** When `verify-dispatch-packet.py` flags a `dispatch_id` (packet missing or invalid after the Task returned — typically an abrupt subagent death from a platform anomaly):
1. Increment `task_states[T-XXX].packet_retries` (atomic write). This counter is SEPARATE from `review_loops`/`qa_loops` — a non-delivered artifact is an infra failure, not code difficulty; it must not consume the review budget.
2. If `packet_retries <= packet_retry_max` (=2): re-dispatch the SAME role for the SAME task with a NEW `dispatch_id` (new loop suffix), append the new dispatch to the manifest via `manifest_append.py`, and dispatch the `Task`. Applies to EVERY role, including `dev` — dev is already re-dispatched in review loops and re-reads current state; any half-applied edit is caught downstream by reviewers/qa/baseline.
3. If `packet_retries > packet_retry_max`: mark the task `blocked` (terminal) with `blocker_kind: missing_output_packet`. Do NOT cascade to blocker-specialist (the artifact never landed — there is nothing to analyze). The audit gate (step 8) will see it; recovery is `--restart` + human review.

`packet_retries` does NOT count toward `review_loops_max`, `qa_loops_max`, or progress-stall detection.
```

- [ ] **Step 4: Verificar**

Run: `grep -n "packet_retries\|packet_retry_max\|Packet-integrity\|Packet-retry" squads/sdd/skills/orchestrator/SKILL.md`
Expected: ≥5 ocorrências cobrindo init, step 3 e step 4.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/skills/orchestrator/SKILL.md
git commit -m "feat(orchestrator): re-dispatch on non-persisted packet with packet_retries cap (C-1)"
```

---

## Finalização

### Task 7: Sincronizar a cópia empacotada e validar drift

**Files:**
- Modify (gerado): `packages/cli/components/sdd/...`

`npm run sync` (sync-components.mjs) copia `squads/sdd/{hooks,skills,...}` para `packages/cli/components/sdd/`, excluindo `__tests__/`. Os arquivos novos (`manifest_append.py`, `verify-dispatch-packet.py`) e as edições de skill/config são replicados automaticamente.

- [ ] **Step 1: Rodar o sync**

Run: `cd packages/cli && npm run sync`
Expected: sync sem erro; novos arquivos aparecem em `packages/cli/components/sdd/hooks/`.

- [ ] **Step 2: Confirmar que os arquivos novos foram copiados**

Run: `ls packages/cli/components/sdd/hooks/manifest_append.py packages/cli/components/sdd/hooks/verify-dispatch-packet.py && python3 -c "import json; json.load(open('packages/cli/components/sdd/hooks/claude-hooks.json'))['hooks']['PostToolUse']; print('PostToolUse present')"`
Expected: ambos os arquivos existem; `PostToolUse present`.

- [ ] **Step 3: Rodar o teste de consistência de templates**

Run: `cd packages/cli && npm test`
Expected: a suíte (incl. `template-consistency.test.js`) passa — nenhum drift introduzido.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/components/sdd
git commit -m "chore(cli): sync packaged components for Phase 4 write-integrity hooks"
```

---

### Task 8: Suíte completa de testes Python

**Files:** nenhum (verificação).

- [ ] **Step 1: Rodar todos os testes de hooks**

Run: `python3 -m unittest discover -s squads/sdd/hooks/__tests__ -p "test_*.py" -v`
Expected: toda a suíte verde, incluindo os dois novos arquivos de teste e o pré-existente `test_pm_shared.py` (regressão do `atomic_manifest_mutate`).

- [ ] **Step 2: Confirmar que nada do existente quebrou**

Run: `python3 -m unittest squads.sdd.hooks.__tests__.test_verify_output_packet squads.sdd.hooks.__tests__.test_pm_shared -v`
Expected: PASS — o hook `SubagentStop` (camada 1) e o `atomic_manifest_mutate` seguem íntegros.

---

## Self-Review (cobertura do spec)

| Requisito do spec | Task que implementa |
|---|---|
| C-2: CLI `manifest_append.py` envelopando `atomic_manifest_mutate` | Task 1 |
| C-2: orchestrator para de editar manifesto na mão | Task 2 |
| C-1: campo `packet_retries` em `task_states` | Task 3 |
| C-1: hook `PostToolUse(Task)` de detecção (faltante=inválido) | Task 4 |
| C-1: registro do hook (claude-hooks.json + frontmatter + preflight) | Task 5 |
| C-1: re-dispatch, contador próprio, teto 2, blocked terminal | Task 6 |
| C-1: retry uniforme (inclusive dev) | Task 6 (step 3, bullet 2) |
| Cópia empacotada replicada | Task 7 |
| Camadas 1 (SubagentStop) e 3 (audit) preservadas | Task 8 (regressão) |
| `--resume` preserva `packet_retries` | Task 3 (doc) + Task 6 (step 1) |

**Não coberto deliberadamente:** o caso de borda "orchestrator ignora o aviso do hook" não tem task própria — é coberto pela rede terminal já existente (audit gate, step 8), que o spec marca como Camada 3. Nenhuma mudança nova é necessária ali.
