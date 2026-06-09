# Núcleo Implementador — Fase 1 (MVP + benchmark) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development ou superpowers:executing-plans. Passos usam checkbox (`- [ ]`).
>
> **Adaptação de formato (importante):** a maioria dos artefatos aqui é **prosa** (skill/agent `.md`), não código TDD-ável. Para esses, cada task fixa o **contrato verbatim** (path, responsabilidade, input, output, sequência exata de passos, critérios de aceite) e a validação é **comportamental** (rodar num feature real). Só a Task 1 (schema do Reuse Map) é TDD puro com teste. Edições no ai-squad são **manuais** (sem dogfood do SDD).

**Goal:** Construir o mínimo do núcleo novo (`/implementer` + `reuse-mapper` + `fresh-eyes-reviewer`) **ao lado** do pipeline velho e rodar um benchmark head-to-head numa feature real de repo consumidor, para de-riscar o conceito antes de qualquer deleção.

**Architecture:** Skill `/implementer` interativa (Opus) na sessão do humano → dispara `reuse-mapper` (Sonnet, emite Reuse Map) → contexto curado do disco → Checkpoint A (plano+reúso) → implementa com TDD/reúso/regras → escalações sob demanda → `fresh-eyes-reviewer` (Sonnet, contexto cheio) → Checkpoint B (selo). Nada do pipeline velho é tocado nesta fase.

**Tech Stack:** Markdown (skills/agents), JSON Schema, Python 3 (hooks/testes existentes em `squads/sdd/.../__tests__/`), Claude Code `Task` tool + `AskUserQuestion`.

---

## File Structure

| Arquivo | Cria/Modifica | Responsabilidade |
|---|---|---|
| `shared/schemas/reuse-map.schema.json` | Cria | Contrato do Reuse Map (saída do mapper, entrada do implementador+revisor) |
| `shared/schemas/__tests__/test_reuse_map_schema.py` | Cria | Valida o schema (exemplo válido passa, inválido falha) |
| `squads/sdd/agents/reuse-mapper.md` | Cria | Subagente de descoberta (Sonnet) → Reuse Map |
| `squads/sdd/agents/fresh-eyes-reviewer.md` | Cria | Revisor único, dupla lente, contexto cheio (Sonnet) |
| `squads/sdd/skills/implementer/skill.md` | Cria | Phase 4 como skill interativa (Opus) — orquestra o fluxo + checkpoints + status |
| `docs/superpowers/benchmarks/2026-06-08-implementer-vs-orchestrator.md` | Cria | Protocolo + resultado do head-to-head |

**Convenção:** prosa em português (locale do usuário); enums/identificadores/paths em inglês canônico.

---

## Task 1: Schema do Reuse Map (TDD)

