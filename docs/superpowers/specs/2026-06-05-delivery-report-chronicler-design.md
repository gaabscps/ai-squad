# Parecer de entrega — `chronicler` + `delivery-report`

**Data:** 2026-06-05
**Status:** design aprovado (brainstorming), pendente de plano de implementação
**Escopo:** um agente novo (`chronicler`) que, **sempre** ao final da pipeline SDD (após o gate de qualidade do `audit-agent`), produz um parecer de entrega estruturado — a "história da feature" — co-localizado com os demais artefatos da Session. Aditiva ao SDD. O núcleo (perguntas, schema, narrativa) é projetado cross-squad; a extração de dados é plugável por squad. Discovery e Council **não** são implementados agora — só fica pronto o ponto de extensão.

## Contexto

Hoje a pipeline SDD termina com o `handoff.md` do `orchestrator`, que cobre parcialmente *"o que foi feito"* — bullets de resumo, tabela de status por task, validação de ACs, follow-ups. Mas o `handoff.md` é um relatório de **fechamento operacional**: ele diz que a pipeline terminou e em que estado. Não existe um artefato que **cruze a intenção** (spec/plan/tasks) **com a execução real** (diff, Output Packets dos agentes, loops de review, QA, decisões de blocker, custo) e conte a história completa da entrega, respondendo perguntas de **produto**.

A consequência é uma assimetria de informação para qualquer observador externo. O aiOS — o cockpit que observa os artefatos do framework em modo read-only — lê a `spec.md` e sabe o que a feature **pretendia** ser. Não sabe o que de fato foi entregue, como, com que ressalvas, o que ficou de fora, nem por quê. A spec é a promessa; falta o parecer de cumprimento da promessa.

## Problema

Faltam quatro coisas que este parecer provê:

1. **O cruzamento intenção × execução.** Ninguém hoje compara o que a `plan.md`/`tasks.md` mandou fazer com o que os Output Packets registram ter sido feito, classificando cada critério de aceite (AC) como atendido / parcialmente / não atendido / não validado.
2. **A história honesta, inclusive no fracasso.** O parecer precisa funcionar quando a entrega é parcial, escalada ou bloqueada — não só no sucesso uniforme. É justamente no caso travado que o observador externo mais precisa da narrativa fiel.
3. **Ancoragem em evidência, sem alucinação.** Cada resposta cita a fonte que a sustenta (Output Packet, dispatch_id, arquivo:linha, AC id, comando de teste). O que não foi registrado é marcado como tal — nunca inferido como se fosse fato.
4. **Um registro sempre presente.** O parecer é gerado *eager* — ao final de toda pipeline, mesmo que ninguém leia. O custo é incremental perto do custo total da pipeline; o valor de ter o registro sempre disponível para o cockpit compensa.

## Não-objetivos (fora de escopo)

- **Implementar Discovery/Council.** Só deixamos pronta a interface `extract(session_dir) → DeliveryFacts` e o registry de extratores, com a entrada SDD funcionando e um stub documentado para os demais. Nenhuma lógica de Discovery/Council é escrita agora.
- **Gerar qualquer coisa do lado do aiOS.** A fronteira é: a pipeline é dona do dado de execução vivo e **produz** o parecer; o aiOS **observa** e apresenta. O aiOS apenas lê `delivery-report.json` / `.md`.
- **Substituir o `handoff.md`.** O handoff continua sendo o fechamento operacional do `orchestrator`. O parecer é um artefato distinto, de produto, mais rico e narrativo. Coexistem.
- **Enriquecer todos os agentes.** Só o `dev` ganha um campo novo (ver §3). Reviewers, qa e blocker ficam intocados — eles avaliam, raramente decidem o *porquê* de produto.
- **Decidir o destino da entrega.** O parecer é **observacional** (lê e narra), não causal. Não altera o roteamento da pipeline nem o veredito; só conta a história e emite um parecer final consultivo.

## Design proposto

### Visão geral (cena concreta)

A pipeline da `FEAT-042` chega ao fim. O `orchestrator` roda o `audit-agent` (gate de qualidade) no passo 8. Qualquer que seja o veredito do audit — `done`, `blocked` ou `escalate` —, o `orchestrator` então dispacha o **`chronicler`** (novo passo 8.5). O chronicler roda primeiro um extrator determinístico que varre a Session e monta um `delivery-facts.json` (fatos já estruturados, normalizados). Em seguida o chronicler lê esses fatos **mais** a prosa apontada (`spec.md`, `plan.md`, decision memos), cruza o que se pretendia com o que se fez, e escreve dois arquivos:

