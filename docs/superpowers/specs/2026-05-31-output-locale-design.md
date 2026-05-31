# Design — idioma configurável para conteúdo human-facing dos agentes

> Status: design aprovado em brainstorm (2026-05-31). Implementação manual
> (Read/Edit/Write) — o ai-squad não roda o próprio SDD enquanto não estiver
> validado em outros repos.

## Problema

O pipeline de agentes do ai-squad gera, ao final, texto que o humano lê em três
superfícies:

1. O `summary` de cada Output Packet ("Implementei o check de expiração; todos os
   testes de AC-003 passam").
2. Os `findings` dos revisores ("Erro de off-by-one no instante exato de expiração").
3. O `report` HTML e o `handoff.md` que o humano abre para decidir aprovar.

Hoje esse texto sai **no idioma que o modelo escolhe na hora** — na prática,
inglês — mesmo quando o humano conduziu toda a fase de spec em outro idioma.
Ninguém configurou; é o comportamento default do modelo quando nenhuma diretriz
de idioma é dada.

Há um segundo flanco do mesmo problema: as strings **fixas** do report
(`squads/sdd/hooks/session_report.py`) — rótulos, traduções de status, moldes de
narrativa — estão hoje **cravadas em português** no código. Isso viola o
princípio projeto-agnóstico do ai-squad tanto quanto o conteúdo dinâmico sair em
inglês: um consumidor que fale outro idioma veria rótulos em português que não
pediu.

## Objetivo

Todo o **conteúdo dinâmico gerado pelos agentes** sai num idioma **configurável**,
com fallback determinístico, sem cravar nenhum idioma específico no código. As
strings **fixas** do report (chrome da ferramenta) ficam em **inglês** — o neutro
canônico — pelas razões discutidas em "Decisão de escopo" abaixo.

## Princípios honrados

- **Projeto-agnóstico:** nenhum idioma específico cravado no *conteúdo*. O chrome
  fica em inglês, que já é a língua canônica da camada de máquina (os enums são
  literalmente `done`/`blocked`).
- **Invariantes de comunicação por audiência:** a diretriz de idioma vale só para
  a prosa human-facing. O Output Packet continua enxuto; os enums e identificadores
  continuam canônicos, e o orchestrator continua roteando em inglês.
- **Minimal handoff:** o valor do idioma viaja como um campo estruturado pequeno
  no Work Packet — sem inflar o packet, sem inline content.

## Decisões travadas no brainstorm

| Eixo | Decisão | Alternativa rejeitada (e por quê) |
|------|---------|-----------------------------------|
| **Aquisição** | Detectado da conversa na Phase 1 (spec-writer), **confirmado com o humano** antes de gravar. | Detecção silenciosa (erro de inferência sai sem chance de correção); campo explícito puro (mais fricção que o necessário). |
| **Fonte de verdade** | Campo `output_locale` no `session.yml`. | Detectar a cada fase é impossível no pipeline autônomo — subagents são stateless, sem conversa para inferir. |
| **Formato** | Tag BCP-47 com hífen (`pt-BR`, `en-US`). | ISO 639 curto perde variante (pt-BR vs pt-PT); nome natural é chave ruim e ambígua. Padrão de facto confirmado por pesquisa (W3C, IETF). |
| **Carrier até o subagent** | Campo dedicado `output_locale` no Work Packet. | `project_context` (acoplamento conceitual errado — é sobre stack do host); `constraints` (stringly-typed, não-validável). |
| **Escopo** | Toda prosa livre gerada por agente segue o idioma; enums e IDs ficam canônicos. | — (ver "Regra de escopo"). |
| **Fallback** | Inglês (`en`), determinístico e overrideável. | Re-detectar no report é circular (se a prosa saiu em inglês por falta de diretriz, a inferência só confirma inglês); exigir locale quebra Sessions legadas. |
| **Rótulos fixos do report** | Inglês cravado (chrome neutro). | Catálogo configurável — muita engenharia para pouco valor neste momento; registrado como evolução futura. |

## Regra de escopo (a fronteira precisa)

> **Toda prosa livre que um agente gera para eventual leitura humana segue o
> `output_locale`. Tokens de máquina não.**

- **Seguem o idioma:** `summary`, `findings[].rationale`/`message`, `blockers[].*`
  (`reason`, `what_was_attempted`, `what_is_needed`), `notes`, `evidence[].reason`,
  e `handoff.md`.
- **Permanecem canônicos (inglês):** os enums (`status`, `severity`, `kind`,
  `role`, `blocker_kind`) e os identificadores (`spec_id`, `task_id`, refs de AC
  como `FEAT-042/AC-003`, `dispatch_id`, paths de arquivo).
- **Nomes/labels de AC:** o texto do AC já nasce no idioma do humano (a spec é
  escrita por ele na Phase 1) — não há agente para traduzir. Quando um agente
  *parafraseia* um AC dentro de um finding, já o faz no idioma pela regra de
  prosa. O *ref* do AC é identificador e fica canônico. Sem ação adicional.

## Arquitetura — fluxo do valor

`session.yml` é a fonte única. Todo consumidor lê dela ou recebe dela. Isso dá
auditabilidade (abrir o arquivo mostra em que idioma a feature rodou) e
consistência (impossível agente e report divergirem, pois derivam do mesmo campo).

```
PHASE 1 · spec-writer (interativo)
  detecta idioma da conversa → CONFIRMA com humano → grava em session.yml
        │
        ▼
  session.yml:  output_locale: "pt-BR"      ◄── FONTE ÚNICA DE VERDADE
        │
        ├──────────────────────────┬─────────────────────────────┐
        ▼                           ▼                             ▼
  PHASE 4 orchestrator        orchestrator (Skill)         session_report.py
  copia p/ cada Work Packet   escreve handoff.md           NÃO lê locale —
        │                     direto no idioma (é LLM)     chrome é inglês fixo
        ▼                                                  (conteúdo embutido já
  subagent stateless                                        vem localizado dos
  regra(.md) + valor(packet)                                Output Packets)
        ▼
  summary, findings, blockers, notes, evidence.reason → no idioma
```

### Assimetria dos três consumidores (o coração do design)

| Consumidor | Natureza | Como localiza |
|------------|----------|---------------|
| Subagents (dev, reviewers, qa, audit, blocker-specialist) | LLM, stateless | Recebem o valor no Work Packet; a regra no `.md` vira diretriz de prompt. Qualquer idioma. |
| Orchestrator → `handoff.md` | LLM (é um Skill) | Lê `session.yml` e gera a prosa direto no idioma. Qualquer idioma. |
| `session_report.py` → HTML | Python stdlib puro, **sem LLM** | Não escreve prosa; as strings fixas são inglês cravado. O conteúdo dinâmico embutido (summaries, rationales) já vem localizado dos packets — o Python só repassa. |

### Renderização da tag (refinamento da pesquisa)

A tag BCP-47 é a chave estável armazenada, mas a regra no prompt do agente deve
**renderizá-la para idioma explícito** — "Escreva toda prosa human-facing em
português do Brasil (pt-BR)" — em vez de assumir que o modelo interpreta a tag
crua. O Claude Code, por exemplo, usa nomes naturais ("spanish") no seu próprio
setting `language`, não tags. O agente sabe mapear `pt-BR` → português do Brasil;
a instrução explícita só remove ambiguidade.

## Mudanças por arquivo

### Fundação compartilhada (squad-neutra — Discovery herda de graça)
- `shared/templates/session.yml` — novo campo `output_locale` com comentário
  explicando BCP-47 e fallback `en`.
- `shared/concepts/session.md` — documenta o campo no schema e no lifecycle.
- `shared/templates/work-packet.json` — adiciona `output_locale`.
- `shared/concepts/work-packet.md` — adiciona `output_locale` à tabela do schema
  top-level, com rationale (resolve um modo de falha concreto: idioma de saída
  para o subagent stateless).
- **`shared/concepts/output-locale.md` (NOVO)** — doc canônico: a regra, o escopo
  (campos sim/não), o formato BCP-47 com hífen, o fallback `en`, e a instrução de
  renderizar a tag para idioma explícito.
- `shared/concepts/output-packet.md` — cross-ref: campos de prosa seguem
  `output-locale`; reafirma que enums permanecem canônicos.

### Agentes (a mesma regra de uma linha em todos)
- `squads/sdd/agents/{dev,code-reviewer,logic-reviewer,qa,blocker-specialist,audit-agent}.md`
  — seção curta "Output language": *leia `output_locale` do Work Packet; escreva
  toda prosa human-facing nesse idioma, renderizando a tag para o nome explícito;
  ausente → inglês.*

### Skills (Phase 1 e Phase 4)
- `spec-writer` (Phase 1) — passo de detecção + confirmação do idioma; grava
  `output_locale` no `session.yml`.
- `orchestrator` (Phase 4) — copia `output_locale` de `session.yml` para cada
  Work Packet gerado; gera `handoff.md` no idioma.

### Report (a reversão)
- `squads/sdd/hooks/session_report.py` — strings fixas voltam para inglês:
  - `_STATUS_PT` / `_SEV_PT` → rótulos em inglês (ou exibir o enum canônico direto).
  - `lang='pt-BR'` → `lang='en'`.
  - Dashboard: "Veredito"→"Verdict", "Custo"→"Cost", "Tarefas"→"Tasks",
    "Pronto"→"Ready", "pendente(s)"→"pending", "concluídas"→"done", etc.
  - Moldes do `_narrative` → frases em inglês.
- `squads/sdd/hooks/__tests__/test_session_report_redesign.py` — acompanha a
  reversão (asserts que hoje esperam pt-BR passam a esperar inglês).

## Validação e fallback

- Validation gate (orchestrator na escrita; subagent na leitura) aceita
  `output_locale` ausente (→ `en`) e, se presente, exige formato com **hífen** —
  rejeita underscore (`pt_BR`).
- Sessions legadas (sem o campo) → `en`, via read-compat, espelhando o padrão já
  usado para `pipeline_mode` (orchestrator lê com fallback).

## Verificação

- **Schema/gate:** teste do validation gate aceitando `output_locale` ausente e
  uma tag válida com hífen, e rejeitando uma com underscore.
- **Report:** atualização de `test_session_report_redesign.py` para o chrome em
  inglês; um teste confirmando que conteúdo dinâmico (summary localizado nos
  packets de fixture) é repassado verbatim, sem tradução pelo Python.
- **Agentes/Skills:** mudanças de prompt não são unit-testáveis; a verificação é
  a inspeção manual do `.md` e a checagem em uma run real (fora deste repo, já que
  o ai-squad não dogfooda o próprio SDD).

## Fora de escopo (registrado, não esquecido)

- **Catálogo configurável de rótulos** do report — evolução futura combinada;
  reabre quando houver demanda real de chrome multi-idioma.
- **Discovery agents** (discovery-lead, risk-analyst, codebase-mapper,
  discovery-synthesizer, discovery-orchestrator) — a fundação compartilhada já os
  cobre; falta só replicar a regra de uma linha nos `.md` deles. Mesmo padrão;
  follow-on natural.
- **Divergência `message` vs `rationale`** nos findings — o schema canônico diz
  `message`, o `session_report.py` lê `rationale` (com fallback). Pré-existente e
  tangente ao idioma; anotado para limpeza separada.
