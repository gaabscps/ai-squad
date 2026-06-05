# Parecer de entrega (`chronicler` + `delivery-report`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar ao squad SDD um agente `chronicler` que, sempre ao final da pipeline, emite um parecer de entrega (`delivery-report.json` + `.md`) cruzando intenção (spec/plan/tasks) com execução real, ancorado em evidência.

**Architecture:** Três camadas. (1) Um **extrator determinístico** em Python (`shared/lib/delivery_report.py`) lê os artefatos da Session e emite um `DeliveryFacts` JSON com schema comum a todos os squads. (2) O agente **`chronicler`** (Sonnet/high) roda o extrator, lê os Facts + a prosa, e produz os dois artefatos. (3) O **`dev`** ganha um campo `decisions[]` no Output Packet como fonte do "por quê" / "o que mudou do plano". A fronteira de extensão é o `DeliveryFacts` schema: plugar Discovery = escrever `extract_discovery`, núcleo intocado.

**Tech Stack:** Python 3 stdlib (sem dependências externas, sem PyYAML — parse de `session.yml` via regex line-based, padrão do repo), JSON Schema draft 2020-12, pytest, Markdown para agentes/skills.

**Design de referência:** [`docs/superpowers/specs/2026-06-05-delivery-report-chronicler-design.md`](../specs/2026-06-05-delivery-report-chronicler-design.md)

**Convenção de execução (não-dogfood):** este repo não roda o próprio SDD sobre si mesmo. Todas as edições são manuais (Read/Edit/Write). Os "commits" ao fim de cada task usam `git add -f` para `docs/` (que está no `.gitignore` mas é versionado), e nunca incluem `Co-Authored-By`.

---

## Visão de arquivos (decomposição)

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `shared/schemas/output-packet.schema.json` | Contrato do Output Packet | Modificar: `chronicler` no enum `role`; campo `decisions[]` dev-only |
| `squads/sdd/hooks/verify-output-packet.py` | Validação no SubagentStop | Modificar: `chronicler` em `_PHASE_4_SUBAGENTS`; validar `decisions[]` |
| `squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py` | Testes do hook | Modificar: casos de `decisions[]` |
| `squads/sdd/agents/dev.md` | Contrato do dev | Modificar: documentar `decisions[]` + disciplina |
| `shared/schemas/delivery-facts.schema.json` | **Interface de extensão** (Facts comum) | Criar |
| `shared/schemas/delivery-report.schema.json` | Contrato do parecer (11 perguntas) | Criar |
| `shared/lib/delivery_report.py` | Extrator determinístico + registry + CLI | Criar |
| `shared/lib/__tests__/test_delivery_report.py` | Testes do extrator | Criar |
| `shared/schemas/__tests__/test_delivery_schemas.py` | Testes dos 2 schemas novos | Criar |
| `shared/schemas/session.schema.json` | Contrato da Session | Modificar: `delivery_report_ref`, `delivery_facts_ref` |
| `shared/schemas/__tests__/test_session_schema.py` | Testes do session schema | Modificar: assert dos 2 refs |
| `shared/templates/session.yml` | Template da Session | Modificar: 2 refs comentados |
| `squads/sdd/agents/chronicler.md` | O agente do parecer | Criar |
| `squads/sdd/skills/orchestrator/skill.md` | Pipeline Phase 4 | Modificar: passo 8.5 |
| `squads/sdd/skills/orchestrator/model-effort-calibration.md` | Calibração | Modificar: linha `chronicler` |

---

## Task 1: `decisions[]` e `chronicler` no schema do Output Packet

**Files:**
- Modify: `shared/schemas/output-packet.schema.json`
- Test: `shared/schemas/__tests__/test_delivery_schemas.py` (criado nesta task, estendido depois)

- [ ] **Step 1: Escrever o teste que falha**

Criar `shared/schemas/__tests__/test_delivery_schemas.py`:

```python
import json
from pathlib import Path

SCHEMAS = Path(__file__).resolve().parents[1]


def _load(name):
    return json.loads((SCHEMAS / name).read_text(encoding="utf-8"))


def test_output_packet_role_enum_includes_chronicler():
    s = _load("output-packet.schema.json")
    assert "chronicler" in s["properties"]["role"]["enum"]


def test_output_packet_has_dev_decisions_field():
    s = _load("output-packet.schema.json")
    dec = s["properties"]["decisions"]
    assert dec["type"] == "array"
    item = dec["items"]
    assert set(item["required"]) == {"id", "kind", "summary", "rationale"}
    assert set(item["properties"]["kind"]["enum"]) == {"decision", "deviation"}
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_delivery_schemas.py -v`
Expected: FAIL — `KeyError: 'decisions'` e `chronicler` ausente do enum.

- [ ] **Step 3: Adicionar `chronicler` ao enum `role`**

Em `shared/schemas/output-packet.schema.json`, no array `properties.role.enum` (que hoje termina em `"committer"`), adicionar `"chronicler"`:

```json
        "committer",
        "chronicler"
```

Atualizar a `description` do `role` acrescentando: `'chronicler' added: synthesis Subagent that emits the delivery-report at pipeline end.`

- [ ] **Step 4: Adicionar o campo `decisions[]`**

No objeto `properties` (logo após `files_changed`, mantendo a vizinhança dev-only), inserir:

```json
    "decisions": {
      "type": "array",
      "description": "dev-only: technical decisions and plan deviations declared during implementation. Source for the delivery-report's 'why' (Q3) and 'deviations from plan' (Q4). Optional; default []. Forbidden on non-dev packets.",
      "items": {
        "type": "object",
        "required": ["id", "kind", "summary", "rationale"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "description": "Monotonic per dispatch (DEC-001, DEC-002, ...)." },
          "kind": { "type": "string", "enum": ["decision", "deviation"], "description": "decision = technical choice between real alternatives with a trade-off; deviation = departed from what plan.md/tasks.md specified." },
          "summary": { "type": "string", "maxLength": 120, "description": "What was decided/changed (≤120)." },
          "rationale": { "type": "string", "maxLength": 200, "description": "Why (≤200)." },
          "ref": { "type": "string", "description": "Evidence pointer: file:line where the decision lives." },
          "plan_ref": { "type": "string", "description": "Optional: AC id or plan.md section affected/deviated (central for kind=deviation)." }
        }
      }
    },
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_delivery_schemas.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add shared/schemas/output-packet.schema.json shared/schemas/__tests__/test_delivery_schemas.py
git commit -m "feat(schema): add chronicler role and dev decisions[] to output-packet"
```

---

## Task 2: Validação de `decisions[]` e `chronicler` no hook

**Files:**
- Modify: `squads/sdd/hooks/verify-output-packet.py`
- Test: `squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py`

Contexto: `validate_packet()` (linha ~356) é o ponto único de validação. `_PHASE_4_SUBAGENTS` (linha ~66) lista quem deve emitir packet no SubagentStop. Vamos: (a) registrar `chronicler` como Phase 4 subagent; (b) adicionar `_validate_decisions_field` chamada universalmente (rejeita `decisions` em não-dev; valida shape em dev).

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py` (importa o módulo como os testes existentes do arquivo já fazem — reutilize o mesmo mecanismo de import que o topo do arquivo usa; o nome do módulo importado é `verify_output_packet`):

```python
def test_dev_decisions_valid_shape_passes(tmp_path):
    packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-dev-l1",
        "role": "dev", "status": "done", "summary": "done", "evidence": [], "usage": None,
        "decisions": [
            {"id": "DEC-001", "kind": "decision", "summary": "optimistic lock",
             "rationale": "avoids contention", "ref": "src/x.ts:42", "plan_ref": "AC-003"}
        ],
    }
    p = tmp_path / "d-T-001-dev-l1.json"
    p.write_text(__import__("json").dumps(packet), encoding="utf-8")
    ok, reason = verify_output_packet.validate_packet(p)
    assert ok, reason