**Files:**
- Create: `shared/schemas/reuse-map.schema.json`
- Test: `shared/schemas/__tests__/test_reuse_map_schema.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# shared/schemas/__tests__/test_reuse_map_schema.py
import json, pathlib
import jsonschema  # já usado pelos outros schema tests do repo

SCHEMA = json.loads((pathlib.Path(__file__).parents[1] / "reuse-map.schema.json").read_text())

VALID = {
    "spec_id": "FEAT-042",
    "generated_for": {"feature_summary": "exportar relatório em CSV",
                       "touched_areas": ["src/reports"]},
    "existing_code": [
        {"kind": "util", "ref": "src/utils/csv.ts:8",
         "what": "serializa linhas para CSV", "relevance": "reúso direto p/ AC-002"}
    ],
    "boundaries": [
        {"area": "src/utils", "scope": "global", "note": "compartilhado; não duplicar local"}
    ],
    "applicable_rules": [
        {"rule": "anti-abstracao", "source": "CLAUDE.md",
         "directive": "código legível direto; sem camada para <2 call sites"}
    ],
    "notes": ""
}

def test_valid_reuse_map_passes():
    jsonschema.validate(VALID, SCHEMA)

def test_missing_required_field_fails():
    bad = dict(VALID); del bad["existing_code"]
    try:
        jsonschema.validate(bad, SCHEMA)
        assert False, "esperava ValidationError"
    except jsonschema.ValidationError:
        pass

def test_bad_kind_enum_fails():
    bad = json.loads(json.dumps(VALID))
    bad["existing_code"][0]["kind"] = "banana"
    try:
        jsonschema.validate(bad, SCHEMA)
        assert False, "esperava ValidationError"
    except jsonschema.ValidationError:
        pass

def test_bad_scope_enum_fails():
    bad = json.loads(json.dumps(VALID))
    bad["boundaries"][0]["scope"] = "regional"
    try:
        jsonschema.validate(bad, SCHEMA)
        assert False, "esperava ValidationError"
    except jsonschema.ValidationError:
        pass
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `python3 -m pytest shared/schemas/__tests__/test_reuse_map_schema.py -v`
Expected: FAIL (arquivo `reuse-map.schema.json` não existe → erro ao ler).

- [ ] **Step 3: Escrever o schema**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Reuse Map",
  "type": "object",
  "additionalProperties": false,
  "required": ["spec_id", "generated_for", "existing_code", "boundaries", "applicable_rules"],
  "properties": {
    "spec_id": {"type": "string", "pattern": "^FEAT-[0-9]+$"},
    "generated_for": {
      "type": "object",
      "additionalProperties": false,
      "required": ["feature_summary", "touched_areas"],
      "properties": {
        "feature_summary": {"type": "string"},
        "touched_areas": {"type": "array", "items": {"type": "string"}}
      }
    },
    "existing_code": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["kind", "ref", "what", "relevance"],
        "properties": {
          "kind": {"enum": ["util", "handler", "component", "service", "hook", "type", "other"]},
          "ref": {"type": "string"},
          "what": {"type": "string"},
          "relevance": {"type": "string"}
        }
      }
    },
    "boundaries": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["area", "scope", "note"],
        "properties": {
          "area": {"type": "string"},
          "scope": {"enum": ["global", "local"]},
          "note": {"type": "string"}
        }
      }
    },
    "applicable_rules": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["rule", "source", "directive"],
        "properties": {
          "rule": {"type": "string"},
          "source": {"type": "string"},
          "directive": {"type": "string"}
        }
      }
    },
    "notes": {"type": "string"}
  }
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `python3 -m pytest shared/schemas/__tests__/test_reuse_map_schema.py -v`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add shared/schemas/reuse-map.schema.json shared/schemas/__tests__/test_reuse_map_schema.py
git commit -m "feat(implementer): add reuse-map schema + tests"
```

---

## Task 2: Agente `reuse-mapper` (prosa → contrato)

**Files:**
- Create: `squads/sdd/agents/reuse-mapper.md`

**Contrato a encodar no arquivo** (frontmatter + corpo):

- [ ] **Step 1: Frontmatter**

```yaml
---
name: reuse-mapper
description: Pré-passo de descoberta do /implementer. Lê o spec/plan e varre o codebase do repo consumidor para emitir o Reuse Map (código existente reusável, fronteiras global×local, regras aplicáveis). Read-only; nunca edita source. Use quando o /implementer dispara a descoberta antes do Checkpoint A.
tools: Read, Grep, Glob
model: sonnet
effort: medium
---
```

- [ ] **Step 2: Corpo — Input contract (Work Packet)**

Documentar os campos lidos: `spec_id`, `spec_ref`, `plan_ref` (opcional), `touched_areas` (dica de onde olhar, derivada do plano/ACs), `standards_ref` (CLAUDE.md), `output_locale`. Campo faltante obrigatório → não bloqueia; mapeia o que der e registra a lacuna em `notes`.

- [ ] **Step 3: Corpo — Procedimento de descoberta (sequência exata)**