```
.agent-session/FEAT-042/delivery-report.json   (dados estruturados, para o aiOS)
.agent-session/FEAT-042/delivery-report.md      (narrativa legível, para humano)
```

O `.md` conta a história: *"Entregou T-001 e T-002 com todos os ACs atendidos; T-003 escalou para humano por ambiguidade na spec sobre concorrência; o dev optou por optimistic locking em vez de pessimistic (src/import/bulk.ts:42) por causa de contenção no hot path; AC-005 ficou não validado porque o teste de carga depende de infra ausente. Parecer: aprovado com ressalvas."* Cada frase com a sua fonte. Só depois o `orchestrator` emite o `handoff.md` (passo 9).

### Arquitetura em três camadas

A separação pedida — núcleo estável × extração plugável — vira três camadas com responsabilidades nítidas:

```
┌─ INTENÇÃO ──────────┐     ┌─ EXECUÇÃO REAL ─────────────────┐
│ spec.md  plan.md    │     │ session.yml  outputs/*.json     │
│ tasks.md (ACs)      │     │ dispatch-manifest  costs/  diff │
└─────────┬───────────┘     │ handoff.md  decision memos      │
          │                 └──────────────┬──────────────────┘
          │                                │
          │     ┌─ EXTRATOR (código, por squad) ─┐
          └────▶│  extract_sdd(session_dir)       │  ← determinístico, testável,
                │     → DeliveryFacts (JSON)       │     SÓ junta o que já é estruturado
                └────────────────┬─────────────────┘
                                 │  delivery-facts.json (artefato intermediário)
                                 ▼
                ┌─ NÚCLEO (agente chronicler, cross-squad) ─┐
                │  consome Facts + LÊ a prosa apontada       │  ← Sonnet/high
                │  cruza intenção × execução, julga, narra   │     julgamento + narrativa
                │  responde as 11 perguntas, ancorado        │
                └────────────────┬───────────────────────────┘
                                 ▼
            delivery-report.json  +  delivery-report.md
```

**A fronteira de extensão é o `DeliveryFacts` schema.** Adicionar Discovery = escrever `extract_discovery(session_dir)` que emite o **mesmo** schema. O chronicler e os dois artefatos de saída não mudam uma linha. O extrator é selecionado pelo campo `squad` do `session.yml`, via um registry simples (`{"sdd": extract_sdd, "discovery": extract_discovery, ...}`).

**Por que o extrator é código e não prompt.** "Juntar JSON estruturado" é mecânico, barato e testável — não precisa de um LLM. E há um ganho anti-alucinação por construção: o que o extrator não consegue montar fica *ausente* do Facts, então o agente não tem o que inventar. O modelo forte (Sonnet) só entra onde há julgamento real: o cruzamento semântico `plan.md` × execução e a redação da narrativa. Isso espelha a filosofia do repo — determinismo onde dá (`session_report.py`, `cost_report.py` já são assim), modelo só onde precisa.

**Alternativa rejeitada (Modelo 2 — extrator como guia de prompt):** um único agente com um `.md` de extração por squad. Mais simples, sem schema intermediário, mas a fronteira fica difusa (extração e síntese no mesmo prompt), a extração não é testável isoladamente, e o anti-alucinação depende só da disciplina do prompt — sem trava mecânica. Trade-off: ganharíamos simplicidade e perderíamos testabilidade + a garantia estrutural. Rejeitado porque a garantia anti-alucinação é não-negociável neste artefato.

### O contrato `DeliveryFacts` (a interface agnóstica)

Estrutura comum que qualquer squad preenche. Schema canônico novo em `shared/schemas/delivery-facts.schema.json`.

| Campo | Tipo | Descrição |
|---|---|---|
| `spec_id` | string | `FEAT-NNN` / `DISC-NNN`. |
| `squad` | string | `sdd` \| `discovery` \| `council` — qual extrator produziu. |
| `feature_name` | string | Título legível. |
| `outcome` | enum | `success` \| `mixed` \| `escalated` \| `refused` — estado agregado da pipeline. |
| `intent` | object | `spec_ref`, `plan_ref`, `tasks_ref` + `acceptance_criteria[]` (`id` + texto extraído). A espinha do cruzamento. |
| `work_units[]` | array | A unidade normalizada de trabalho. No SDD = task; no Discovery seria = risco investigado. Ver abaixo. |
| `escalations[]` | array | Blockers + ponteiros para decision memos do `blocker-specialist`. |
| `gate` | object | Resultado do gate de qualidade (no SDD = `audit-agent`): `status` + `findings[]`. |
| `cost` | object | Total + por unidade, lido do cost report existente. |
| `timeline` | object | `started_at` / `completed_at`, fases (`phase_history`). |

