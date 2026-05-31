# Output Locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer toda prosa human-facing gerada pelos agentes do ai-squad sair num idioma configurável (`output_locale`, BCP-47), com fallback `en`, sem cravar idioma no conteúdo; e reverter os rótulos fixos do report para inglês canônico.

**Architecture:** `session.yml` é a fonte única (`output_locale`, ex. `pt-BR`). O spec-writer detecta da conversa + confirma na Phase 1 e grava lá. O orchestrator copia o valor para o bloco estável do Work Packet de cada dispatch e gera `handoff.md` no idioma. Cada subagent lê o campo e escreve sua prosa nesse idioma (regra no `.md`, renderizando a tag para nome explícito). O Output Packet não ganha campo. O `session_report.py` tem suas strings fixas revertidas para inglês — o conteúdo dinâmico já chega localizado nos packets.

**Tech Stack:** Markdown (concepts/skills/agents), YAML/JSON (templates), Python stdlib (`session_report.py` + pytest).

---

## Notas de execução (ler antes de começar)

- **Edições manuais.** O ai-squad não roda o próprio SDD; tudo via Read/Edit/Write.
- **Fonte vs. deploy.** A fonte dos hooks é `squads/sdd/hooks/`. As cópias em `.claude/hooks/` e `packages/cli/.claude/hooks/` são artefatos de deploy — NÃO editar à mão; são regeneradas por `ai-squad deploy`. Os testes importam de `squads/sdd/hooks/`, então testar a fonte é o correto.
- **`output_locale` é Work-Packet-only.** Não é adicionado ao Output Packet (preserva `additionalProperties: false` em `verify-output-packet.py`).
- **Formato canônico:** BCP-47 com hífen (`pt-BR`). Underscore (`pt_BR`) é não-canônico — normalizar para hífen.
- **Fallback:** ausente/desconhecido → `en`.
- **Não commitar com `Co-Authored-By`.** Branch antes de commitar (estamos em `main`).

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `shared/concepts/output-locale.md` | Doc canônico do conceito (regra, escopo, formato, fallback, render-to-instruction) | Criar |
| `shared/concepts/work-packet.md` | Schema do Work Packet ganha `output_locale` | Modificar |
| `shared/concepts/output-packet.md` | Cross-ref: prosa segue locale; enums canônicos | Modificar |
| `shared/concepts/session.md` | Documenta `output_locale` no estado da Session | Modificar |
| `shared/templates/session.yml` | Campo `output_locale` com comentário | Modificar |
| `shared/templates/work-packet.json` | Campo `output_locale` | Modificar |
| `squads/sdd/skills/spec-writer/skill.md` | Passo de detecção + confirmação; grava em session.yml | Modificar |
| `squads/sdd/skills/orchestrator/skill.md` | Lê locale; injeta no bloco estável do WP; handoff no idioma | Modificar |
| `squads/sdd/agents/{dev,code-reviewer,logic-reviewer,qa,blocker-specialist,audit-agent}.md` | Regra "Output language" + campo no Input contract | Modificar (×6) |
| `squads/sdd/hooks/session_report.py` | Reverter strings fixas pt-BR → inglês | Modificar |
| `squads/sdd/hooks/__tests__/test_session_report_redesign.py` | Assertions de chrome viram inglês | Modificar |

---

## Task 1: Concept doc canônico + cross-refs

**Files:**
- Create: `shared/concepts/output-locale.md`
- Modify: `shared/concepts/work-packet.md` (tabela do schema top-level, após a linha do campo `effort`)
- Modify: `shared/concepts/output-packet.md` (nova subseção após "summary format rules")
- Modify: `shared/concepts/session.md` (documentar o campo)

- [ ] **Step 1: Criar `shared/concepts/output-locale.md`**

Conteúdo completo do arquivo:

```markdown
# Concept — `output_locale`

> Status: canonical. Companion to [`work-packet.md`](work-packet.md), [`output-packet.md`](output-packet.md), [`session.md`](session.md). Governs the language of all human-facing prose produced by Roles.

## Definition

`output_locale` is a single per-Session value that determines the **language of
every piece of free prose a Role generates for eventual human reading**. It is a
BCP-47 language tag (e.g. `pt-BR`, `en-US`, `es-ES`), stored once in
`session.yml`, and carried to each stateless Subagent via the Work Packet.

It does NOT translate machine tokens. Enums (`status`, `severity`, `kind`,
`role`, `blocker_kind`) and identifiers (`spec_id`, `task_id`, AC refs,
`dispatch_id`, file paths) stay canonical (English) — the orchestrator routes on
them, and the report keys CSS/lookup on them.

## The rule

> **Every field a Role writes as free prose for eventual human reading follows
> `output_locale`. Machine tokens do not.**

- **Follow the locale:** `summary`, `findings[].rationale`/`message`,
  `blockers[].reason`/`what_was_attempted`/`what_is_needed`, `notes`,
  `evidence[].reason`, and the orchestrator's `handoff.md`.
- **Stay canonical (English):** the enums and identifiers listed above.
- **AC text:** authored by the human in Phase 1 (already in their language); no
  Role translates it. A Role that paraphrases an AC inside a finding does so in
  the locale via the prose rule. The AC ref is an identifier and stays canonical.

## Format

BCP-47 with a hyphen separator: `pt-BR`, `en-US`, `es`. Underscore (`pt_BR`) is
non-canonical — normalize to hyphen at write time (spec-writer). A bare language
subtag (`en`, `pt`) is valid when region is irrelevant.

## Render the tag to an explicit instruction

A Role MUST NOT assume the model parses the raw tag. Each Role's prompt renders
the tag into an explicit language instruction — e.g. `pt-BR` → "Write all
human-facing prose in Brazilian Portuguese (pt-BR)." The tag is the stable stored
key; the rendered sentence is what steers generation.

## Fallback

When `output_locale` is absent or unreadable (legacy Sessions created before this
field; detection failure), the value is **`en`**, deterministically. This is a
documented, overridable neutral default — not a project-language assumption.
English is also already the canonical language of the enum/identifier layer.
Read-compat mirrors the `pipeline_mode` pattern: readers default on absence.

## Where it lives and flows

- **Source of truth:** `session.yml.output_locale`. Acquired by `spec-writer`
  (Phase 1) — detected from the conversation, confirmed with the human, written.
- **To Subagents:** the orchestrator copies it into the **stable block** of every
  Work Packet (cache-friendly prefix). Subagents read it and apply the rule.
- **To `handoff.md`:** the orchestrator (an LLM Skill) reads it from `session.yml`
  and writes the handoff prose directly in the locale.
- **To the HTML report (`session_report.py`):** NOT consumed. The report's fixed
  labels are English (tool chrome); the dynamic agent prose embedded in it already
  arrives localized from the Output Packets — the stdlib generator just passes it
  through (it has no LLM and cannot translate).

## Why this design and not alternatives

- **Single value in `session.yml` vs. per-dispatch detection:** Phase 4 Subagents
  are stateless and have no conversation to detect from; the value must be
  persisted once and carried.
- **Work Packet field vs. `constraints`/`project_context`:** a dedicated field is
  structured and auditable; `constraints` is stringly-typed; `project_context` is
  about the host stack, not output preference.
- **English fallback vs. re-detect:** re-detecting from already-English prose is
  circular; a deterministic floor is the whole point.
- **Fixed-English report chrome vs. a message catalog:** a catalog is a lot of i18n
  machinery for low value right now; English chrome is the neutral canonical. A
  configurable catalog is a registered future evolution.
```

- [ ] **Step 2: Verificar o arquivo criado**

Run: `test -f shared/concepts/output-locale.md && grep -c "output_locale" shared/concepts/output-locale.md`
Expected: imprime um número ≥ 5 (arquivo existe e cita o campo).

- [ ] **Step 3: Adicionar `output_locale` à tabela do schema em `work-packet.md`**

Em `shared/concepts/work-packet.md`, na tabela "Top-level schema", logo após a linha do campo `effort` (a linha que começa com `| `effort` |`), inserir esta nova linha:

