# `session.yml` como contrato versionado — schema canônico + drift de `notes` consertado na origem

**Data:** 2026-06-02
**Status:** design aprovado (brainstorming), pendente de plano de implementação
**Escopo:** Spec #2 de 2 (a outra: contrato/emissão do `cost-report.json`, ver `2026-06-02-cost-report-ssot-design.md`). Trata o artefato de runtime mais consumido — o `session.yml` — tornando-o um contrato de máquina versionado, consolidando seus campos reais hoje espalhados, consertando o drift do campo `notes` na origem, e adicionando uma rede de segurança barata contra escrita malformada. NÃO muda a semântica de nenhum campo nem o fluxo de Phases.

## Contexto

Um cockpit observador externo (read-only) consome os artefatos de runtime que a pipeline SDD grava em `.agent-session/<spec_id>/`. O artefato **mais** consumido é o `session.yml`: dele o consumidor deriva o Kanban inteiro — `current_phase`, `task_states`, `escalation_metrics`, `phase_history`, timeline.

Em `shared/schemas/` existem dois contratos JSON Schema versionados: `output-packet.schema.json` e `dispatch-manifest.schema.json`. Para o `session.yml` — o artefato mais consumido de todos — **não há schema canônico nenhum.** A única descrição é uma seção de prosa chamada "Complete schema" em `shared/concepts/session.md:169-255`: um bloco YAML comentado, legível por humano, mas que máquina nenhuma valida.

Essa assimetria — os artefatos máquina-a-máquina têm contrato, o artefato mais lido por máquina não tem — é a falha que esta spec ataca.

## Problema

O `session.yml` não é confiável como fonte única de verdade por três motivos encadeados.

1. **Não há contrato de máquina.** Sem `session.schema.json`, o consumidor acopla-se a um formato implícito, sem versão e sem validação. Qualquer mudança de campo quebra o consumidor em silêncio.

2. **A própria documentação já derivou incompleta.** A ausência de contrato único deixou a seção "Complete schema" de `session.md` mentir sobre ser completa: cinco campos que o framework realmente escreve estão **ausentes** dela —
   - `implementation_sessions` (escrito por `register-impl-session.py:60`),
   - `auto_approved_by`, `pm_cost_cap_usd`, `notes` (documentados só em `shared/concepts/pm-bypass.md`),
   - `pipeline_mode` (prosa do spec-writer/orchestrator),
   - `audit_override` (prosa do orchestrator, `orchestrator/skill.md:196`).

   Quem lê só a `session.md` não vê o artefato real.

3. **O `notes` sofre drift de formato — e a causa-raiz está na spec, não só no consumidor.** O sintoma observado: o `notes` chega ora como array de objetos, ora como string solta, forçando o consumidor a tratar formato dual. A análise revelou **duas causas somadas**:

   - **Inconsistência interna do próprio framework.** Os três tipos de entrada que se acumulam no array `session.yml.notes` não concordam em como se identificam: `pm_decision` e `pm_escalation` carregam um campo discriminador `kind:` no topo (`pm-bypass.md:90,28`); `audit_override` **não tem `kind`** — identifica-se pela chave aninhada `audit_override:` (`orchestrator/skill.md:196`). Há dois esquemas de discriminação concorrentes. Então **mesmo um LLM perfeitamente obediente** produz um array heterogêneo.
   - **YAML escrito por prosa de LLM, sem contrato a validar.** O `session.yml` é montado à mão pela prosa das Skills (`tmp + rename`, sem `yaml.dump`) e por um único hook que faz manipulação de texto puro (`register-impl-session.py:40-64`, docstring: *"Pure text edit — no PyYAML, matching the other hooks"*). O PM autônomo, que substitui todos os gates humanos e escreve `notes` sozinho, tem licença de fato para desviar — inclusive gravar `notes:` como string solta — sem que nada perceba.

A consequência prática: o consumidor não tem um artefato em que confiar incondicionalmente, então reimplementa tolerância a formato dual — sintoma clássico de "tapar buraco no consumer" em vez de consertar o framework.

## Não-objetivos (fora de escopo)