Cada `work_unit`:

| Campo | Descrição |
|---|---|
| `id`, `title` | `T-XXX` + título. |
| `planned_scope` | Escopo declarado em `tasks.md` (arquivos, ACs). |
| `final_status` | Estado final (`done` / `pending_human` / ...). |
| `loops`, `retries` | Contadores de review/qa/packet do `task_states`. |
| `dispatches[]` | dispatch_ids reais (do manifest) com role e status. |
| `decisions[]` | Decisões e desvios declarados pelo `dev` (ver §3). |
| `findings[]` | Findings dos reviewers (com severity, dimension/gap_kind, ac_ref). |
| `ac_coverage` | Mapa AC → evidências, agregado dos packets de qa. |
| `files_changed` | Arquivos tocados (dos packets de dev). |
| `evidence_refs` | Ponteiros de evidência. |

**Tudo ancorado:** cada item carrega o `ref` da sua fonte (dispatch_id, arquivo:linha, AC id). Esse é o material bruto sobre o qual o chronicler trabalha — e a fronteira do que ele pode citar com segurança.

### §3. O enriquecimento do `dev`: campo `decisions[]`

**O problema de fonte.** Os Output Packets de hoje capturam **fatos mecânicos** (`files_changed`, `findings`, `ac_coverage`, `status`), mas não capturam o **racional** nem o **desvio do plano**. A única fonte estruturada de *"por quê"* é o decision memo do `blocker-specialist`, que **só existe quando algo escalou**. Numa run que correu limpa, as perguntas 3 (por que foi feito assim) e 4 (o que mudou do plano) ficariam sem fonte — e, pelo princípio anti-alucinação, viriam como "não registrado" na maioria das entregas bem-sucedidas. Isso é honesto, mas é pouco.

**A correção mínima.** A decisão técnica de "como/por quê" nasce esmagadoramente no `dev` — é ele que encosta no código e descobre que o plano não bate com a realidade. Reviewers e qa *avaliam*; raramente decidem o porquê de produto. Então enriquecemos **só o `dev`**, com um campo novo, opcional, no Output Packet:

```json
"decisions": [
  { "id": "DEC-001", "kind": "decision",
    "summary": "Optimistic locking em vez de pessimistic",
    "rationale": "Plan deixou concorrência em aberto; optimistic evita contenção no hot path",
    "ref": "src/import/bulk.ts:42", "plan_ref": "AC-003" }
]
```

- `kind` ∈ `decision` (escolha técnica entre alternativas reais, com trade-off) | `deviation` (afastou-se do que `plan.md`/`tasks.md` especificou).
- `summary` (o quê, ≤120), `rationale` (o porquê, ≤200), `ref` (evidência: arquivo:linha), `plan_ref` (opcional; o AC ou seção do plano afetada — central para `deviation`).
- **Dev-only, opcional, default `[]`.** Regra de disciplina: só registra quando houve escolha real entre alternativas **ou** desvio do plano. Senão, array vazio — mantém sinal alto e custo baixo. O dev não vira redator.

**Alternativas rejeitadas:**
- *Estender o `notes` do packet* para uma lista discriminada por `kind` (unificando com o `notes` da Session, que já é assim): mudaria a semântica de um campo que **todos** os agentes usam como texto solto ≤80 chars — mudança ampla, contraria o "mínimo no dev".
- *Dev escreve um decision memo (ADR)*: reaproveita a infra do blocker, mas o memo é pesado (~40 linhas) e existe justamente porque o blocker é raro; obrigar em todo dev vira fricção e custo por dispatch.

**Nuance anti-alucinação (declarado × inferido).** Um desvio **declarado** pelo dev (com o porquê) é alta-confiança. Um desvio que o chronicler apenas **infere** comparando `plan.md` × diff, sem o dev ter declarado, é baixa-confiança e será marcado como `inferred` (ver §4) — nunca apresentado como se o dev tivesse dito.

### §4. O agente `chronicler` e as 11 perguntas

**Identidade.** Singleton, nunca fan-out, nunca dispacha outros Subagents. Lê os artefatos da Session e escreve **apenas** os seus próprios (`delivery-facts.json`, `delivery-report.json`, `delivery-report.md`, Output Packet) — nunca toca código-fonte. Modelo **Sonnet, effort `high`**, tier-independent (como `audit-agent` e `committer`). Tools: `[Read, Bash, Write]` — `Read` para os artefatos da Session, `Bash` para rodar o extrator, `Write` para gravar os seus artefatos (a narrativa longa via heredoc seria frágil).

