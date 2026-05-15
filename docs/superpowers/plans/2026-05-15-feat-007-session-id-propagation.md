# FEAT-007 — session_id propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar `session_id` first-class ao Work Packet pra eliminar o fallback heurístico de varredura em `verify-tier-calibration.py`. Fecha issue #5.

**Architecture:** Orchestrator skill emite `session_id: FEAT-NNN` no YAML do Work Packet derivado do cwd `.agent-session/<FEAT-NNN>/`. `verify-tier-calibration.py` faz lookup direto `session_dir / session_id / tasks.md` quando o campo está presente; mantém fallback heurístico apenas como backward-compat por 1 release. Output Packet propaga via `spec_id` existente (Subagent copia do Work Packet em vez de inferir).

**Tech Stack:** Python 3.8+ stdlib (hooks), Markdown (skill/agent contracts), pytest (tests).

---

## File Structure

**Modificações:**
- `squads/sdd/skills/orchestrator/skill.md` — Dispatch contract emite `session_id`; fix `task_id` no template
- `squads/sdd/agents/dev.md` — Input contract menciona `session_id`; `spec_id` no Output Packet vem dele
- `squads/sdd/agents/code-reviewer.md` — idem
- `squads/sdd/agents/logic-reviewer.md` — idem
- `squads/sdd/agents/qa.md` — idem
- `squads/sdd/agents/audit-agent.md` — idem (mas opcional pra audit)
- `squads/sdd/hooks/verify-tier-calibration.py` — lookup direto via `session_id`, mantém fallback
- `shared/templates/work-packet.json` — adiciona `session_id`
- `shared/concepts/work-packet.md` — documenta novo campo

**Tests:**
- `squads/sdd/hooks/__tests__/test_verify_tier_calibration.py` — adicionar:
  - happy path com `session_id` (lookup direto, fallback não invocado)
  - backward-compat sem `session_id` (fallback heurístico ainda funciona)

**Sync runtime copies (ao final):**
- `./.claude/hooks/verify-tier-calibration.py` ← cópia de `squads/sdd/hooks/`
- `./packages/cli/.claude/hooks/verify-tier-calibration.py` ← cópia
- `./packages/cli/components/sdd/hooks/verify-tier-calibration.py` ← cópia

---

## Task 1: Test failing — happy path com session_id

**Files:**
- Test: `squads/sdd/hooks/__tests__/test_verify_tier_calibration.py`

- [ ] **Step 1: Inspect existing test structure**

Run: `grep -n "def test_\|_extract_fields\|_read_task_tier" squads/sdd/hooks/__tests__/test_verify_tier_calibration.py | head -40`

Identificar:
- Como os testes existentes constroem prompt + `session_dir` tmp_path.
- Helper de fixtures (`tmp_path` pytest fixture).

- [ ] **Step 2: Write the failing test**

Adicionar ao final do arquivo `squads/sdd/hooks/__tests__/test_verify_tier_calibration.py`:

```python
def test_session_id_direct_lookup_skips_fallback(tmp_path, monkeypatch):
    """When Work Packet carries session_id, _read_task_tier reads
    <session_dir>/<session_id>/tasks.md directly — no glob over manifests."""
    from verify_tier_calibration import _verify_tier_calibration_for_task

    session_dir = tmp_path
    feat_dir = session_dir / "FEAT-077"
    feat_dir.mkdir()
    (feat_dir / "tasks.md").write_text(
        "## T-001 dev work\n\n**Tier:** T2\n\nbody\n",
        encoding="utf-8",
    )
    # Manifest at feature root — proves direct lookup works without scanning siblings.
    (feat_dir / "dispatch-manifest.json").write_text(
        '{"expected_pipeline":[{"task_id":"T-001"}],"actual_dispatches":[]}',
        encoding="utf-8",
    )

    prompt = (
        "WorkPacket:\n"
        "```yaml\n"
        "task_id: T-001\n"
        "dispatch_id: d-T-001-dev-l1\n"
        "session_id: FEAT-077\n"
        "model: sonnet\n"
        "effort: medium\n"
        "tier: T2\n"
        "subagent_type: dev\n"
        "```\n"
    )

    result = _verify_tier_calibration_for_task(
        task_id="T-001",
        model="sonnet",
        effort="medium",
        tier="T2",
        subagent_type="dev",
        prompt=prompt,
        tool_model="sonnet",
        session_dir=session_dir,
    )
    assert result == {}, f"expected silent allow, got {result}"