1. Ler `spec_ref` (+ `plan_ref`) para entender o domínio da feature.
2. Para cada `touched_areas` (e seus vizinhos óbvios): `Glob`/`Grep` por utils, handlers, componentes, services, hooks, types existentes.
3. `Read` os candidatos relevantes (trecho, não arquivo inteiro) — registrar `ref` (file:line) + `what` (uma linha) + `relevance` (qual AC poderia reusar).
4. Identificar fronteiras **global × local** das áreas tocadas (onde moram os compartilhados vs. o específico da feature).
5. Ler `standards_ref` (CLAUDE.md do consumidor) e destilar as `applicable_rules` que incidem nesta feature (anti-abstração, legibilidade, convenções de nome/estrutura).

- [ ] **Step 4: Corpo — Output contract**

Escrever o Reuse Map em `.agent-session/<spec_id>/reuse-map.json`, **validado contra `shared/schemas/reuse-map.schema.json`** (Task 1). Comunicação agent→agent: só o artefato, sem prosa. Prosa humana (se houver em `notes`/`relevance`) segue `output_locale`.

- [ ] **Step 5: Critérios de aceite (comportamental)**

- Lista ≥1 item de `existing_code` quando existe código reusável óbvio na área tocada (testar num repo real onde sabemos que há um util reusável → o mapa tem que achá-lo).
- `boundaries` marca corretamente pelo menos uma área `global` compartilhada.
- `applicable_rules` cita a regra anti-abstração do CLAUDE.md do consumidor.
- Saída valida contra o schema (`python3 -c "import json,jsonschema; ..."`).

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/agents/reuse-mapper.md
git commit -m "feat(implementer): add reuse-mapper discovery agent"
```

---

## Task 3: Agente `fresh-eyes-reviewer` (prosa → contrato)

**Files:**
- Create: `squads/sdd/agents/fresh-eyes-reviewer.md`
- Reference (para fundir os checklists): `squads/sdd/agents/code-reviewer.md`, `squads/sdd/agents/logic-reviewer.md` (ler, NÃO deletar — strangler).

- [ ] **Step 1: Frontmatter**

```yaml
---
name: fresh-eyes-reviewer
description: Revisor único do /implementer (merge de code-reviewer + logic-reviewer). Revisa o diff com CONTEXTO CHEIO (arquivos mudados + Reuse Map + spec + regras) — por isso consegue pegar reúso/global-como-local que um diff isolado não pega. Dupla lente; achados etiquetados. Read-only. Use quando o /implementer termina a implementação, antes do Checkpoint B.
tools: Read, Grep
model: sonnet
effort: high
---
```

- [ ] **Step 2: Corpo — Input contract**

Lê: `spec_ref`, `reuse_map_ref` (.agent-session/<spec_id>/reuse-map.json), `changed_files` (lista do implementador), `standards_ref`, `output_locale`. **Crucial:** recebe o Reuse Map para confrontar o que foi escrito contra o que já existia.

- [ ] **Step 3: Corpo — Checklist de dupla lente (etiquetas obrigatórias)**

Cada achado tem `tag` ∈ {`reuse`, `abstraction`, `readability`, `spec_fidelity`, `pattern_fit`}:
- `reuse`: duplicou algo do Reuse Map? tratou global como local?
- `abstraction`: over-abstraiu contra `applicable_rules`?
- `readability`: legível pelo padrão do projeto?
- `spec_fidelity`: cumpre cada AC do `ac_scope`? (mapear achado→AC)
- `pattern_fit`: segue convenções do codebase?

- [ ] **Step 4: Corpo — Output contract**

```json
{
  "verdict": "clean | findings",
  "findings": [
    {"tag": "reuse", "ref": "src/x.ts:12", "severity": "trivial|material",
     "message": "...", "suggested_fix": "..."}
  ]
}
```
Escreve em `.agent-session/<spec_id>/review.json`. `severity: trivial` = o implementador aplica sozinho; `material` = sobe pro Checkpoint B. Findings são ponteiros (file:line), nunca dump de código inline.

- [ ] **Step 5: Critérios de aceite (comportamental)**

- Dado um diff que reescreve um util presente no Reuse Map, o revisor emite um finding `reuse` `material` apontando o `ref` original.
- Dado um diff com camada de abstração para 1 call site, emite finding `abstraction`.
- Para cada AC não atendido, emite finding `spec_fidelity` com o AC ref.

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/agents/fresh-eyes-reviewer.md
git commit -m "feat(implementer): add fresh-eyes-reviewer (merged, full-context)"
```