```markdown
| `output_locale` | string | no | BCP-47 tag (`pt-BR`) for the language of human-facing prose this dispatch emits (`summary`, `findings`, `blockers`, `notes`, `evidence.reason`). Absent → `en`. See [`output-locale.md`](output-locale.md). Lives in the Work Packet's **stable block** (same across all dispatches in a Session). |
```

- [ ] **Step 4: Adicionar subseção em `output-packet.md`**

Em `shared/concepts/output-packet.md`, imediatamente após o fim da seção `## summary format rules` (antes de `## next_role semantics`), inserir:

```markdown
## Human-facing prose follows `output_locale`

The free-prose fields a Subagent writes for eventual human reading — `summary`,
`findings[].rationale`/`message`, `blockers[].*`, `notes`, `evidence[].reason` —
are written in the Session's `output_locale` (see [`output-locale.md`](output-locale.md)).
The enums (`status`, `severity`, `kind`, `role`, `blocker_kind`) and identifiers
stay canonical (English): the orchestrator routes on them and must never parse a
translated value. `output_locale` is carried in the Work Packet, not echoed back
in the Output Packet — the packet schema is unchanged.
```

- [ ] **Step 5: Documentar o campo em `session.md`**

Em `shared/concepts/session.md`, localizar a seção que descreve os campos de identificação/estado do `session.yml` (onde `pipeline_mode` é documentado) e adicionar um parágrafo. Run para achar a âncora:

Run: `grep -n "pipeline_mode" shared/concepts/session.md`
Então, logo após o bloco que documenta `pipeline_mode`, inserir:

```markdown
- **`output_locale`** (string, optional; default `en`): BCP-47 tag for the
  language of all human-facing prose the Roles emit (see
  [`output-locale.md`](output-locale.md)). Set by `spec-writer` (Phase 1) from the
  conversation, confirmed with the human. Read by the orchestrator (carried into
  each Work Packet's stable block and used to write `handoff.md`). Absent on legacy
  Sessions → readers default to `en`.
```

- [ ] **Step 6: Verificar cross-refs**

Run: `grep -l "output-locale.md" shared/concepts/*.md`
Expected: lista `output-packet.md`, `session.md`, `work-packet.md` (e o próprio `output-locale.md`).

- [ ] **Step 7: Commit**

```bash
git add shared/concepts/output-locale.md shared/concepts/work-packet.md shared/concepts/output-packet.md shared/concepts/session.md
git commit -m "feat(locale): add output_locale concept doc and cross-refs"
```

---

## Task 2: Templates (session.yml + work-packet.json)

**Files:**
- Modify: `shared/templates/session.yml`
- Modify: `shared/templates/work-packet.json`

- [ ] **Step 1: Adicionar `output_locale` ao `session.yml` template**

Em `shared/templates/session.yml`, logo após o bloco do `pipeline_mode` (a linha `pipeline_mode: "standard"` e seu comentário, por volta da linha 46), inserir:

```yaml

# Output language — BCP-47 tag for ALL human-facing prose the Roles emit
# (summary, findings, blockers, notes, evidence.reason, handoff.md). Set by
# spec-writer (Phase 1) from the conversation, confirmed with the human.
# Absent → readers default to "en". Enums/identifiers stay canonical (English).
# See shared/concepts/output-locale.md.
output_locale: "en"
```

- [ ] **Step 2: Adicionar `output_locale` ao `work-packet.json` template**

Em `shared/templates/work-packet.json`, adicionar o campo no bloco estável (junto de `spec_ref`/`project_context`, topo do objeto). Inserir após a linha do `spec_ref`:

```json
  "output_locale": "pt-BR",
```

Resultado esperado do topo do arquivo (referência):

```json
{
  "spec_id": "FEAT-XXX",
  "session_id": "FEAT-XXX",
  "dispatch_id": "dev-7b3c1a",
  "spec_ref": "./.agent-session/FEAT-XXX/spec.md",
  "output_locale": "pt-BR",
```