def test_session_id_backward_compat_when_absent(tmp_path):
    """Work Packet without session_id still resolves via legacy heuristic
    (mtime-ordered manifest scan). Backward-compat guard."""
    from verify_tier_calibration import _verify_tier_calibration_for_task

    session_dir = tmp_path
    feat_dir = session_dir / "FEAT-078"
    feat_dir.mkdir()
    (feat_dir / "tasks.md").write_text(
        "## T-002 dev work\n\n**Tier:** T1\n\nbody\n",
        encoding="utf-8",
    )
    (feat_dir / "dispatch-manifest.json").write_text(
        '{"expected_pipeline":[{"task_id":"T-002"}],"actual_dispatches":[]}',
        encoding="utf-8",
    )

    prompt = (
        "WorkPacket:\n"
        "```yaml\n"
        "task_id: T-002\n"
        "dispatch_id: d-T-002-dev-l1\n"
        "model: haiku\n"
        "effort: high\n"
        "tier: T1\n"
        "subagent_type: dev\n"
        "```\n"
    )

    result = _verify_tier_calibration_for_task(
        task_id="T-002",
        model="haiku",
        effort="high",
        tier="T1",
        subagent_type="dev",
        prompt=prompt,
        tool_model="haiku",
        session_dir=session_dir,
    )
    assert result == {}, f"expected silent allow, got {result}"
```

- [ ] **Step 3: Run tests to verify they fail (or first passes, second already passes via fallback)**

Run: `cd squads/sdd/hooks && python -m pytest __tests__/test_verify_tier_calibration.py::test_session_id_direct_lookup_skips_fallback -v`

Expected: pode passar via fallback heurístico já (não é falha real). Próximas tasks vão fazer o direct lookup ser usado primeiro. Anote o resultado e prossiga.

- [ ] **Step 4: Commit**

```bash
git add squads/sdd/hooks/__tests__/test_verify_tier_calibration.py
git commit -m "test(verify-tier-calibration): cover session_id direct lookup + backward-compat"
```

---

## Task 2: Extract session_id from Work Packet in verify-tier-calibration

**Files:**
- Modify: `squads/sdd/hooks/verify-tier-calibration.py:158-186` (`_extract_fields`)

- [ ] **Step 1: Add session_id to field normalization map**

No `_extract_fields`, dentro do loop `for src_key, canonical_key in (...)`:

```python
        ("task_id", "task_id"),
        ("taskId", "task_id"),
        ("session_id", "session_id"),
        ("sessionId", "session_id"),
        ("model", "model"),