- **Mudar a semântica de qualquer campo ou o fluxo de Phases.** O conteúdo dos campos é tratado como está; os únicos acréscimos são o discriminador `kind` no `audit_override` e o artefato de status.
- **Enforcement de schema na escrita** (validar contra o schema a cada `write` do `session.yml`). Rejeitado por custo: exigiria introduzir PyYAML (ou parser equivalente) exatamente no caminho de escrita que evita parser de propósito. Ver "Design proposto → C rejeitada".
- **Normalizar/coagir `notes` malformado no hook de Stop.** Rejeitado: seria tapar buraco em vez de consertar na origem, e violaria a regra de ownership (só o orchestrator escreve o `session.yml` em Phase 4). O lint **detecta e sinaliza**; o conserto está na padronização do `kind` + prosa.
- **Qualquer mudança no repo consumidor.** Esta spec é projeto-agnóstica e não cita nenhum consumidor. A mudança de consumo vai num handoff separado (ver Anexo A).

## Design proposto

Quatro peças no lado produtor (ai-squad). Nenhuma muda a semântica do estado; todas tornam o artefato existente um contrato confiável.

### A. Schema canônico `shared/schemas/session.schema.json`

Um JSON Schema (mesma draft e estilo dos irmãos `output-packet`/`dispatch-manifest`) que vira a fonte única de verdade do `session.yml`. Consolida num só lugar **todos** os campos reais, hoje espalhados por quatro fontes:

| Origem hoje | Campos |
|---|---|
| `session.md` (já documentado) | `spec_id`, `feature_name`, `schema_version`, `spec_ref`/`plan_ref`/`tasks_ref`, `started_at`/`last_activity_at`/`completed_at`, `current_phase` (enum), `current_owner`, `output_locale`, `planned_phases`, `pipeline_started_at`/`pipeline_completed_at`, `task_states` (sub-estrutura completa incl. `packet_retries`), `budget_defaults`, `escalation_metrics`, `phase_history` |
| `pm-bypass.md` (faltando em session.md) | `auto_approved_by`, `pm_cost_cap_usd`, `notes` |
| prosa orchestrator / hook | `pipeline_mode`, `implementation_sessions` |

Detalhes do contrato:

- `current_phase`: enum `specify | plan | tasks | implementation | paused | done | escalated`.
- `spec_id`: padrão `^(FEAT|DISC)-\d{3,}$` (consistente com `identity.md`; `task_id` legado aceito como alias na leitura — não no schema novo).
- `schema_version`: `const: 1`. **Não há bump** — é a primeira vez que existe schema de máquina; não estamos mudando um contrato, estamos formalizando o que já existia.
- `task_states`: objeto cujas chaves casam `^T-\d{3,}$`, valor com `state` (enum), contadores (`review_loops`, `qa_loops`, `blocker_calls`, `packet_retries`), hashes de progresso, timestamps.

**Alternativa rejeitada:** schema parcial (só os campos "importantes"). A assimetria com os irmãos é justamente "ter contrato completo"; um schema parcial recriaria o problema de campos sem contrato. Trade-off: o schema fica maior, mas é mecânico e espelha estado já existente.

### B. Drift de `notes` consertado na origem — discriminador único `kind`

- **Padronizar todas as entradas no campo `kind`.** `pm_decision` e `pm_escalation` já têm. **Mudar `audit_override`** de `{ audit_override: {...} }` para `{ kind: "audit_override", path, authorized_by, audit_dispatch_id }` na prosa do orchestrator (`orchestrator/skill.md:196`).
- **No schema, `notes` é um array cujos itens são uma união discriminada por `kind`** (`oneOf` sobre `pm_decision`, `pm_escalation`, `audit_override`). Isso garante por contrato que `notes` é **sempre uma lista de objetos**, nunca um escalar.
- **Endurecer a prosa de escrita.** Os pontos de escrita (`pm-approval-gate.md:55-60`, `designer/skill.md:115`, `shared/concepts/pm-bypass.md:65`, `orchestrator/skill.md:196`) hoje dizem "append the entry below" mostrando um bloco. Adicionar uma linha imperativa explícita: *"`notes` é SEMPRE uma lista YAML de objetos, cada um com campo `kind`; NUNCA um escalar; não invente campos fora do schema."* Barato e mira direto o caso do PM autônomo que "muda na mão e inventa".