- [ ] **Step 3: Validar JSON**

Run: `python3 -c "import json; json.load(open('shared/templates/work-packet.json')); print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add shared/templates/session.yml shared/templates/work-packet.json
git commit -m "feat(locale): add output_locale to session.yml and work-packet templates"
```

---

## Task 3: spec-writer — detecção + confirmação

**Files:**
- Modify: `squads/sdd/skills/spec-writer/skill.md`

- [ ] **Step 1: Adicionar passo 2.6 (após o passo 2.5 Pipeline mode)**

Em `squads/sdd/skills/spec-writer/skill.md`, imediatamente após o fim do passo `### 2.5. Pipeline mode selection` (antes de `### 3. Capture initial pitch`), inserir:

````markdown
### 2.6. Output locale (detect + confirm)

`output_locale` is the language of ALL human-facing prose the pipeline will emit
(summaries, findings, blockers, the report content, `handoff.md`). It is detected
from the conversation, NOT pattern-matched from prior Sessions.

1. **Detect:** infer the language the human is using in this conversation/pitch.
   Express it as a BCP-47 tag with a hyphen (e.g. `pt-BR`, `en-US`, `es`).
   Normalize any underscore form (`pt_BR`) to hyphen.
2. **Interactive mode** (no PM bypass): confirm via `AskUserQuestion` (binary),
   defaulting to the detected tag:
   ```
   I'll generate all human-facing content (summaries, findings, report, handoff)
   in <language name> (<tag>). Use this language?
   [ ] Yes, use <tag>
   [ ] No, choose another  (free-form: enter a BCP-47 tag)
   ```
   On a free-form answer, normalize to a hyphenated BCP-47 tag.
3. **PM bypass** (`session.yml.auto_approved_by == "pm"`, detected later at 6.5):
   there is no human to confirm. Write the **detected** tag directly. If detection
   is inconclusive, write `en`. Do NOT run `AskUserQuestion`.
4. **Fallback:** if detection yields nothing usable and you are interactive, offer
   `en` as the default in the question. The stored value is never empty — absent
   downstream means `en`, but spec-writer always writes an explicit value.
5. Save to `session.yml.output_locale` (atomic write: tmp + rename).

Power-user flag `--locale=<tag>` bypasses detection and the prompt with explicit
semantics (normalized to hyphen).
````

- [ ] **Step 2: Registrar a flag em "When to invoke"**

Em `squads/sdd/skills/spec-writer/skill.md`, na seção `## When to invoke`, após a linha do `--plan=...`, inserir:

```markdown
- `/spec-writer FEAT-NNN --locale="pt-BR"` — power-user flag override of the interactive locale confirmation (BCP-47, hyphen).
```

- [ ] **Step 3: Atualizar a seção `## Output`**

Em `squads/sdd/skills/spec-writer/skill.md`, na seção `## Output`, na linha que começa com `- Session updates:`, acrescentar ao final da frase: ` `session.yml.output_locale` populated at step 2.6.`

- [ ] **Step 4: Verificar inserção**

Run: `grep -n "output_locale\|2.6. Output locale\|--locale" squads/sdd/skills/spec-writer/skill.md`
Expected: ≥ 3 linhas (passo, flag, output).

- [ ] **Step 5: Commit**

```bash
git add squads/sdd/skills/spec-writer/skill.md
git commit -m "feat(locale): spec-writer detects and confirms output_locale in Phase 1"
```

---

## Task 4: orchestrator — carrega locale + handoff no idioma

**Files:**
- Modify: `squads/sdd/skills/orchestrator/skill.md`

- [ ] **Step 1: Ler `output_locale` no passo 1**

Em `squads/sdd/skills/orchestrator/skill.md`, no passo `### 1. Resolve Session and read inputs`, logo após o sub-item `2a.` (que lê `pipeline_mode`), inserir um sub-item:

```markdown
2b. **Read `session.yml.output_locale`** (defaults to `en` if absent — legacy
    Sessions). This value is copied verbatim into the stable block of every Work
    Packet (see Dispatch contract) and used to write `handoff.md` (step 9). Enums
    and identifiers in packets stay canonical regardless. See
    [`shared/concepts/output-locale.md`](../../../shared/concepts/output-locale.md).
```