def test_dev_decisions_bad_kind_fails(tmp_path):
    packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-dev-l1",
        "role": "dev", "status": "done", "summary": "done", "evidence": [], "usage": None,
        "decisions": [{"id": "DEC-001", "kind": "guess", "summary": "x", "rationale": "y"}],
    }
    p = tmp_path / "d-T-001-dev-l1.json"
    p.write_text(__import__("json").dumps(packet), encoding="utf-8")
    ok, reason = verify_output_packet.validate_packet(p)
    assert not ok and "kind" in reason


def test_non_dev_decisions_forbidden(tmp_path):
    packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-qa-l1",
        "role": "qa", "status": "done", "summary": "done", "evidence": [], "usage": None,
        "ac_coverage": {"FEAT-001/AC-001": ["e-1"]},
        "decisions": [{"id": "DEC-001", "kind": "decision", "summary": "x", "rationale": "y"}],
    }
    p = tmp_path / "d-T-001-qa-l1.json"
    p.write_text(__import__("json").dumps(packet), encoding="utf-8")
    ok, reason = verify_output_packet.validate_packet(p)
    assert not ok and "decisions" in reason


def test_chronicler_is_phase4_subagent():
    assert "chronicler" in verify_output_packet._PHASE_4_SUBAGENTS
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py -v -k "decisions or chronicler"`
Expected: FAIL — `chronicler` ausente do set; `decisions` não validado.

- [ ] **Step 3: Adicionar `chronicler` ao `_PHASE_4_SUBAGENTS`**

Em `verify-output-packet.py`, no frozenset `_PHASE_4_SUBAGENTS` (linha ~66), acrescentar `"chronicler",` após `"blocker-specialist",`.

- [ ] **Step 4: Escrever o validador `_validate_decisions_field`**

Inserir antes de `def validate_packet` (linha ~356):

```python
_DECISION_KINDS = {"decision", "deviation"}


def _validate_decisions_field(packet: dict) -> tuple[bool, str]:
    """dev-only `decisions[]`: source for the delivery-report's why/deviations.
    Optional on dev (absence is valid). Forbidden on any non-dev role. When present
    on dev, each item must have id, kind in {decision, deviation}, summary, rationale.
    """
    dispatch_id = packet.get("dispatch_id", "<unknown>")
    role = packet.get("role", "")
    decisions = packet.get("decisions")
    if decisions is None:
        return True, "valid"
    if role != "dev":
        return (
            False,
            f"dispatch_id={dispatch_id}: '{role}' Output Packet has 'decisions' but the "
            "field is dev-only — only the dev declares decisions/deviations",
        )
    if not isinstance(decisions, list):
        return (
            False,
            f"dispatch_id={dispatch_id}: dev 'decisions' must be an array, "
            f"got {type(decisions).__name__}",
        )
    for i, item in enumerate(decisions):
        if not isinstance(item, dict):
            return False, f"dispatch_id={dispatch_id}: dev 'decisions[{i}]' must be an object"
        for key in ("id", "kind", "summary", "rationale"):
            if key not in item:
                return (
                    False,
                    f"dispatch_id={dispatch_id}: dev 'decisions[{i}]' missing required key '{key}'",
                )
        if item["kind"] not in _DECISION_KINDS:
            return (
                False,
                f"dispatch_id={dispatch_id}: dev 'decisions[{i}].kind' = '{item['kind']}' "
                f"not in {sorted(_DECISION_KINDS)}",
            )
    return True, "valid"
```

- [ ] **Step 5: Chamar o validador em `validate_packet`**

Em `validate_packet`, logo após o bloco do `_validate_task_id_field` (após a linha que faz `ok, reason = _validate_task_id_field(packet)` e seu `if not ok: return ...`, por volta da linha 388), inserir:

```python
    # dev-only decisions[] (delivery-report source); forbidden on other roles.
    ok, reason = _validate_decisions_field(packet)
    if not ok:
        return False, reason
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py -v`
Expected: PASS (todos, incluindo os 4 novos). Rodar a suíte do hook inteira para garantir não-regressão:
Run: `python3 -m pytest squads/sdd/hooks/__tests__/ -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add squads/sdd/hooks/verify-output-packet.py squads/sdd/hooks/__tests__/test_verify_output_packet_roles.py
git commit -m "feat(hook): validate dev decisions[] and register chronicler as Phase 4 subagent"
```

---

## Task 3: Documentar `decisions[]` no contrato do `dev`

**Files:**
- Modify: `squads/sdd/agents/dev.md`

Sem teste de código (é doc do agente). A disciplina é o ponto: registrar só decisões/desvios significativos, senão `[]`.

- [ ] **Step 1: Acrescentar `decisions[]` à lista de campos do Output contract**

Em `dev.md`, na seção `## Output contract (Output Packet)` (após a linha de `files_changed[]`, ~linha 66), inserir:

```markdown
- `decisions[]`: optional, default `[]`. Technical decisions and plan deviations you made while implementing. This is the ONLY structured source the delivery-report has for "why it was built this way" and "what changed from the plan". Each item: `{id, kind, summary, rationale, ref?, plan_ref?}`.
```

- [ ] **Step 2: Adicionar a regra de disciplina**

Após a seção `### Comments policy` (antes de `## Escalate via blocker-specialist when`, ~linha 109), inserir uma nova subseção:

```markdown
### Decisions policy (the delivery-report's only "why" source)
Record a `decisions[]` entry ONLY when:
- **`kind: decision`** — you chose between real alternatives with a trade-off (e.g. optimistic vs pessimistic locking). Not for forced/obvious moves.
- **`kind: deviation`** — you departed from what `plan.md`/`tasks.md` specified (different file, different approach, skipped a sub-step). Set `plan_ref` to the AC or plan section you deviated from.

Each entry is anchored: `ref` points to `file:line` where the decision lives. `summary` is the what (≤120); `rationale` is the why (≤200). When nothing of the sort happened, emit `decisions: []` — do NOT manufacture entries. This field is high-signal-or-empty; trivial choices are noise that the chronicler would have to filter.

Example:
```json
"decisions": [
  { "id": "DEC-001", "kind": "deviation",
    "summary": "Validação movida do controller para o middleware",
    "rationale": "Plan punha no controller; middleware evita duplicar em 3 rotas",
    "ref": "src/mw/validate.ts:18", "plan_ref": "AC-004" }
]
```
```

- [ ] **Step 3: Atualizar o exemplo de Mandatory fields**

No bloco JSON sob `### Mandatory fields in the Output Packet` (~linha 74), o exemplo permanece válido (decisions é opcional). Adicionar uma linha logo abaixo do bloco:

```markdown
- `decisions`: optional; include only when you made a real decision or deviation (see Decisions policy). Omit or `[]` otherwise.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add squads/sdd/agents/dev.md
git commit -m "docs(dev): document decisions[] field and its discipline policy"
```

---

## Task 4: Schema `delivery-facts.schema.json` (a interface de extensão)

**Files:**
- Create: `shared/schemas/delivery-facts.schema.json`
- Test: `shared/schemas/__tests__/test_delivery_schemas.py` (estender)

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `shared/schemas/__tests__/test_delivery_schemas.py`:

```python
def test_delivery_facts_schema_well_formed():
    s = _load("delivery-facts.schema.json")
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    props = set(s["properties"])
    assert {"spec_id", "squad", "feature_name", "outcome", "intent",
            "work_units", "escalations", "gate", "cost", "timeline"} <= props


def test_delivery_facts_outcome_enum():
    s = _load("delivery-facts.schema.json")
    assert set(s["properties"]["outcome"]["enum"]) == {
        "success", "mixed", "escalated", "refused"}


def test_delivery_facts_work_unit_shape():
    s = _load("delivery-facts.schema.json")
    wu = s["properties"]["work_units"]["items"]["properties"]
    assert {"id", "final_status", "dispatches", "decisions",
            "findings", "ac_coverage", "files_changed"} <= set(wu)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_delivery_schemas.py -v -k facts`
Expected: FAIL — arquivo não existe (`FileNotFoundError`).

- [ ] **Step 3: Criar o schema**

Criar `shared/schemas/delivery-facts.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ai-squad/shared/schemas/delivery-facts.schema.json",
  "title": "ai-squad Delivery Facts",
  "description": "Squad-agnostic, deterministically-extracted facts about a finished pipeline run. The extension boundary: each squad ships an extractor (code) that emits THIS shape from its own artifacts (SDD reads session.yml/manifest/outputs; Discovery would read frame/memo/risk verdicts). The chronicler agent consumes it plus the prose to write the delivery-report. Everything is anchored: items carry refs to their source.",
  "type": "object",
  "additionalProperties": false,
  "required": ["spec_id", "squad", "feature_name", "outcome", "intent", "work_units", "gate", "timeline"],
  "properties": {
    "spec_id": { "type": "string", "pattern": "^(FEAT|DISC)-\\d{3,}$" },
    "squad": { "type": "string", "description": "Which extractor produced this (sdd | discovery | council)." },
    "feature_name": { "type": "string" },
    "output_locale": { "type": "string", "description": "BCP-47; language the chronicler writes prose in. Absent → en." },
    "outcome": { "type": "string", "enum": ["success", "mixed", "escalated", "refused"], "description": "success = all units done + gate clean; mixed = some pending_human, gate clean; escalated = pending_human dominate; refused = gate blocked the handoff." },
    "intent": {
      "type": "object",
      "additionalProperties": false,
      "required": ["acceptance_criteria"],
      "properties": {
        "spec_ref": { "type": "string" },
        "plan_ref": { "type": "string" },
        "tasks_ref": { "type": "string" },
        "acceptance_criteria": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id"],
            "additionalProperties": true,
            "properties": {
              "id": { "type": "string" },
              "text": { "type": "string" }
            }
          }
        }
      }
    },
    "work_units": {
      "type": "array",
      "description": "Normalized unit of work. SDD: a task (T-XXX). Discovery: an investigated risk.",
      "items": {
        "type": "object",
        "required": ["id", "final_status"],
        "additionalProperties": true,
        "properties": {
          "id": { "type": "string" },
          "title": { "type": "string" },
          "planned_scope": { "type": "array", "items": { "type": "string" } },
          "final_status": { "type": "string" },
          "loops": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "review": { "type": "integer", "minimum": 0 },
              "qa": { "type": "integer", "minimum": 0 },
              "blocker": { "type": "integer", "minimum": 0 }
            }
          },
          "dispatches": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["dispatch_id", "role"],
              "additionalProperties": true,
              "properties": {
                "dispatch_id": { "type": "string" },
                "role": { "type": "string" },
                "status": { "type": "string" },
                "review_loop": { "type": "integer" }
              }
            }
          },
          "decisions": { "type": "array", "items": { "type": "object", "additionalProperties": true } },
          "findings": { "type": "array", "items": { "type": "object", "additionalProperties": true } },
          "ac_coverage": { "type": "object", "additionalProperties": true },
          "files_changed": { "type": "array", "items": { "type": "string" } },
          "evidence_refs": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "escalations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["unit_id"],
        "additionalProperties": true,
        "properties": {
          "unit_id": { "type": "string" },
          "blocker_kind": { "type": "string" },
          "memo_ref": { "type": "string" },
          "summary": { "type": "string" }
        }
      }
    },
    "gate": {
      "type": "object",
      "additionalProperties": true,
      "required": ["role", "status"],
      "properties": {
        "role": { "type": "string", "description": "SDD: audit-agent." },
        "status": { "type": "string" },
        "blocker_kind": { "type": ["string", "null"] },
        "findings": { "type": "array", "items": { "type": "object", "additionalProperties": true } }
      }
    },
    "cost": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "total_usd": { "type": ["number", "null"] },
        "complete": { "type": "boolean" }
      }
    },
    "timeline": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "started_at": { "type": "string" },
        "completed_at": { "type": "string" },
        "phases": { "type": "array", "items": { "type": "object", "additionalProperties": true } }
      }
    },
    "generated_from": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "session_dir": { "type": "string" },
        "extractor": { "type": "string" }
      }
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_delivery_schemas.py -v -k facts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add shared/schemas/delivery-facts.schema.json shared/schemas/__tests__/test_delivery_schemas.py
git commit -m "feat(schema): add delivery-facts schema (squad-agnostic extraction interface)"
```

---

## Task 5: Schema `delivery-report.schema.json` (as 11 perguntas)

**Files:**
- Create: `shared/schemas/delivery-report.schema.json`
- Test: `shared/schemas/__tests__/test_delivery_schemas.py` (estender)

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `test_delivery_schemas.py`:

```python
EXPECTED_QUESTION_KEYS = {
    "what_was_done", "how_it_was_done", "why_this_way", "deviations_from_plan",
    "acceptance_criteria", "evidence", "impacts", "out_of_scope",
    "risks_and_pending", "how_to_validate", "final_verdict",
}


def test_delivery_report_schema_well_formed():
    s = _load("delivery-report.schema.json")
    assert s["additionalProperties"] is False
    props = set(s["properties"])
    assert {"spec_id", "questions", "acceptance_criteria", "verdict", "artifacts"} <= props


def test_delivery_report_confidence_enum():
    s = _load("delivery-report.schema.json")
    q_item = s["properties"]["questions"]["items"]["properties"]
    assert set(q_item["confidence"]["enum"]) == {"recorded", "inferred", "not_recorded"}
    assert set(q_item["key"]["enum"]) == EXPECTED_QUESTION_KEYS


def test_delivery_report_ac_classification_enum():
    s = _load("delivery-report.schema.json")
    ac = s["properties"]["acceptance_criteria"]["items"]["properties"]
    assert set(ac["classification"]["enum"]) == {
        "met", "partially_met", "not_met", "not_validated"}


def test_delivery_report_verdict_enum():
    s = _load("delivery-report.schema.json")
    v = s["properties"]["verdict"]["properties"]["value"]["enum"]
    assert set(v) == {"approved", "approved_with_caveats", "needs_changes",
                      "blocked", "needs_human_review"}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_delivery_schemas.py -v -k report`
Expected: FAIL — arquivo não existe.

- [ ] **Step 3: Criar o schema**