**Trade-off honesto:** mudar o shape do `audit_override` é uma quebra de formato. Mas Sessions são efêmeras e gitignored (`/ship` entre features), então não há base instalada a migrar — o risco é a janela estreita de uma Session em voo durante o upgrade, que o consumidor tolera lendo ambos os shapes por uma transição. Por isso **não** justifica bump de `schema_version`.

### C. Rede de segurança — lint read-back no hook de Stop

No mesmo hook de Stop que a Spec #1 usa para emissão garantida (`generate-session-report.py`), adicionar uma verificação **única, no fim do run, fail-open, stdlib puro**:

- **O que checa (lint-alvo, não schema completo):** que `notes:` seja seguido de itens de lista (`-`) ou seja `[]` — nunca um escalar. É exatamente o drift observado; um regex stdlib resolve sem reintroduzir PyYAML. Opcionalmente, que cada item de `notes` tenha uma linha `kind:`.
- **Por que no Stop e não na escrita:** o parse acontece uma única vez por run, no fim — não no caminho quente de cada `write`. Não reintroduz parser de YAML onde foi evitado de propósito.

**C rejeitada (enforcement na escrita):** validar contra o schema em cada escrita exigiria PyYAML no caminho de escrita. Custo máximo, ganho marginal sobre o lint de Stop. Trade-off: o lint não bloqueia a escrita ruim (só sinaliza depois), mas combinado com a prosa endurecida da peça B isso é suficiente — o conserto real é na origem, o lint é só a rede.

### D. Emissão do sinal — `session-schema-status.json`