- [ ] **Step 2: Adicionar `output_locale` ao bloco estável do Work Packet (contrato genérico)**

Em `squads/sdd/skills/orchestrator/skill.md`, na seção `## Dispatch contract`, no bloco YAML do Work Packet, dentro do `# --- Stable block ...`, após a linha `tasks_ref: ./.agent-session/FEAT-NNN/tasks.md`, inserir:

```yaml
output_locale: pt-BR     # from session.yml; language of human-facing prose. Absent → en. Stable across dispatches.
```

- [ ] **Step 3: Adicionar `output_locale` ao exemplo concreto de Task call**

Em `squads/sdd/skills/orchestrator/skill.md`, no bloco "Concrete Task tool call (canonical example for a qa T1 dispatch)", dentro do `# Stable block (cache-friendly prefix)`, após a linha `tasks_ref: ./.agent-session/FEAT-NNN/tasks.md`, inserir:

```yaml
output_locale: pt-BR
```

- [ ] **Step 4: Handoff no idioma — passo 9**

Em `squads/sdd/skills/orchestrator/skill.md`, no passo `### 9. Pipeline-end handoff`, no item `- Emit handoff message ...` (último bullet), substituir essa linha por:

```markdown
- Emit handoff message (see "Handoff" section); also save to `.agent-session/<spec_id>/handoff.md`. **Write the handoff prose in `session.yml.output_locale`** (the narrative sentences, the Summary/Validation/Follow-ups bullets). Keep the fixed skeleton — section headers, the Conventional Commits title `type(scope):`, table column keys, enum values (`done`/`pending_human`), and identifiers — canonical (English); only the prose follows the locale. Absent → `en`.
```

- [ ] **Step 5: Verificar inserções**

Run: `grep -n "output_locale" squads/sdd/skills/orchestrator/skill.md`
Expected: ≥ 4 linhas (passo 2b, bloco estável, exemplo concreto, handoff).

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/skills/orchestrator/skill.md
git commit -m "feat(locale): orchestrator carries output_locale into Work Packets and handoff"
```

---

## Task 5: Subagents — regra "Output language" (×6)

**Files:**
- Modify: `squads/sdd/agents/dev.md`
- Modify: `squads/sdd/agents/code-reviewer.md`
- Modify: `squads/sdd/agents/logic-reviewer.md`
- Modify: `squads/sdd/agents/qa.md`
- Modify: `squads/sdd/agents/blocker-specialist.md`
- Modify: `squads/sdd/agents/audit-agent.md`

O bloco a inserir é o MESMO nos seis arquivos (texto idêntico — repetido aqui para cada um conforme a regra "no placeholders"). Inserir como uma seção curta após a seção de estilo de comunicação de cada agente (ou, na falta dela, logo após o título `#` do corpo).

Bloco canônico (idêntico nos 6):

```markdown
## Output language
- Read `output_locale` (BCP-47 tag) from the Work Packet's stable block. Absent → `en`.
- Render the tag to an explicit instruction and write ALL your human-facing prose in that language: `summary`, `findings[].rationale`/`message`, `blockers[].*`, `notes`, and `evidence[].reason`. Example: `pt-BR` → write in Brazilian Portuguese.
- Keep machine tokens canonical (English) regardless of locale: enum values (`status`, `severity`, `kind`, `role`, `blocker_kind`) and identifiers (`spec_id`, `task_id`, AC refs, `dispatch_id`, file paths). The orchestrator routes on these.
- See `shared/concepts/output-locale.md`.
```

- [ ] **Step 1: dev.md** — inserir o bloco acima logo após a seção `## Communication style (cheap, no fluff)`.

- [ ] **Step 2: code-reviewer.md** — inserir o bloco. Run para achar a âncora de estilo de comunicação:

Run: `grep -n "Communication\|## " squads/sdd/agents/code-reviewer.md | head`
Inserir o bloco após a seção de estilo de comunicação (ou, se não houver, após o primeiro parágrafo do corpo).