> **Por que Sonnet/high e não Opus/xhigh (como o `blocker-specialist`).** Critério observacional × causal. O blocker é Opus/xhigh porque sua decisão é *causal* — muda o código que será implementado; um erro dele quebra a entrega. O chronicler é *observacional* — lê e conta a história, não decide nada na pipeline; um erro dele produz um parecer imperfeito, não uma entrega quebrada. Ele lê muito contexto e gera narrativa longa, perfil em que Sonnet/high é o ponto ótimo: forte para síntese de contexto grande e julgamento não-causal, ~5× mais barato que Opus (que, em contexto grande, escala o custo rápido). Roda 1× por pipeline.

**Input (Work Packet):** `spec_id`, `dispatch_id`, `session_ref`, `manifest_ref`, `outputs_dir_ref`, `spec_ref`, `plan_ref`, `tasks_ref`, `gate_dispatch_id` (dispatch_id do audit), `output_locale`. Campo ausente → `status: blocked, blocker_kind: contract_violation`.

**Passos:**
1. Valida o Work Packet.
2. Roda o extrator do squad via Bash (`python3 .../extract.py <session_dir> > delivery-facts.json`). Exit code ≠ 0 → `status: blocked`.
3. Lê o `delivery-facts.json` + a prosa apontada (`spec.md`, `plan.md`, decision memos).
4. Cruza intenção × execução e responde as 11 perguntas, cada uma ancorada.
5. Grava `delivery-report.json` + `delivery-report.md` (atômico: tmp + rename).
6. Emite o Output Packet apontando para os dois artefatos.

**As 11 perguntas (a espinha do `delivery-report.json`).** Cada uma é um objeto `{ id, question, answer, evidence_refs[], confidence }`:

1. `what_was_done` — resumo objetivo, escopo, telas/fluxos/serviços afetados, principais mudanças.
2. `how_it_was_done` — abordagem técnica, decisões de arquitetura, agentes envolvidos, arquivos/módulos, sequência.
3. `why_this_way` — racional, trade-offs, restrições, dependências, alternativas descartadas. *(Fonte: `decisions[]` do dev + decision memos.)*
4. `deviations_from_plan` — desvios spec/plan/tasks → entrega: o que mudou, por quê, quem decidiu, impacto. *(Fonte: `decisions[kind=deviation]` + inferência marcada.)*
5. `acceptance_criteria` — **forma própria** (ver abaixo).
6. `evidence` — testes executados, commits, arquivos, dispatches, loops de review, ac_coverage do qa.
7. `impacts` — usuário, produto, código, integrações, dados, performance, manutenção, suporte, QA, operação.
8. `out_of_scope` — o que NÃO foi feito, adiado, dependente de outra task.
9. `risks_and_pending` — risco técnico, comportamento não coberto, edge cases, dívida, dependência externa, algo a monitorar.
10. `how_to_validate` — mini-roteiro de QA: passos, cenários principais/alternativos/regressão.
11. `final_verdict` — **enum** (ver abaixo) + rationale.

**Pergunta 5 — forma própria.** Lista de ACs, cada um classificado:

| Classificação | Quando |
|---|---|
| `met` | qa validou com evidência (ac_coverage não-vazio + status done). |
| `partially_met` | coberto em parte, ou com finding aberto não-bloqueante. |
| `not_met` | implementado mas falhou validação, ou contradito por finding. |
| `not_validated` | sem evidência de qa (infra ausente, task escalada antes do qa). |

**Pergunta 11 — enum do parecer final:** `approved` | `approved_with_caveats` | `needs_changes` | `blocked` | `needs_human_review`.

**O nível de confiança — anti-alucinação operacionalizado.** Toda resposta carrega `confidence`:

| `confidence` | Significado | Regra na narrativa |
|---|---|---|
| `recorded` | Ancorado em fonte direta (packet, memo, arquivo:linha, AC). | Cita a fonte. |
| `inferred` | Deduzido pelo chronicler (ex.: desvio detectado por plan×diff, não declarado). | Diz explicitamente "inferido, não declarado". |
| `not_recorded` | Sem fonte. | Admite a lacuna explicitamente; **nunca** inventa. |

O `delivery-report.md` é a renderização das 11 respostas em prosa, no `output_locale` da Session, com as evidências citadas inline. Os enums (`confidence`, classificação de AC, `final_verdict`) ficam canônicos em inglês — o aiOS roteia sobre eles e não pode parsear valor traduzido.

### §5. Integração na pipeline (mudanças no SDD)