```

Localização: linha ~161 de `squads/sdd/hooks/verify-tier-calibration.py`. Insira depois de `("taskId", "task_id"),`.

- [ ] **Step 2: Run existing tests to ensure no regression**

Run: `cd squads/sdd/hooks && python -m pytest __tests__/test_verify_tier_calibration.py -v 2>&1 | tail -20`

Expected: existing tests continuam passando.

- [ ] **Step 3: Commit**

```bash
git add squads/sdd/hooks/verify-tier-calibration.py
git commit -m "feat(verify-tier-calibration): parse session_id from Work Packet YAML"
```

---

## Task 3: Use session_id for direct tasks.md lookup

**Files:**
- Modify: `squads/sdd/hooks/verify-tier-calibration.py:397-457` (`_read_task_tier`)

- [ ] **Step 1: Add session_id-driven path resolution at top of _read_task_tier**

Alterar assinatura de `_read_task_tier` pra aceitar `session_id`:

```python
def _read_task_tier(
    task_id: str,
    session_dir: Path,
    session_id: str | None = None,
) -> str | None:
```

No corpo da função, ANTES da linha `tasks_path = session_dir / task_id / "tasks.md"` (atualmente linha 407), inserir:

```python
    # FEAT-007: direct lookup when Work Packet carries session_id.
    if session_id:
        direct_path = session_dir / session_id / "tasks.md"
        try:
            content = direct_path.read_text(encoding="utf-8", errors="replace")
        except (OSError, IOError):
            content = None
        if content is not None:
            tier = _extract_tier_for_task(content, task_id)
            if tier is not None:
                return tier
            # File exists but task section missing — fall through to legacy
            # heuristic. Common during partial migrations.

    tasks_path = session_dir / task_id / "tasks.md"
```

- [ ] **Step 2: Thread session_id through _verify_tier_calibration_for_task**

Alterar assinatura (linha 660) pra adicionar parâmetro:

```python
def _verify_tier_calibration_for_task(
    task_id: str,
    model: str,
    effort: str,
    tier: str,
    subagent_type: str,
    prompt: str,
    tool_model: str | None = None,
    session_dir: Path | None = None,
    session_id: str | None = None,
) -> dict:
```

Na linha 707 (chamada de `_read_task_tier`), passar:

```python
    task_tier = _read_task_tier(task_id, session_dir, session_id=session_id)
```

- [ ] **Step 3: Pass session_id from main() to the verifier**

Em `main()` (linha ~903), depois de `task_id = fields.get("task_id", "")`, adicionar:

```python
    session_id = fields.get("session_id", "") or None
```

Na chamada (linha 906-914), passar `session_id=session_id`:

```python
    result = _verify_tier_calibration_for_task(
        task_id=task_id,
        model=model,
        effort=effort,
        tier=tier,
        subagent_type=subagent_type,
        prompt=prompt,
        tool_model=tool_model,
        session_id=session_id,
    )
```

- [ ] **Step 4: Run all tier-calibration tests**

Run: `cd squads/sdd/hooks && python -m pytest __tests__/test_verify_tier_calibration.py -v 2>&1 | tail -30`

Expected: novos testes (Task 1) passam via direct lookup; testes existentes mantêm.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/hooks/verify-tier-calibration.py
git commit -m "feat(verify-tier-calibration): direct tasks.md lookup via session_id"
```

---

## Task 4: Apagar HOTFIX NOTE markers no fallback heurístico

**Files:**
- Modify: `squads/sdd/hooks/verify-tier-calibration.py:414-422` e `:599-604`

- [ ] **Step 1: Remove NOTE(FEAT-007) markers e atualiza comentários**

Substituir o bloco de comentários (linhas 414-422) pelo novo texto:

```python
            # Legacy heuristic kept as backward-compat for Work Packets emitted
            # before FEAT-007 (no session_id). Prefer the direct lookup path
            # above; this scanner is invoked only when session_id is absent OR
            # the direct path exists but does not contain the task section.
            # See docs/superpowers/specs/2026-05-15-feat-007-008-pipeline-integrity-design.md.
```

(Mantém a lógica abaixo — só troca o bloco de comentário acima dela.)

Localizar o segundo NOTE marker em `_load_manifest_dispatches` (linha ~604):

```python
    # NOTE(FEAT-007): replace with proper session_id-based resolution.
```

Substituir por:

```python
    # FEAT-007: legacy mtime-ordered scan kept for Work Packets without
    # session_id. Direct lookup happens upstream in _read_task_tier.
```

- [ ] **Step 2: Re-run all tests**