- [ ] **Step 3: logic-reviewer.md** — idem (mesmo bloco; achar âncora com o mesmo grep).

- [ ] **Step 4: qa.md** — idem.

- [ ] **Step 5: blocker-specialist.md** — idem. (Atenção: o `handoff`/decision memo do blocker é human-facing — a regra cobre `summary`/`blockers`/`notes`, que é onde o memo se materializa.)

- [ ] **Step 6: audit-agent.md** — idem. (O audit raramente emite prosa longa, mas seu `summary` e findings de reconciliação são human-facing.)

- [ ] **Step 7: Atualizar o Input contract de cada agente para listar `output_locale`**

Para cada um dos 6 arquivos, localizar a seção que enumera os campos do Work Packet (ex.: em `dev.md` é `## Input contract (Work Packet)`). Acrescentar à lista de campos lidos:

```markdown
- `output_locale` (optional; BCP-47 tag from the stable block; absent → `en`) — language of your human-facing prose.
```

Run para localizar as âncoras de input contract:
Run: `grep -rn "Input contract\|WorkPacket\|Work Packet" squads/sdd/agents/*.md | grep -i "contract\|read the"`

- [ ] **Step 8: Verificar os 6 arquivos**

Run: `grep -l "Output language" squads/sdd/agents/*.md`
Expected: lista os 6 arquivos (dev, code-reviewer, logic-reviewer, qa, blocker-specialist, audit-agent).

- [ ] **Step 9: Commit**

```bash
git add squads/sdd/agents/dev.md squads/sdd/agents/code-reviewer.md squads/sdd/agents/logic-reviewer.md squads/sdd/agents/qa.md squads/sdd/agents/blocker-specialist.md squads/sdd/agents/audit-agent.md
git commit -m "feat(locale): subagents write human-facing prose in output_locale"
```

---

## Task 6: session_report.py — reverter chrome pt-BR → inglês (TDD)

Estratégia TDD: primeiro flipar os asserts dos testes para inglês (vermelho), depois reverter o Python (verde).

**Files:**
- Modify: `squads/sdd/hooks/__tests__/test_session_report_redesign.py`
- Modify: `squads/sdd/hooks/session_report.py`
- Test: `squads/sdd/hooks/__tests__/test_session_report_redesign.py`

- [ ] **Step 1: Flipar os asserts pt-BR → inglês nos testes**

Em `squads/sdd/hooks/__tests__/test_session_report_redesign.py`:

(a) Em `test_dashboard_has_verdict_and_svg`, trocar:
```python
    assert "Veredito" in html
```
por:
```python
    assert "Verdict" in html
```

(b) Em `test_open_findings_counted_in_dashboard`, trocar:
```python
    assert "1 achado aberto" in html
```
por:
```python
    assert "1 open finding" in html
```

(c) Em `test_audit_packet_goes_to_integrity_not_a_card`, trocar:
```python
    assert "Integridade" in html
```
por:
```python
    assert "Integrity" in html
```

(d) Substituir o teste `test_fixed_labels_are_portuguese` inteiro por:
```python
def test_fixed_labels_are_english(tmp_path):
    html = _build(tmp_path)
    assert "Session report" in html
    assert "Relatório da sessão" not in html
    assert "Phase 4" in html
    assert "Tasks" in html           # section heading
    assert "done" in html            # verdict badge (canonical English)
```

- [ ] **Step 2: Rodar a suíte para confirmar que falha**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_session_report_redesign.py -q`
Expected: FAIL — asserts de inglês falham porque o Python ainda emite pt-BR.

- [ ] **Step 3: Reverter os rótulos de status/severidade em `session_report.py`**

Em `squads/sdd/hooks/session_report.py`, substituir o bloco (linhas ~29-34):
```python
# Display labels (pt-BR) for the canonical English enums. The CSS class keeps the
# canonical value; only the visible text is translated (audience: human reviewer).
_STATUS_PT = {"done": "concluído", "needs_review": "requer revisão",
              "blocked": "bloqueado", "escalate": "escalado"}