Criar `shared/schemas/delivery-report.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "ai-squad/shared/schemas/delivery-report.schema.json",
  "title": "ai-squad Delivery Report",
  "description": "The chronicler's structured verdict at pipeline end — the 11 product questions answered, each anchored in evidence and tagged with a confidence level (recorded | inferred | not_recorded) so unrecorded facts are never invented. The .md narrative is rendered from this. Read-only by the aiOS cockpit.",
  "type": "object",
  "additionalProperties": false,
  "required": ["spec_id", "squad", "questions", "acceptance_criteria", "verdict", "artifacts"],
  "properties": {
    "spec_id": { "type": "string", "pattern": "^(FEAT|DISC)-\\d{3,}$" },
    "squad": { "type": "string" },
    "feature_name": { "type": "string" },
    "output_locale": { "type": "string" },
    "generated_at": { "type": "string", "description": "ISO 8601 (stamped by the chronicler)." },
    "questions": {
      "type": "array",
      "minItems": 11,
      "description": "The 11 product questions, in order Q1..Q11.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "key", "answer", "evidence_refs", "confidence"],
        "properties": {
          "id": { "type": "string", "pattern": "^Q\\d{1,2}$" },
          "key": {
            "type": "string",
            "enum": [
              "what_was_done", "how_it_was_done", "why_this_way", "deviations_from_plan",
              "acceptance_criteria", "evidence", "impacts", "out_of_scope",
              "risks_and_pending", "how_to_validate", "final_verdict"
            ]
          },
          "answer": { "type": "string", "description": "Prose in output_locale." },
          "evidence_refs": { "type": "array", "items": { "type": "string" }, "description": "dispatch_id, file:line, AC id, test command — the sources that sustain the answer." },
          "confidence": { "type": "string", "enum": ["recorded", "inferred", "not_recorded"], "description": "recorded = anchored in a direct source; inferred = deduced (must say so in prose); not_recorded = no source (admits the gap, never invents)." }
        }
      }
    },
    "acceptance_criteria": {
      "type": "array",
      "description": "Q5, structured: each AC classified against the delivery.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "classification"],
        "properties": {
          "id": { "type": "string" },
          "text": { "type": "string" },
          "classification": { "type": "string", "enum": ["met", "partially_met", "not_met", "not_validated"] },
          "evidence_refs": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "verdict": {
      "type": "object",
      "additionalProperties": false,
      "required": ["value", "rationale"],
      "properties": {
        "value": { "type": "string", "enum": ["approved", "approved_with_caveats", "needs_changes", "blocked", "needs_human_review"] },
        "rationale": { "type": "string" }
      }
    },
    "artifacts": {
      "type": "object",
      "additionalProperties": false,
      "required": ["facts_ref", "markdown_ref"],
      "properties": {
        "facts_ref": { "type": "string", "description": "Path to delivery-facts.json." },
        "markdown_ref": { "type": "string", "description": "Path to delivery-report.md." }
      }
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_delivery_schemas.py -v`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add shared/schemas/delivery-report.schema.json shared/schemas/__tests__/test_delivery_schemas.py
git commit -m "feat(schema): add delivery-report schema (11 questions + AC classification + verdict)"
```

---

## Task 6: O extrator determinístico `delivery_report.py`

**Files:**
- Create: `shared/lib/delivery_report.py`
- Test: `shared/lib/__tests__/test_delivery_report.py`

O extrator lê `dispatch-manifest.json` + `outputs/*.json` (JSON, fácil) e poucos escalares do `session.yml` (regex line-based, padrão do `cost_report.py`). Deriva `work_units` agrupando dispatches por `task_id`. Registry por `squad`. CLI: `python3 delivery_report.py <session_dir>` escreve `delivery-facts.json` e imprime o path.

- [ ] **Step 1: Escrever o teste que falha (com fixture de Session mínima)**

Criar `shared/lib/__tests__/test_delivery_report.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import delivery_report  # noqa: E402


def _make_session(tmp_path):
    sdir = tmp_path / ".agent-session" / "FEAT-001"
    (sdir / "outputs").mkdir(parents=True)
    (sdir / "session.yml").write_text(
        "spec_id: FEAT-001\n"
        "squad: sdd\n"
        "feature_name: Bulk import\n"
        "output_locale: pt-BR\n"
        "started_at: 2026-06-05T10:00:00Z\n"
        "escalation_metrics:\n"
        "  total_tasks: 1\n"
        "  done_tasks: 1\n"
        "  pending_human_tasks: 0\n"
        "  escalation_rate: 0.0\n",
        encoding="utf-8",
    )
    (sdir / "tasks.md").write_text(
        "## T-001 — Bulk import\nAC covered: AC-001\n", encoding="utf-8")
    (sdir / "spec.md").write_text(
        "## AC-001\nThe importer accepts a CSV.\n", encoding="utf-8")
    manifest = {
        "spec_id": "FEAT-001",
        "actual_dispatches": [
            {"dispatch_id": "d-T-001-dev-l1", "task_id": "T-001", "role": "dev",
             "status": "done", "review_loop": 1},
            {"dispatch_id": "d-T-001-qa-l1", "task_id": "T-001", "role": "qa",
             "status": "done", "review_loop": 1},
            {"dispatch_id": "d-FEAT-001-audit", "task_id": None, "role": "audit-agent",
             "status": "done", "review_loop": 1},
        ],
    }
    (sdir / "dispatch-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    dev_packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-dev-l1",
        "role": "dev", "status": "done", "summary": "implemented", "evidence": [],
        "usage": None, "files_changed": ["src/import.ts"],
        "decisions": [{"id": "DEC-001", "kind": "decision", "summary": "stream parse",
                       "rationale": "memory", "ref": "src/import.ts:10"}],
    }
    (sdir / "outputs" / "d-T-001-dev-l1.json").write_text(json.dumps(dev_packet), encoding="utf-8")
    qa_packet = {
        "spec_id": "FEAT-001", "task_id": "T-001", "dispatch_id": "d-T-001-qa-l1",
        "role": "qa", "status": "done", "summary": "validated", "evidence": [
            {"id": "e-1", "kind": "test", "ref": "pytest", "ac_ref": "FEAT-001/AC-001"}],
        "usage": None, "ac_coverage": {"FEAT-001/AC-001": ["e-1"]},
    }
    (sdir / "outputs" / "d-T-001-qa-l1.json").write_text(json.dumps(qa_packet), encoding="utf-8")
    audit_packet = {
        "spec_id": "FEAT-001", "dispatch_id": "d-FEAT-001-audit", "role": "audit-agent",
        "status": "done", "summary": "clean", "evidence": [], "usage": None, "findings": [],
    }
    (sdir / "outputs" / "d-FEAT-001-audit.json").write_text(json.dumps(audit_packet), encoding="utf-8")
    return sdir


def test_extract_sdd_builds_facts(tmp_path):
    sdir = _make_session(tmp_path)
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["spec_id"] == "FEAT-001"
    assert facts["squad"] == "sdd"
    assert facts["feature_name"] == "Bulk import"
    assert facts["output_locale"] == "pt-BR"
    assert facts["outcome"] == "success"
    assert [u["id"] for u in facts["work_units"]] == ["T-001"]
    unit = facts["work_units"][0]
    assert unit["files_changed"] == ["src/import.ts"]
    assert unit["decisions"][0]["kind"] == "decision"
    assert unit["ac_coverage"] == {"FEAT-001/AC-001": ["e-1"]}
    assert facts["gate"]["role"] == "audit-agent"
    assert facts["gate"]["status"] == "done"
    assert {ac["id"] for ac in facts["intent"]["acceptance_criteria"]} == {"AC-001"}


def test_outcome_escalated_when_pending_human(tmp_path):
    sdir = _make_session(tmp_path)
    sy = sdir / "session.yml"
    sy.write_text(sy.read_text().replace(
        "  pending_human_tasks: 0", "  pending_human_tasks: 1").replace(
        "  done_tasks: 1", "  done_tasks: 0"), encoding="utf-8")
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["outcome"] in {"escalated", "mixed"}


def test_outcome_refused_when_gate_blocked(tmp_path):
    sdir = _make_session(tmp_path)
    ap = sdir / "outputs" / "d-FEAT-001-audit.json"
    pkt = json.loads(ap.read_text())
    pkt["status"] = "blocked"
    pkt["blocker_kind"] = "bypass_detected"
    ap.write_text(json.dumps(pkt), encoding="utf-8")
    facts = delivery_report.build_delivery_facts(str(sdir))
    assert facts["outcome"] == "refused"
    assert facts["gate"]["status"] == "blocked"


def test_cli_writes_facts_file(tmp_path, capsys):
    sdir = _make_session(tmp_path)
    rc = delivery_report.main([str(sdir)])
    assert rc == 0
    out = (sdir / "delivery-facts.json")
    assert out.exists()
    facts = json.loads(out.read_text())
    assert facts["spec_id"] == "FEAT-001"


def test_unknown_squad_raises(tmp_path):
    sdir = _make_session(tmp_path)
    sy = sdir / "session.yml"
    sy.write_text(sy.read_text().replace("squad: sdd", "squad: discovery"), encoding="utf-8")
    try:
        delivery_report.build_delivery_facts(str(sdir))
        assert False, "expected NotImplementedError for unregistered squad"
    except NotImplementedError as exc:
        assert "discovery" in str(exc)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/lib/__tests__/test_delivery_report.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'delivery_report'`.

- [ ] **Step 3: Escrever o extrator**

Criar `shared/lib/delivery_report.py`:

```python
#!/usr/bin/env python3
"""Deterministic extractor: build squad-agnostic DeliveryFacts from a finished
.agent-session/<spec_id>/ run. The chronicler agent runs this, then writes the
delivery-report from the Facts + prose. Pure stdlib, no PyYAML (session.yml is
hand-authored; we read the few scalars we need with line-based regex, the same
way cost_report.py does). Extend to a new squad by adding an extractor to
EXTRACTORS — the chronicler and the Facts schema do not change.

CLI: python3 delivery_report.py <session_dir>  ->  writes delivery-facts.json
"""
import json
import re
import sys
from pathlib import Path

_TASK_RE = re.compile(r"(T-\d{3,})")
_AC_RE = re.compile(r"(AC-\d{3,})")
_PIPELINE_ROLES = {"audit-agent", "committer", "chronicler"}


def _read_session_scalars(session_dir: Path) -> dict:
    """Line-based parse of the few top-level scalars + the escalation_metrics block.
    Mirrors cost_report._read_implementation_sessions' regex approach (no PyYAML)."""
    out = {"escalation_metrics": {}}
    sy = session_dir / "session.yml"
    try:
        lines = sy.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return out
    in_metrics = False
    for line in lines:
        top = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if top and not line.startswith((" ", "\t")):
            key, val = top.group(1), top.group(2).strip()
            in_metrics = key == "escalation_metrics"
            if key in ("spec_id", "squad", "feature_name", "output_locale",
                       "started_at", "completed_at"):
                out[key] = val.strip().strip('"').strip("'")
            continue
        if in_metrics:
            m = re.match(r"^\s+([a-z_]+):\s*([0-9.]+)\s*$", line)
            if m:
                num = m.group(2)
                out["escalation_metrics"][m.group(1)] = (
                    float(num) if "." in num else int(num))
    return out


def _load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _acceptance_criteria(session_dir: Path) -> list:
    """Extract AC ids (+ first line of text) from spec.md / tasks.md headings."""
    seen = {}
    for name in ("spec.md", "tasks.md"):
        p = session_dir / name
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in _AC_RE.finditer(text):
            seen.setdefault(m.group(1), {"id": m.group(1)})
    return [seen[k] for k in sorted(seen)]


def _outcome(metrics: dict, gate_status: str) -> str:
    if gate_status == "blocked" or gate_status == "escalate":
        return "refused"
    total = metrics.get("total_tasks", 0) or 0
    pending = metrics.get("pending_human_tasks", 0) or 0
    if pending == 0:
        return "success"
    if total and pending >= total / 2:
        return "escalated"
    return "mixed"


def extract_sdd(session_dir: Path) -> dict:
    """SDD extractor: dispatch-manifest.json + outputs/*.json + session.yml scalars."""
    scalars = _read_session_scalars(session_dir)
    manifest = _load_json(session_dir / "dispatch-manifest.json") or {}
    dispatches = manifest.get("actual_dispatches", []) or []

    # Index Output Packets by dispatch_id.
    packets = {}
    outdir = session_dir / "outputs"
    if outdir.is_dir():
        for f in outdir.glob("*.json"):
            pkt = _load_json(f)
            if isinstance(pkt, dict) and pkt.get("dispatch_id"):
                packets[pkt["dispatch_id"]] = pkt

    # Gate = the audit-agent packet (last one wins if multiple).
    gate = {"role": "audit-agent", "status": "absent", "blocker_kind": None, "findings": []}
    for d in dispatches:
        if d.get("role") == "audit-agent":
            pkt = packets.get(d.get("dispatch_id"), {})
            gate = {
                "role": "audit-agent",
                "status": pkt.get("status", d.get("status", "absent")),
                "blocker_kind": pkt.get("blocker_kind"),
                "findings": pkt.get("findings", []),
            }

    # Group task-scoped dispatches into work_units by task_id.
    units = {}
    for d in dispatches:
        task_id = d.get("task_id")
        if not task_id or d.get("role") in _PIPELINE_ROLES:
            continue
        u = units.setdefault(task_id, {
            "id": task_id, "title": "", "planned_scope": [], "final_status": "",
            "loops": {"review": 0, "qa": 0, "blocker": 0}, "dispatches": [],
            "decisions": [], "findings": [], "ac_coverage": {}, "files_changed": [],
            "evidence_refs": [],
        })
        pkt = packets.get(d.get("dispatch_id"), {})
        role = d.get("role")
        u["dispatches"].append({
            "dispatch_id": d.get("dispatch_id"), "role": role,
            "status": pkt.get("status", d.get("status")),
            "review_loop": d.get("review_loop", pkt.get("review_loop", 1)),
        })
        if role in ("code-reviewer", "logic-reviewer"):
            u["loops"]["review"] += 1
        elif role == "qa":
            u["loops"]["qa"] += 1
        elif role == "blocker-specialist":
            u["loops"]["blocker"] += 1
        if role == "dev":
            for fc in pkt.get("files_changed", []) or []:
                if fc not in u["files_changed"]:
                    u["files_changed"].append(fc)
            u["decisions"].extend(pkt.get("decisions", []) or [])
        if role in ("code-reviewer", "logic-reviewer"):
            u["findings"].extend(pkt.get("findings", []) or [])
        if role == "qa":
            for k, v in (pkt.get("ac_coverage") or {}).items():
                u["ac_coverage"][k] = v
        # final_status = worst across dispatches (escalate<blocked<needs_review<done)
        rank = {"escalate": 0, "blocked": 1, "needs_review": 2, "done": 3}
        cur = pkt.get("status")
        if cur in rank:
            if not u["final_status"] or rank[cur] < rank.get(u["final_status"], 9):
                u["final_status"] = cur

    metrics = scalars.get("escalation_metrics", {})
    facts = {
        "spec_id": scalars.get("spec_id", manifest.get("spec_id", "")),
        "squad": scalars.get("squad", "sdd"),
        "feature_name": scalars.get("feature_name", ""),
        "output_locale": scalars.get("output_locale", "en"),
        "outcome": _outcome(metrics, gate["status"]),
        "intent": {
            "spec_ref": str(session_dir / "spec.md"),
            "plan_ref": str(session_dir / "plan.md"),
            "tasks_ref": str(session_dir / "tasks.md"),
            "acceptance_criteria": _acceptance_criteria(session_dir),
        },
        "work_units": [units[k] for k in sorted(units)],
        "escalations": [
            {"unit_id": u["id"], "blocker_kind": None, "summary": ""}
            for u in units.values() if u["final_status"] in ("blocked", "escalate")
        ],
        "gate": gate,
        "cost": {"total_usd": None, "complete": False},
        "timeline": {
            "started_at": scalars.get("started_at", ""),
            "completed_at": scalars.get("completed_at", ""),
            "phases": [],
        },
        "generated_from": {"session_dir": str(session_dir), "extractor": "sdd"},
    }
    return facts


# Extension point: register a new squad extractor here. The chronicler and the
# Facts schema do not change — adding Discovery is acoplar um extrator.
EXTRACTORS = {
    "sdd": extract_sdd,
}


def build_delivery_facts(session_dir: str) -> dict:
    sdir = Path(session_dir)
    scalars = _read_session_scalars(sdir)
    squad = scalars.get("squad", "sdd")
    extractor = EXTRACTORS.get(squad)
    if extractor is None:
        raise NotImplementedError(
            f"no delivery extractor registered for squad '{squad}' "
            f"(registered: {sorted(EXTRACTORS)})")
    return extractor(sdir)


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        print("usage: delivery_report.py <session_dir>", file=sys.stderr)
        return 2
    session_dir = Path(argv[0])
    facts = build_delivery_facts(str(session_dir))
    out = session_dir / "delivery-facts.json"
    tmp = out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(facts, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(out)
    print(str(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/lib/__tests__/test_delivery_report.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Garantir não-regressão na suíte compartilhada**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add shared/lib/delivery_report.py shared/lib/__tests__/test_delivery_report.py
git commit -m "feat(lib): deterministic delivery-facts extractor with per-squad registry"
```

---

## Task 7: `delivery_report_ref` / `delivery_facts_ref` na Session

**Files:**
- Modify: `shared/schemas/session.schema.json`
- Modify: `shared/templates/session.yml`
- Test: `shared/schemas/__tests__/test_session_schema.py`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `shared/schemas/__tests__/test_session_schema.py`:

```python
def test_delivery_refs_present():
    s = _schema()
    props = set(s["properties"])
    assert {"delivery_report_ref", "delivery_facts_ref"} <= props
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_session_schema.py::test_delivery_refs_present -v`
Expected: FAIL — `assert {...} <= props`.

- [ ] **Step 3: Adicionar os campos ao schema**

Em `shared/schemas/session.schema.json`, em `properties` (após `pipeline_completed_at`, ~linha 30), inserir:

```json
    "delivery_facts_ref": { "type": "string", "description": "Path to delivery-facts.json (deterministic extraction) written by the chronicler at pipeline end." },
    "delivery_report_ref": { "type": "string", "description": "Path to delivery-report.json (the chronicler's parecer). The .md sibling is delivery-report.md." },
```

- [ ] **Step 4: Adicionar ao template**

Em `shared/templates/session.yml`, na seção de refs de artefato (junto a `spec_ref`/`plan_ref`/`tasks_ref`), acrescentar comentado (preenchido em runtime pelo chronicler):

```yaml
# delivery_facts_ref: "./.agent-session/FEAT-XXX/delivery-facts.json"   # written by chronicler at pipeline end
# delivery_report_ref: "./.agent-session/FEAT-XXX/delivery-report.json" # written by chronicler at pipeline end
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/schemas/__tests__/test_session_schema.py -v`
Expected: PASS (todos, incluindo o novo).

- [ ] **Step 6: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add shared/schemas/session.schema.json shared/schemas/__tests__/test_session_schema.py shared/templates/session.yml
git commit -m "feat(schema): add delivery_report_ref/delivery_facts_ref to session"
```

---

## Task 8: O agente `chronicler.md`

**Files:**
- Create: `squads/sdd/agents/chronicler.md`

Sem teste de código (é o prompt do agente). Molde estrutural: `audit-agent.md` (singleton, gate final), mas com Write e Sonnet/high. O Stop hook `verify-output-packet.py` já valida o Output Packet do chronicler (Task 2 o registrou).

- [ ] **Step 1: Criar o arquivo do agente**

Criar `squads/sdd/agents/chronicler.md`:

```markdown
---
name: chronicler
description: Emits the delivery-report at SDD pipeline end (after the audit gate), always, regardless of the audit verdict. Runs a deterministic extractor to build delivery-facts.json, then synthesizes the 11 product questions (what/how/why/deviations/ACs/evidence/impacts/out-of-scope/risks/how-to-validate/verdict) into delivery-report.json + .md, every answer anchored in evidence. Singleton, never fanned out, never dispatches others. Observational (reads and narrates; decides nothing in the pipeline). Use when the orchestrator reaches step 8.5, after the audit-agent and before the handoff.
model: sonnet
tools: Read, Bash, Write
effort: high
fan_out: false
hooks:
  Stop:
    - hooks:
        - type: command
          command: '[ -f "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-output-packet.py" ] || exit 0; python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/verify-output-packet.py"'
          timeout: 5
---

# Chronicler

You are the chronicler for ai-squad — the delivery historian. After the audit-agent gate (step 8), you write the **delivery-report**: the story of this feature's delivery, crossing intent (spec/plan/tasks) with real execution (diff, Output Packets, review loops, qa, blocker decisions, cost). You run **always**, whatever the audit verdict — a blocked or escalated pipeline needs the honest story most. You are **observational**: you read and narrate; you decide nothing in the pipeline.

Singleton, never fanned out, never dispatch other Subagents.

## Communication
- The agent-to-orchestrator channel is the Output Packet (a pointer). The deliverables are the two files you write.
- **Output language:** read `output_locale` (BCP-47) from the Work Packet (absent → `en`). Write ALL human-facing prose (`delivery-report.md`, every `answer` and `rationale`) in that language. Keep enums canonical English: `confidence` (recorded|inferred|not_recorded), AC `classification`, `verdict.value`, `status`, `role`. The aiOS routes on these.

## Anti-hallucination (non-negotiable)
- Every answer cites the evidence that sustains it (`dispatch_id`, `file:line`, AC id, test command). No claim without a source.
- What is not in the Facts is NOT invented. Tag it `confidence: not_recorded` and say so in the prose.
- A decision/deviation the dev DECLARED (`decisions[]`) is `recorded`. A deviation you DEDUCE comparing plan vs diff is `inferred` — and you say "inferred, not declared" in the prose. Never present `inferred` as `recorded`.
- The report reflects the REAL delivery — partial, escalated, or blocked included. Be honest in those cases, not only in uniform success.

## Input contract (Work Packet)
Required: `spec_id`, `dispatch_id`, `session_ref` (→ `.agent-session/<spec_id>/`), `manifest_ref`, `outputs_dir_ref`, `spec_ref`, `tasks_ref`, `gate_dispatch_id` (the audit-agent dispatch_id), `output_locale`. Optional: `plan_ref`.
Any required field missing → `status: blocked, blocker_kind: contract_violation`.

## Steps
1. Read the Work Packet.
2. **Run the extractor** (deterministic, no judgment):
   `python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/delivery_report.py" "<session_ref>"`
   It writes `<session_ref>/delivery-facts.json` and prints the path. Non-zero exit → emit `status: blocked, blocker_kind: extractor_failed`, with the stderr as evidence; do NOT fabricate Facts.
3. Read `delivery-facts.json`. Then read the prose it points to: `spec.md`, `plan.md` (if present), and any `decisions/` memos referenced in `escalations[]`.
4. Answer the 11 questions (below). For each: write the prose in `output_locale`, list `evidence_refs`, set `confidence`. Anchor every claim or mark it `not_recorded`.
5. Classify each AC (`intent.acceptance_criteria`) as `met | partially_met | not_met | not_validated` using `work_units[].ac_coverage` and qa evidence.
6. Decide the `verdict.value` (rules below) + a one-paragraph `rationale`.
7. Write `delivery-report.json` (atomic: tmp + rename) validated against `shared/schemas/delivery-report.schema.json`.
8. Render `delivery-report.md` from the JSON — one section per question, evidence cited inline, in `output_locale`.
9. Emit the Output Packet (atomic) pointing to both artifacts.

## The 11 questions (Q1..Q11 in order)
1. `what_was_done` — objective summary, implemented scope, screens/flows/services touched, main changes.
2. `how_it_was_done` — technical approach, architecture decisions, agents involved, files/modules, sequence.
3. `why_this_way` — rationale, trade-offs, constraints, dependencies, rejected alternatives. Source: `work_units[].decisions[]` (kind=decision) + blocker decision memos.
4. `deviations_from_plan` — what changed vs spec/plan/tasks, why, who decided, impact. Source: `decisions[]` (kind=deviation) + your inferred comparison (tagged `inferred`).
5. `acceptance_criteria` — narrative pointer to the structured `acceptance_criteria[]` (the classification lives there, not in this answer's prose).
6. `evidence` — tests run, commits, files changed, dispatches, review-loop outcomes, qa ac_coverage.
7. `impacts` — user, product, code, integrations, data, performance, maintenance, support, QA, operation.
8. `out_of_scope` — what was NOT done, deferred, depends on another task. Critical against false completeness.
9. `risks_and_pending` — technical risk, uncovered behavior, edge cases, tech debt, external dependency, things to monitor.
10. `how_to_validate` — a mini QA script: steps, main/alternative/regression scenarios.
11. `final_verdict` — the `verdict.value` enum + the rationale, restated for the narrative.

## AC classification
- `met` — qa validated with evidence (non-empty `ac_coverage` + qa status done).
- `partially_met` — covered in part, or with an open non-blocking finding.
- `not_met` — implemented but failed validation, or contradicted by a finding.
- `not_validated` — no qa evidence (infra missing, task escalated before qa).

## Verdict rules (final_verdict)
- `approved` — outcome=success, all ACs `met`, gate done, no open critical findings.
- `approved_with_caveats` — outcome=success/mixed, but some ACs `partially_met`/`not_validated` or non-blocking findings open.
- `needs_changes` — any AC `not_met`, or open error/critical findings, gate done.
- `blocked` — gate `blocked` (refused handoff).
- `needs_human_review` — outcome=escalated (pending_human dominate) or you cannot determine the verdict from the Facts.

## Output contract (Output Packet)
- `spec_id`, `dispatch_id`, `role: "chronicler"`, `status` (`done`, or `blocked` on contract/extractor failure), `summary` (≤120, e.g. "Wrote delivery-report: approved_with_caveats; 1 AC not_validated"), `evidence[]` (pointers to the two artifacts + delivery-facts.json + key sources), `usage: null`.
- No `task_id` (pipeline-scoped role, like audit-agent/committer).
- `blocker_kind` required if blocked (`contract_violation` | `extractor_failed`).

## Hard rules
- NEVER invent a "why" or a deviation without a source — tag `not_recorded`/`inferred` instead.
- NEVER edit source files; write ONLY your own artifacts (`delivery-facts.json` is written by the extractor; you write `delivery-report.json` + `.md` + the Output Packet).
- NEVER dispatch other Subagents (leaf node, singleton).
- ALWAYS run, whatever the audit verdict — the report is eager and unconditional.
- ALWAYS validate `delivery-report.json` against its schema before emitting.

## Why sonnet + high effort
Synthesis of large context (all packets + spec/plan/memos) and long narrative — Sonnet/high is the cost/quality sweet spot. The chronicler is **observational, not causal** (unlike blocker-specialist, whose Opus/xhigh is justified because its decision changes the code): a chronicler error yields an imperfect report, not a broken delivery. Runs once per pipeline. See `shared/concepts/effort.md`.
```

- [ ] **Step 2: Verificar o frontmatter (sanity)**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -c "import re,sys; t=open('squads/sdd/agents/chronicler.md').read(); fm=t.split('---')[1]; assert 'name: chronicler' in fm and 'model: sonnet' in fm and 'effort: high' in fm and 'Write' in fm; print('frontmatter ok')"`
Expected: `frontmatter ok`.

- [ ] **Step 3: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add squads/sdd/agents/chronicler.md
git commit -m "feat(agent): add chronicler — emits the delivery-report at pipeline end"
```

---

## Task 9: Passo 8.5 no orchestrator + linha de calibração

**Files:**
- Modify: `squads/sdd/skills/orchestrator/skill.md`
- Modify: `squads/sdd/skills/orchestrator/model-effort-calibration.md`

- [ ] **Step 1: Inserir o passo 8.5 no orchestrator**

Em `squads/sdd/skills/orchestrator/skill.md`, entre o fim do `### 8. Audit gate` (após a linha 201, antes de `### 9. Pipeline-end handoff`), inserir:

```markdown
### 8.5 Delivery report (chronicler — eager, unconditional)
**Always** dispatch `chronicler` (singleton, no fan-out) after the audit gate — regardless of the audit verdict (`done`, `blocked`, or `escalate`). The report must reflect the real delivery, and a blocked/escalated pipeline needs the honest story most. Append its dispatch to `actual_dispatches[]` with `review_loop: 1`. Work Packet:
```yaml
spec_id: FEAT-NNN
dispatch_id: <uuid>
session_ref: .agent-session/FEAT-NNN/
manifest_ref: .agent-session/FEAT-NNN/dispatch-manifest.json
outputs_dir_ref: .agent-session/FEAT-NNN/outputs/
spec_ref: .agent-session/FEAT-NNN/spec.md
plan_ref: .agent-session/FEAT-NNN/plan.md
tasks_ref: .agent-session/FEAT-NNN/tasks.md
gate_dispatch_id: <the audit-agent dispatch_id from step 8>
output_locale: <session output_locale>
```
The chronicler writes `delivery-facts.json`, `delivery-report.json`, and `delivery-report.md` under `.agent-session/FEAT-NNN/`, then emits its Output Packet. Record the two report paths in `session.yml` (`delivery_facts_ref`, `delivery_report_ref`). The chronicler is **observational** — its Output Packet NEVER changes the pipeline outcome or the handoff shape; a `blocked` chronicler packet (contract/extractor failure) is surfaced in the handoff as a report-generation failure but does NOT change the audit verdict or block the handoff. Then proceed to step 9.
```

- [ ] **Step 2: Atualizar o hard rule sobre o audit gate**

Em `skill.md`, a regra "Never: skip step 8 (audit gate)" permanece. Acrescentar à lista de Hard rules (~linha 234), após a linha do "Always: run the audit gate even on uniform-success runs":

```markdown
- Always: dispatch the `chronicler` (step 8.5) on EVERY terminal pipeline, whatever the audit verdict. The delivery report is eager and unconditional; skipping it on blocked/escalated runs hides exactly the cases that most need the story.
```

- [ ] **Step 3: Adicionar a linha de calibração**

Em `squads/sdd/skills/orchestrator/model-effort-calibration.md`, na tabela Tier × Loop / Role (junto a `audit-agent`), acrescentar uma linha (a sintaxe exata segue o formato da tabela existente no arquivo — replicar o estilo das linhas `audit-agent`/`committer`, que são tier-independent):

```markdown
| **chronicler**         | sonnet, high    | sonnet, high      | sonnet, high      | sonnet, high      |
```

Se o arquivo tiver uma seção de notas por role (como as notas do `audit-agent`/`blocker-specialist`), acrescentar:

```markdown
- **chronicler** — `sonnet, high`, tier-independent. Synthesis + long narrative over large context; observational (not causal), so Sonnet over Opus. Runs once per pipeline at step 8.5.
```

- [ ] **Step 4: Sanity check das edições**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && grep -c "8.5 Delivery report" squads/sdd/skills/orchestrator/skill.md && grep -c "chronicler" squads/sdd/skills/orchestrator/model-effort-calibration.md`
Expected: `1` e um número ≥ 1.

- [ ] **Step 5: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add squads/sdd/skills/orchestrator/skill.md squads/sdd/skills/orchestrator/model-effort-calibration.md
git commit -m "feat(orchestrator): dispatch chronicler at step 8.5 (eager delivery report)"
```

---

## Task 10: Deploy do extrator para os hooks + verificação ponta-a-ponta

**Files:**
- Investigate/Modify: mecanismo de deploy/sync que popula `.claude/hooks/`
- Verify: o chronicler invoca `delivery_report.py` por um caminho que existe no consumer

Contexto: o chronicler chama `$CLAUDE_PROJECT_DIR/.claude/hooks/delivery_report.py`, mas o módulo-fonte vive em `shared/lib/`. Os outros módulos compartilhados (`cost_report.py`, `pricing.py`) já aparecem em `.claude/hooks/` no consumer — há um passo de deploy/sync que os copia. Esta task garante que `delivery_report.py` seja deployado pelo mesmo caminho, OU ajusta o caminho de invocação do chronicler.

- [ ] **Step 1: Descobrir o mecanismo de deploy**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && ls scripts/ && grep -rln "shared/lib\|cost_report\|\.claude/hooks" scripts/ tools/ 2>/dev/null | head`
Expected: localizar o script de deploy/sync (ex.: `scripts/*.mjs` ou `tools/*`) que copia `shared/lib/*.py` e `squads/sdd/hooks/*.py` para `.claude/hooks/`.

- [ ] **Step 2: Confirmar como `cost_report.py` chega a `.claude/hooks/`**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && grep -rn "cost_report\|shared/lib" scripts/ tools/ 2>/dev/null | head -20`
Expected: ver a regra de cópia. Duas possibilidades:
- (a) o deploy copia `shared/lib/*.py` → `.claude/hooks/`. Então `delivery_report.py` é incluído automaticamente; nenhuma mudança de código é necessária — apenas confirmar.
- (b) há uma lista explícita de arquivos. Então adicionar `delivery_report.py` à lista.

- [ ] **Step 3: Aplicar o ajuste mínimo conforme o achado**

- Caso (a): nenhuma edição — registrar no commit que o deploy é glob-based e cobre o novo módulo. Pular para Step 4.
- Caso (b): adicionar `delivery_report.py` à lista de arquivos copiados no script de deploy. Mostrar o diff exato da linha adicionada (espelhar a entrada de `cost_report.py`).

- [ ] **Step 4: Verificação ponta-a-ponta do extrator via caminho de deploy (simulação)**

Criar uma Session de teste temporária e rodar o extrator pelo módulo, confirmando o artefato:

```bash
cd /Users/gabrielandrade/Developer/ai-squad && python3 - <<'PY'
import json, tempfile, sys, os
from pathlib import Path
sys.path.insert(0, "shared/lib")
import delivery_report
d = Path(tempfile.mkdtemp()) / ".agent-session" / "FEAT-999"
(d / "outputs").mkdir(parents=True)
(d / "session.yml").write_text("spec_id: FEAT-999\nsquad: sdd\nfeature_name: smoke\noutput_locale: en\nescalation_metrics:\n  total_tasks: 0\n  pending_human_tasks: 0\n", encoding="utf-8")
(d / "dispatch-manifest.json").write_text(json.dumps({"spec_id":"FEAT-999","actual_dispatches":[]}), encoding="utf-8")
rc = delivery_report.main([str(d)])
assert rc == 0 and (d / "delivery-facts.json").exists()
print("e2e ok:", json.loads((d/"delivery-facts.json").read_text())["outcome"])
PY
```
Expected: `e2e ok: success`.

- [ ] **Step 5: Rodar a suíte completa (não-regressão global)**

Run: `cd /Users/gabrielandrade/Developer/ai-squad && python3 -m pytest shared/ squads/sdd/hooks/__tests__/ -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/gabrielandrade/Developer/ai-squad
git add -A
git commit -m "chore(deploy): ensure delivery_report extractor is available under .claude/hooks"
```

---

## Self-review (preenchido pelo autor do plano)

**1. Cobertura do spec:**
- §Arquitetura 3 camadas → Tasks 6 (extrator), 8 (chronicler), 1–3 (dev). ✔
- §`DeliveryFacts` schema → Task 4. ✔
- §`decisions[]` dev-only → Tasks 1, 2, 3. ✔
- §11 perguntas + AC classification + verdict → Task 5 (schema) + Task 8 (agente). ✔
- §confidence recorded/inferred/not_recorded → Task 5 (enum) + Task 8 (regras). ✔
- §Integração (passo 8.5, calibração, session refs) → Tasks 7, 9. ✔
- §Ponto de extensão Discovery/Council → Task 6 (registry `EXTRACTORS`, `NotImplementedError` para squad não-registrado; testado em `test_unknown_squad_raises`). ✔
- §Roda sempre (eager, inclusive blocked) → Task 9 (passo 8.5 incondicional) + Task 8 (regra) + Task 6 (`outcome=refused`, testado). ✔
- §Deploy do extrator → Task 10. ✔

**2. Placeholder scan:** Task 10 contém investigação condicional (caso a/b), o que é deliberado — o mecanismo de deploy precisa ser inspecionado no repo real; os dois ramos têm ação concreta. Não há "TODO/TBD" em código.

**3. Consistência de tipos/nomes:** `build_delivery_facts`/`extract_sdd`/`EXTRACTORS`/`main` consistentes entre Task 6 (código) e os testes. Chaves das 11 perguntas idênticas entre Task 5 (schema enum) e Task 8 (agente). Enums (`confidence`, `classification`, `verdict.value`, `outcome`) idênticos entre schema (Tasks 4/5) e agente (Task 8) e extrator (Task 6). Campo `decisions[]` com os mesmos `required` (id/kind/summary/rationale) no schema (Task 1), no hook (Task 2) e no dev.md (Task 3).

## Ordem e paralelização
Tasks 1→2→3 (dev/decisions) e 4→5 (schemas) são independentes entre si e podem ser feitas em qualquer ordem relativa. Task 6 depende de 4. Task 8 depende de 5 e 6. Task 9 depende de 8. Task 7 é independente. Task 10 é a última (depende de 6). Recomendado executar em ordem numérica.