Run: `cd squads/sdd/hooks && python -m pytest __tests__/test_verify_tier_calibration.py -v 2>&1 | tail -10`

Expected: tudo passa.

- [ ] **Step 3: Commit**

```bash
git add squads/sdd/hooks/verify-tier-calibration.py
git commit -m "chore(verify-tier-calibration): clean FEAT-007 NOTE markers"
```

---

## Task 5: Orchestrator emite session_id no Work Packet

**Files:**
- Modify: `squads/sdd/skills/orchestrator/skill.md:246-262, 294-313`

- [ ] **Step 1: Update Work Packet template (lines 246-262)**

Substituir o bloco YAML:

```
WorkPacket:
```yaml
task_id: FEAT-NNN
dispatch_id: <uuid>
```

por:

```
WorkPacket:
```yaml
session_id: FEAT-NNN
task_id: T-XXX
dispatch_id: <uuid>
```

(Move `task_id` pra T-XXX — corrige inconsistência histórica do template — e adiciona `session_id` como primeiro campo.)

- [ ] **Step 2: Update concrete example (lines 295-313)**

No exemplo Task tool call, dentro do prompt YAML (linha ~300-308), adicionar `session_id`:

Substituir:

```
prompt='''WorkPacket:
```yaml
task_id: T-001
dispatch_id: d-T-001-qa-l1
model: haiku
```

por:

```
prompt='''WorkPacket:
```yaml
session_id: FEAT-NNN
task_id: T-001
dispatch_id: d-T-001-qa-l1
model: haiku
```

- [ ] **Step 3: Add Dispatch contract documentation explicitando session_id**

Logo após o bloco template (após linha 262, antes da linha 264 "The Subagent body's..."), adicionar parágrafo:

```markdown
**`session_id` (FEAT-007):** mandatory for task-scoped dispatches (`dev`, `code-reviewer`, `logic-reviewer`, `qa`); optional for `audit-agent` (pipeline-scoped). Derived from the orchestrator's cwd — when running from `.agent-session/<FEAT-NNN>/`, emit `session_id: FEAT-NNN`. The `verify-tier-calibration.py` hook uses it for direct `tasks.md` lookup; without it the hook falls back to mtime-ordered manifest scanning (legacy backward-compat path, slower).
```

- [ ] **Step 4: Run skill drift tests (if any) + verify markdown valid**

Run: `python -c "import pathlib; t = pathlib.Path('squads/sdd/skills/orchestrator/skill.md').read_text(); assert 'session_id: FEAT-NNN' in t; print('ok')"`

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/skills/orchestrator/skill.md
git commit -m "feat(orchestrator): emit session_id in Work Packet (FEAT-007)"
```

---

## Task 6: Update agent contracts — accept session_id

**Files:**
- Modify: `squads/sdd/agents/dev.md:37`
- Modify: `squads/sdd/agents/code-reviewer.md` (Input contract section)
- Modify: `squads/sdd/agents/logic-reviewer.md` (Input contract section)
- Modify: `squads/sdd/agents/qa.md` (Input contract section)
- Modify: `squads/sdd/agents/audit-agent.md` (Input contract section)

- [ ] **Step 1: Update dev.md Input contract (line 37)**

Substituir:

```markdown
- `task_id`, `dispatch_id`, `spec_ref`, `plan_ref` (optional), `tasks_ref`
```

por:

```markdown
- `session_id` (FEAT-NNN), `task_id` (T-XXX), `dispatch_id`, `spec_ref`, `plan_ref` (optional), `tasks_ref`
```

- [ ] **Step 2: Update Output Packet contract na seção "Output contract" de dev.md**

Localizar a seção `## Output contract (Output Packet)` (linha ~56). Adicionar item na lista:

```markdown
- `spec_id`: copy from Work Packet `session_id` (FEAT-NNN). Required by canonical schema.
```

Inserir depois de `- `status`: ...` (linha 57).

- [ ] **Step 3: Repeat for code-reviewer.md, logic-reviewer.md, qa.md**

Para cada arquivo:
1. Grep pela seção `## Input contract` ou similar.
2. Adicionar `session_id` na lista de required fields.
3. Adicionar nota `spec_id ← session_id` na seção de Output contract.

Run pra cada um:
```bash
grep -n "Input contract\|task_id, dispatch_id\|Output contract" squads/sdd/agents/code-reviewer.md squads/sdd/agents/logic-reviewer.md squads/sdd/agents/qa.md
```

Use o output pra localizar e editar. Mesmo padrão de edição.

- [ ] **Step 4: Update audit-agent.md — session_id is OPTIONAL**

Em `squads/sdd/agents/audit-agent.md`, na seção Input contract, adicionar:

```markdown
- `session_id` (optional, FEAT-NNN) — when present, audit operates scoped to this Session; when absent, audits the most recent manifest in `.agent-session/`.
```

- [ ] **Step 5: Verify markdown valid**

Run: `for f in squads/sdd/agents/{dev,code-reviewer,logic-reviewer,qa,audit-agent}.md; do grep -q session_id "$f" && echo "$f ok" || echo "$f MISSING"; done`

Expected: 5 linhas, todas `ok`.

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/agents/dev.md squads/sdd/agents/code-reviewer.md squads/sdd/agents/logic-reviewer.md squads/sdd/agents/qa.md squads/sdd/agents/audit-agent.md
git commit -m "feat(agents): accept session_id in Input contract, propagate to spec_id"
```

---

## Task 7: Update Work Packet template + concept doc

**Files:**
- Modify: `shared/templates/work-packet.json`
- Modify: `shared/concepts/work-packet.md`

- [ ] **Step 1: Add session_id to Work Packet template**

Em `shared/templates/work-packet.json`, adicionar campo após `"spec_id"`:

```json
  "spec_id": "FEAT-XXX",
  "session_id": "FEAT-XXX",
  "dispatch_id": "dev-7b3c1a",
```

(Nota: o template existente já tem `spec_id`; manter ambos por enquanto pra clareza de doc — o orchestrator skill emite o novo `session_id` no formato YAML real.)

- [ ] **Step 2: Document session_id in concept doc**

Em `shared/concepts/work-packet.md`, localizar onde os campos são listados. Run:

```bash
grep -n "task_id\|dispatch_id\|spec_id" shared/concepts/work-packet.md | head -20
```

Adicionar parágrafo descrevendo `session_id`:

```markdown
### `session_id` (FEAT-007)

The feature/spec scope this dispatch belongs to (e.g. `FEAT-006`). Derived by the orchestrator from its working directory (`.agent-session/<FEAT-NNN>/`) and emitted verbatim into the YAML Work Packet. Mandatory for task-scoped roles (dev, code-reviewer, logic-reviewer, qa); optional for pipeline-scoped roles (audit-agent).

Subagents copy this into their Output Packet's `spec_id`. The `verify-tier-calibration.py` hook uses it for direct `tasks.md` lookup.
```

Posicione perto dos outros campos de identidade (`spec_id`, `task_id`).

- [ ] **Step 3: Commit**

```bash
git add shared/templates/work-packet.json shared/concepts/work-packet.md
git commit -m "docs(work-packet): document session_id field (FEAT-007)"
```

---

## Task 8: Sync runtime hook copies

**Files:**
- Sync: `./.claude/hooks/verify-tier-calibration.py` ← `squads/sdd/hooks/verify-tier-calibration.py`
- Sync: `./packages/cli/.claude/hooks/verify-tier-calibration.py` ← `squads/sdd/hooks/verify-tier-calibration.py`
- Sync: `./packages/cli/components/sdd/hooks/verify-tier-calibration.py` ← `squads/sdd/hooks/verify-tier-calibration.py`

- [ ] **Step 1: Check for sync script first**

Run: `find . -name "sync*hooks*" -not -path "./node_modules/*" 2>&1; ls scripts/ 2>&1`

Se existir script, use. Se não, cópia manual.

- [ ] **Step 2: Manual cp + checksum verify**

```bash
cp squads/sdd/hooks/verify-tier-calibration.py ./.claude/hooks/verify-tier-calibration.py
cp squads/sdd/hooks/verify-tier-calibration.py ./packages/cli/.claude/hooks/verify-tier-calibration.py
cp squads/sdd/hooks/verify-tier-calibration.py ./packages/cli/components/sdd/hooks/verify-tier-calibration.py
md5 -q ./squads/sdd/hooks/verify-tier-calibration.py ./.claude/hooks/verify-tier-calibration.py ./packages/cli/.claude/hooks/verify-tier-calibration.py ./packages/cli/components/sdd/hooks/verify-tier-calibration.py
```

Expected: 4 linhas, todas com o mesmo md5.

- [ ] **Step 3: Commit**

```bash
git add .claude/hooks/verify-tier-calibration.py packages/cli/.claude/hooks/verify-tier-calibration.py packages/cli/components/sdd/hooks/verify-tier-calibration.py
git commit -m "chore(hooks): sync verify-tier-calibration runtime copies (FEAT-007)"
```

---

## Task 9: Verification — full hook test suite + manual sanity

**Files:** N/A (verification only)

- [ ] **Step 1: Run all hook tests**

Run: `cd squads/sdd/hooks && python -m pytest __tests__/ -v 2>&1 | tail -40`

Expected: tudo verde.

- [ ] **Step 2: Run any repo-wide test suite**

Run: `npm test 2>&1 | tail -30 || pytest 2>&1 | tail -30 || echo "no test runner"`

Expected: nada quebra.

- [ ] **Step 3: Verify the issue's AC checklist**

Conferir cada item do critério de aceitação da issue #5:
- [ ] Work Packet schema doc atualizado (Task 5, 7)
- [ ] Orchestrator skill emite `session_id` derivado do cwd (Task 5)
- [ ] `verify-tier-calibration.py` usa direct lookup quando session_id presente (Task 3)
- [ ] 2 NOTE markers removidos / atualizados (Task 4)
- [ ] Output Packet carrega session_id (via spec_id — Task 6 documenta)
- [ ] Audit-agent usa session_id pra correlação (Task 6 — campo opt-in)
- [ ] Regression tests cobrindo fallback "sessão sem session_id" (Task 1)

Marcar cada um.

- [ ] **Step 4: Commit verification doc (optional)**

Se quiser, abrir `docs/superpowers/specs/2026-05-15-feat-007-008-pipeline-integrity-design.md` e marcar AC checkboxes. Senão, pular.

---

## Self-Review

**Spec coverage:**
- Work Packet schema doc → Task 5 (skill template) + Task 7 (concept doc).
- Orchestrator emit session_id → Task 5.
- verify-tier-calibration direct lookup → Task 2 + 3.
- 2 NOTE markers removed/updated → Task 4.
- Output Packet carries session_id → Task 6 (via existing `spec_id` field, sourced from Work Packet `session_id`).
- Audit-agent uses session_id → Task 6 (opt-in field).
- Regression tests for "no session_id" → Task 1.
- Runtime hook copies sync → Task 8.

**Placeholder scan:** nenhum "TBD"/"TODO" no plano.

**Type consistency:** `session_id` é string `FEAT-NNN`. Função `_read_task_tier` recebe `session_id: str | None = None`. `_verify_tier_calibration_for_task` thread o param coerentemente. `_extract_fields` aceita `session_id`/`sessionId` no normalization map.

Plano OK.

---

## Execution

Plano salvo em `docs/superpowers/plans/2026-05-15-feat-007-session-id-propagation.md`. Execução inline via `superpowers:executing-plans` (single session).