_SEV_PT = {"blocker": "bloqueador", "critical": "crítico", "error": "erro",
           "major": "maior", "warning": "aviso", "minor": "menor", "info": "info"}
```
por:
```python
# Fixed labels are English (tool chrome — neutral canonical). Dynamic agent prose
# embedded below arrives already localized from the Output Packets (output_locale);
# this stdlib generator only passes it through. See shared/concepts/output-locale.md.
_STATUS_LABEL = {"done": "done", "needs_review": "needs review",
                 "blocked": "blocked", "escalate": "escalated"}
```

(Removemos `_SEV_PT`: as chaves de severidade já são inglês — exibiremos o valor cru.)

- [ ] **Step 4: Atualizar `_narrative` para inglês**

Em `session_report.py`, substituir o corpo de `_narrative` (linhas ~106-123) por:
```python
def _narrative(packets):
    """The story after dev's first cut, woven from the agents' own summaries."""
    by_role = _loops_by_role(packets)
    parts = []
    n_find = sum(len(p.get("findings") or [])
                 for r in _REVIEWER_ROLES for p in by_role.get(r, []))
    max_loop = _max_loop(packets)
    if max_loop >= 2 and n_find:
        parts.append(f"Reviewers raised {n_find} finding(s); "
                     f"dev fixed and re-delivered in loop {max_loop}.")
    elif n_find:
        parts.append(f"Reviewers raised {n_find} finding(s).")
    else:
        parts.append("Delivered in a single loop, no reviewer findings.")
    qa = by_role.get("qa", [])
    if qa and qa[-1].get("status") == "done":
        parts.append("QA validated the ACs at the end.")
    return " ".join(parts)
```

- [ ] **Step 5: Atualizar `_finding_li` (tag + severidade)**

Em `session_report.py`, dentro de `_finding_li` (linhas ~184-195), trocar:
```python
    cls = "find resolved" if resolved else "find open"
    tag = "✓ resolvido" if resolved else "aberto"
    ref_html = f" <em>({ref})</em>" if ref else ""
    sev_lbl = _SEV_PT.get(fd.get("severity", ""), sev)
```
por:
```python
    cls = "find resolved" if resolved else "find open"
    tag = "✓ resolved" if resolved else "open"
    ref_html = f" <em>({ref})</em>" if ref else ""
    sev_lbl = sev
```

- [ ] **Step 6: Atualizar `_dashboard` para inglês**

Em `session_report.py`, na função `_dashboard` (linhas ~219-248), aplicar as trocas de texto visível:
```python
    verdict = "✓ Ready" if ok else f"⚠ {total - done} pending"
```
```python
    open_lbl = f"{open_count} open finding" if open_count == 1 else f"{open_count} open findings"
    cost_warn = ("" if rep["complete"]
                 else "<div class='legend warn'>⚠ cost incomplete</div>")