| Onde | Mudança |
|---|---|
| `squads/sdd/skills/orchestrator/skill.md` | Novo passo **8.5**, entre o audit gate (8) e o handoff (9): dispacha o `chronicler` **sempre**, qualquer veredito do audit. |
| `squads/sdd/agents/chronicler.md` | Novo agente (frontmatter `model: sonnet`, `effort: high`, `tools: [Read, Bash, Write]`, `fan_out: false`). |
| `squads/sdd/agents/dev.md` | Documenta o campo `decisions[]` e a regra de disciplina. |
| `shared/schemas/output-packet.schema.json` | Adiciona `chronicler` ao enum `role`; adiciona o campo `decisions[]` (dev-only). |
| `shared/schemas/delivery-facts.schema.json` | **Novo** — o contrato da interface de extração. |
| `shared/schemas/delivery-report.schema.json` | **Novo** — as 11 perguntas estruturadas + classificação de AC + enum de parecer. |
| `shared/schemas/session.schema.json` + `shared/templates/session.yml` | Adiciona `delivery_report_ref` e `delivery_facts_ref`. |
| Extrator | `extract_sdd` (código) + registry por `squad`. Local a definir no plano (provável `shared/lib/` ou `squads/sdd/hooks/`). |
| Hook de validação | Stop hook no `chronicler` valida o `delivery-report.json` contra o novo schema; validação do `decisions[]` no `verify-output-packet.py`. |
| Calibração | `model-effort-calibration.md` ganha a linha `chronicler → sonnet, high, tier-independent`. |

**Relação com o audit gate.** O `audit-agent` continua sendo o gate terminal (passo 8). O chronicler roda **depois**, e o veredito do audit é apenas mais um insumo do Facts (`gate`). Se o audit recusou por bypass, o parecer conta essa história — não a esconde.

**Relação com o `committer` e o PM.** Sem mudança nesses. O `committer` (auto-commit pós-handoff com `verdict=done`) e o `/pm` autônomo observam o fim da pipeline como antes; o passo 8.5 é transparente para eles. O `delivery-report` é gerado antes do handoff e do commit, então fica incluído no que o `/ship` eventualmente limpa.

### §6. O ponto de extensão para Discovery/Council (sem implementar)

O que fica pronto agora, sem nenhuma lógica de Discovery/Council:

1. `DeliveryFacts` e `delivery-report` schemas são **cross-squad** por construção — vocabulário agnóstico (`work_units`, não "tasks"; `gate`, não "audit"; `intent.acceptance_criteria`, não "spec ACs").
2. O registry de extratores existe com a entrada `sdd` funcional e entradas `discovery`/`council` como stub que retorna "extrator não implementado" de forma explícita.
3. O chronicler seleciona o extrator pelo campo `squad` do `session.yml` — então o mesmo agente, sem mudança, serve qualquer squad assim que seu extrator existir.

Quando Discovery for plugado no futuro: escreve-se `extract_discovery(session_dir)` mapeando as fontes do Discovery (frame, codebase-map, veredictos de risk-analyst, output de synthesizer) para os `work_units` e `intent` do mesmo `DeliveryFacts`. O núcleo não é tocado.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| O `decisions[]` do dev vira ruído (dev registra trivialidades). | Regra de disciplina explícita no `dev.md`: só decisões com trade-off real ou desvio; default `[]`. Reforçar com exemplo positivo/negativo no prompt. |
| O chronicler alucina o "porquê" quando a fonte não existe. | Trava por construção: o que não está no Facts não é citável; `confidence: not_recorded` obrigatório quando sem fonte; enums canônicos. |
| Custo incremental ao final de toda pipeline. | Sonnet (não Opus); roda 1×; extração mecânica fora do LLM. Custo dominado pela pipeline em si. |
| Confusão com o "session report" de custo existente. | Nome do agente (`chronicler`) e do artefato (`delivery-report`) distintos do `session_report.py`. |
| Extrator falha (artefato corrompido/ausente). | Exit code ≠ 0 → chronicler emite `status: blocked` com evidência; orchestrator segue para o handoff registrando a falha do parecer, não trava a pipeline. |

## Referências

- Princípio anti-alucinação e ancoragem em evidência: `shared/concepts/evidence.md`, `shared/concepts/output-packet.md`.
- Calibração modelo/effort: `shared/concepts/effort.md`, `squads/sdd/skills/orchestrator/model-effort-calibration.md`.
- Padrão singleton read-only de gate final: `squads/sdd/agents/audit-agent.md` (molde estrutural do agente).
- `output_locale` na prosa humana: `shared/concepts/output-locale.md`.
- Fronteira pipeline (produz) × aiOS (observa): memória de projeto `project_aios.md`.