---

## Task 4: Skill `/implementer` (prosa → contrato)

**Files:**
- Create: `squads/sdd/skills/implementer/skill.md`
- Reference: `squads/sdd/agents/dev.md` (migrar disciplinas: TDD, `decisions[]`, política de comentários — ler, NÃO deletar).

- [ ] **Step 1: Frontmatter**

```yaml
---
name: implementer
description: Phase 4 (Implementation) — skill interativa de agente único que implementa uma feature aprovada na sessão do humano, com contexto curado, reúso ativo e 2 checkpoints. Substitui o orchestrator (que NÃO é tocado nesta fase). Use com /implementer FEAT-NNN sobre um Session com spec/plan/tasks aprovados.
model: opus
effort: high
---
```

- [ ] **Step 2: Corpo — Sequência exata (o coração do contrato)**

1. **Carregar do disco** (não da conversa): `spec.md`, `plan.md`, `tasks.md`/checklist de ACs, `CLAUDE.md`. Ler `output_locale`.
2. **Dispatch `reuse-mapper`** (`Task`, `model: sonnet`) com `touched_areas` derivado do plano/ACs → ler `reuse-map.json` e validar contra o schema.
3. **Montar o plano de ataque**: a partir dos ACs + Reuse Map, listar o que **reusar** (citar `ref` do mapa), o que **criar** (e por que nada serve), o que **tocar**.
4. **Checkpoint A** (FIXO): escrever no `session.yml` `status: needs_attention`, `attention: {kind: plan_approval}`; apresentar o plano de ataque + reúso ao humano (`AskUserQuestion` ou espera). Na aprovação → `status: implementing` e guardar o **escopo aprovado** (lista de arquivos) para a cerca de escrita.
5. **Implementar**: TDD-leaning; **antes de criar qualquer helper, conferir o Reuse Map**; aplicar ativamente as `applicable_rules`; escrever só dentro do escopo aprovado. Gravar `decisions[]` (decisão/desvio + rationale + ref).
   - Em **ambiguidade / reúso borderline / desvio material** → `status: needs_attention`, `attention: {kind: input}`; perguntar; retomar.
6. **Verificar** (verification-before-completion): rodar os testes do `ac_scope`, registrar comandos+exit. Sem `git commit`.
7. **Dispatch `fresh-eyes-reviewer`** (`Task`, `model: sonnet`) com contexto cheio (changed_files + reuse_map_ref + spec + standards) → ler `review.json`. `trivial` → aplicar; `material` → carregar pro Checkpoint B.
8. **Checkpoint B** (FIXO): `status: needs_attention`, `attention: {kind: final_approval}`; apresentar o construído + findings do revisor e resolução + evidência + `decisions[]`. No selo do humano → `status: done`.
9. **Emitir evidência + `decisions[]`** no `session.yml` (insumo do chronicler na Fase 2).

- [ ] **Step 3: Corpo — Checkpoint de meio (condicional)**

Disparar um checkpoint extra (`attention.kind: input`) após a primeira fatia vertical **só** quando a feature for `≥ ~8 arquivos` ou tocar área sensível. Caso contrário, pular.

- [ ] **Step 4: Corpo — Status writes (MVP, informal)**