```
E no `return` (o bloco HTML), trocar os literais:
- `>Veredito<` → `>Verdict<`
- `{done}/{total} concluídas · {bad} bloqueada/escalada · {open_lbl}` → `{done}/{total} done · {bad} blocked/escalated · {open_lbl}`
- `>Status das tarefas<` → `>Task status<`
- `🟢 {done} concluídas<br>` → `🟢 {done} done<br>`
- `🟡 {needs} requer revisão<br>` → `🟡 {needs} needs review<br>`
- `🔴 {bad} bloqueada/escalada` → `🔴 {bad} blocked/escalated`
- `Custo · ${rep['total_cost_usd']:.2f}` → `Cost · ${rep['total_cost_usd']:.2f}`
- `🔵 planejamento` → `🔵 planning`
- `🔷 orquestração` → `🔷 orchestration`
- `🟢 implementação ${...} ({rep['subagent_count']} subagentes)` → `🟢 implementation ${...} ({rep['subagent_count']} subagents)`
- `>Achados · cobertura de AC<` → `>Findings · AC coverage<`
- `<span class='unit'>abertos</span>` → `<span class='unit'>open</span>`
- `{ac_count} ACs cobertos pelo qa` → `{ac_count} ACs covered by qa`

- [ ] **Step 7: Atualizar seções restantes (integrity, task card, handoff, header)**

Em `session_report.py`:
- `_integrity_section` (~262): `<h2>Integridade do pipeline</h2>` → `<h2>Pipeline integrity</h2>`; e a referência `status_lbl = _STATUS_PT.get(...)` → `status_lbl = _STATUS_LABEL.get(status, status)`.
- `_task_card` (~272): `"(sem descrição)"` → `"(no description)"`; uso de `_STATUS_PT.get(...)` (linha ~303) → `_STATUS_LABEL.get(verdict, verdict)`.
- `_task_card` (~290): `▸ Ver alterações ({len(files)} arquivo(s))` → `▸ View changes ({len(files)} file(s))`.
- `_task_card` (~296): `✓ {acs} validados por qa` → `✓ {acs} validated by qa`.
- `_handoff_section` (~320): `<summary>Repasse (handoff)</summary>` → `<summary>Handoff</summary>`.
- `build_html_report` (~408): `lang='pt-BR'` → `lang='en'`.
- `build_html_report` (~409-410): `Relatório da sessão — ` → `Session report — ` (nas duas ocorrências: `<title>` e `<h1>`).
- `build_html_report` (~411-412): `{len(by_task)} tarefas · {rep['subagent_count']} subagentes · Fase 4 (Implementação)` → `{len(by_task)} tasks · {rep['subagent_count']} subagents · Phase 4 (Implementation)`.
- `build_html_report` (~415): `"<h2>Tarefas</h2>"` → `"<h2>Tasks</h2>"`.

- [ ] **Step 8: Garantir que nenhuma referência a `_STATUS_PT`/`_SEV_PT` sobrou**

Run: `grep -n "_STATUS_PT\|_SEV_PT\|concluíd\|Veredito\|Tarefas\|Integridade\|Relatório\|Fase 4\|aberto\|resolvido" squads/sdd/hooks/session_report.py`
Expected: nenhuma linha (todas revertidas).

- [ ] **Step 9: Rodar a suíte e confirmar verde**

Run: `python3 -m pytest squads/sdd/hooks/__tests__/test_session_report_redesign.py -q`
Expected: PASS (todos).

- [ ] **Step 10: Commit**

```bash
git add squads/sdd/hooks/session_report.py squads/sdd/hooks/__tests__/test_session_report_redesign.py
git commit -m "feat(locale): revert session report fixed labels to canonical English"
```

---

## Self-Review (preenchido pelo autor do plano)

**1. Cobertura da spec** — cada item da spec mapeia a uma task:
- Fonte única `output_locale` em session.yml → Task 2.
- Aquisição (detect+confirm na Phase 1) → Task 3.
- Carrier no Work Packet (bloco estável) → Task 2 (template) + Task 4 (dispatch).
- Regra nos agentes (render-to-instruction) → Task 5 + Task 1 (concept doc).
- Escopo (campos de prosa) → Task 1 (regra) + Task 5 (aplicação).
- handoff.md no idioma → Task 4.
- Report chrome inglês (reversão) → Task 6.
- Fallback `en` → Task 1 (doc) + Task 2 (template default) + Tasks 3/4 (leitura com default).
- Fora de escopo (catálogo, Discovery agents, `message` vs `rationale`) → não implementado, registrado na spec.

**2. Placeholder scan** — sem TBD/TODO; todo passo de código mostra o conteúdo exato. Os passos de `grep` para achar âncoras são localizadores em arquivos existentes, não placeholders de conteúdo.

**3. Consistência de tipos/nomes** — `output_locale` (snake_case) consistente em concept/template/skills/agents. `_STATUS_LABEL` substitui `_STATUS_PT` e é usado em `_integrity_section` e `_task_card` (Steps 7). `_SEV_PT` removido e todos os usos trocados por `sev` (Step 5). Tag BCP-47 com hífen em todos os exemplos.
```