O resultado do lint é emitido como um artefato separado e pequeno, **`session-schema-status.json`**, irmão do `cost-report.json` (mesmo padrão da Spec #1), escrito atomicamente (`tmp + os.replace`):

```json
{
  "schema_ref": "shared/schemas/session.schema.json",
  "schema_version": 1,
  "valid": true,
  "violations": [],
  "checked_at": "<ISO8601>"
}
```

- **Por que artefato separado e não mutar o `session.yml`:** (1) em Phase 4 só o orchestrator escreve no `session.yml` — um hook gravando lá violaria a regra de ownership de `session.md:66`; (2) o consumidor é máquina e lê JSON, então um status legível por máquina serve melhor que prosa; (3) emissão atômica idêntica à Spec #1.
- **Espelhado no `report.html`** para o humano também ver.

**Alternativa rejeitada — sinal só no `report.html`:** o humano veria, mas o consumidor (máquina) não detectaria o drift — derrotaria o propósito da peça C.
**Alternativa rejeitada — dobrar o status dentro do `cost-report.json`:** evitaria um arquivo novo, mas acoplaria dois contratos independentes (custo e integridade de schema) num só — mistura de responsabilidades.

## Semântica do contrato

- **`session.schema.json` é a fonte única de verdade dos campos do `session.yml`.** A seção "Complete schema" de `session.md` passa a apontar para o schema (e é completada para refletir os campos faltantes), deixando de ser uma segunda descrição que pode derivar.
- **`notes` é sempre array de objetos, cada um discriminado por `kind`.** Consumidor faz branch por `kind`; nunca trata escalar.
- **`session-schema-status.json` presente com `valid: false`** ⟹ o `session.yml` daquele run teve drift detectado; o consumidor degrada a confiança nos campos afetados (mostra sinal, não confia cegamente).

## O que NÃO muda

- A semântica de qualquer campo do `session.yml` e o fluxo de Phases.
- O mecanismo de escrita por prosa + `tmp/rename` e o "no PyYAML" dos hooks (o lint é stdlib).
- O `report.html` (continua gerado pelo mesmo hook; ganha só o espelho do status).

## Contrato do consumidor (documentado aqui, implementado fora)

Para um consumidor read-only do runtime:

1. Alinhar os tipos do `session.yml` ao `shared/schemas/session.schema.json`.
2. Tratar `notes` como **união discriminada por `kind`** — branch por `pm_decision` / `pm_escalation` / `audit_override`; nunca aceitar escalar.
3. Ler `session-schema-status.json`; quando `valid: false`, degradar a confiança e sinalizar drift na UI.
4. Remover qualquer tolerância a "notes string" do lado do consumidor — o formato passa a ser garantido na origem.

A implementação concreta dessa leitura está no Anexo A como prompt de handoff autônomo.

## Testes

- O `session.schema.json` valida um `session.yml` real de exemplo (run done) sem erro.
- Um `session.yml` com `notes:` escalar é **rejeitado** pelo schema E **pego** pelo lint de Stop.
- Os três `kind` (`pm_decision`, `pm_escalation`, `audit_override`) validam contra a união discriminada; um `audit_override` no shape antigo (sem `kind`) é rejeitado.
- O lint emite `session-schema-status.json` válido e atômico (existe `.tmp` intermediário; final só após `os.replace`) nos caminhos **done** e **escalate/blocked**.
- Run sem `session.yml` → fail-open, sem status enganoso.
- A seção "Complete schema" de `session.md` lista os cinco campos antes ausentes (`implementation_sessions`, `auto_approved_by`, `pm_cost_cap_usd`, `pipeline_mode`, `audit_override`) OU aponta para o schema como fonte.

---

## Anexo A — Prompt de handoff para a sessão no repo consumidor

> Cole isto numa sessão de brainstorming/spec no repositório consumidor (o cockpit observador). O prompt é autônomo — não depende do contexto desta sessão.

```
Contexto: a pipeline SDD que este cockpit observa passou a publicar um schema
canônico e versionado para o artefato de runtime mais consumido — o
`<projeto>/.agent-session/<spec_id>/session.yml` — em
`shared/schemas/session.schema.json` no repositório do framework. Junto, a
pipeline passou a emitir `<projeto>/.agent-session/<spec_id>/session-schema-status.json`
com o resultado de um lint read-back de integridade. Hoje este cockpit deriva o
Kanban inteiro do session.yml SEM contrato, e trata o campo `notes` com
tolerância a formato dual (ora array de objetos, ora string) — sintoma de drift
que o framework agora consertou na origem.

Objetivo: alinhar os tipos do cockpit ao schema canônico, tratar `notes` como
união discriminada por `kind`, e consumir o status de lint para degradar
confiança quando houver drift.

Pontos do contrato:
- session.schema.json descreve TODOS os campos do session.yml (spec_id,
  feature_name, schema_version, refs, timestamps, current_phase [enum],
  current_owner, output_locale, planned_phases, pipeline_mode,
  implementation_sessions, auto_approved_by, pm_cost_cap_usd, task_states
  [com packet_retries], budget_defaults, escalation_metrics, phase_history, notes).
- `notes` é SEMPRE uma lista de objetos, cada um com campo discriminador `kind`:
  "pm_decision" | "pm_escalation" | "audit_override". Branch por `kind`; NUNCA
  aceitar escalar. Remover toda tolerância a "notes string".
- session-schema-status.json: { schema_ref, schema_version, valid (bool),
  violations [], checked_at }. Quando valid=false, degradar confiança e
  sinalizar drift na UI; quando ausente, comportamento atual (sem sinal).

Mudanças mapeadas (file:line do estado atual do consumidor, podem ter drifted):
1. Tipos (ex.: src/store/types.ts): gerar/alinhar o tipo Session a partir do
   schema; modelar `notes` como união discriminada por `kind`. Não renomear
   campos existentes (aditivo).
2. Coletor/parser do session.yml (ex.: src/collector/session.ts): remover o
   tratamento de formato dual de `notes`; passar a assumir lista de objetos;
   ler session-schema-status.json junto.
3. Watcher (ex.: src/collector/watcher.ts): adicionar glob
   `*/.agent-session/**/session-schema-status.json`.
4. UI (ex.: DetailDrawer.tsx, KanbanCard.tsx, timeline): badge/sinal de
   "schema drift" quando valid=false; render por `kind` nas entradas de notes.
5. Testes: fixtures com session.yml válido / com notes escalar (drift) /
   status valid:false / status ausente.

A mudança é aditiva e backward-compatible: se o status não existir, o
comportamento atual é mantido; o endurecimento de `notes` para lista-de-objetos
é seguro porque o framework garante o formato na origem (Sessions são efêmeras —
não há base instalada legada a migrar). Faça o brainstorming/spec do consumidor
a partir daqui, validando os file:line contra o estado real do repo antes de
planejar.
```