Nesta fase o status vai pro `session.yml` como campo simples (`status`, `attention.kind`) **sem** validação de schema — a formalização em `session.schema.json` é Fase 2. Documentar os valores: `implementing` | `needs_attention` (`plan_approval`|`input`|`final_approval`) | `done`. (É o que o aiOS vai ler; integração fina fica pra Fase 2.)

- [ ] **Step 5: Critérios de aceite (comportamental — coberto pelo benchmark, Task 5)**

- O fluxo completo roda numa feature real sem tocar o pipeline velho.
- Para nos exatos 2 checkpoints fixos (+ escalações só quando há bifurcação real).
- `session.yml` mostra `needs_attention`/`final_approval` antes de `done`.

- [ ] **Step 6: Commit**

```bash
git add squads/sdd/skills/implementer/skill.md
git commit -m "feat(implementer): add /implementer interactive skill (Phase 4 core)"
```

---

## Task 5: Benchmark head-to-head (validação — o gate de tudo)

**Files:**
- Create: `docs/superpowers/benchmarks/2026-06-08-implementer-vs-orchestrator.md`

- [ ] **Step 1: Escolher a feature de prova**

Num **repo consumidor real** (ex.: ai-squad-os — *nunca o próprio ai-squad*), escolher UMA feature pequena/média (~3-12 arquivos) **representativa** das dores: que naturalmente tente reusar utils/handlers existentes. Registrar spec/plan/tasks dela.

- [ ] **Step 2: Rodar o pipeline VELHO**

`/orchestrator FEAT-NNN` na feature. Capturar: custo (`python3 .claude/hooks/cost-report.py <spec_id>` → \$ + tokens), tempo de parede, e o diff produzido. Guardar o diff num branch/patch separado (não mergear).

- [ ] **Step 3: Rodar o núcleo NOVO**

`/implementer FEAT-NNN` na MESMA feature (working tree limpo / outro branch). Capturar custo (mesmo `cost-report.py` — as hooks de captura existentes pegam sessão + subagentes via `Task`), tempo, diff.

- [ ] **Step 4: Comparar (julgamento do humano nos 5 pontos)**

Preencher a tabela no doc do benchmark:

| Critério | Velho | Novo |
|---|---|---|
| Reescreveu código que já existia? | | |
| Tratou global como local? | | |
| Over-abstração? | | |
| Legibilidade (1-5) | | |
| Deslizada do spec? | | |
| Custo (\$ / tokens) | | |
| Tempo de parede | | |
| Nº de interações humanas | | |

- [ ] **Step 5: Veredito + decisão de gate**

Escrever o veredito contra a barra de aceite (design §8). **Verde** (novo ganha em correção + custo) → libera a Fase 3 (lista de morte). **Vermelho** → voltar ao design com o aprendizado, **sem deletar nada**. Definir aqui o número-meta de corte de custo (medido, não chutado).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/benchmarks/2026-06-08-implementer-vs-orchestrator.md
git commit -m "docs(implementer): head-to-head benchmark protocol + results"
```

---

## Self-Review (cobertura do design §1-§8 na Fase 1)

- **Implementador, reuse-mapper, reviewer, checkpoints, Reuse Map, status (informal):** Tasks 2-4. ✓
- **Modelos (Opus/Sonnet, sem Haiku):** frontmatters nas Tasks 2-4. ✓
- **Strangler (não tocar o velho):** explícito nas Tasks 3-4 ("ler, não deletar") e Task 5 (rodar os dois lado a lado). ✓
- **Benchmark = a evidência que faltava:** Task 5. ✓
- **Fora desta fase (Fase 2):** schema formal do status, rework do chronicler/cost-scoping, baseline-leve, repurpose do guard. **Fase 3:** lista de morte. ✓
- **Sem placeholders de código:** o único código real (schema + teste) está completo na Task 1; o resto são contratos de prosa, intencionalmente especificados (não são "TODO").
