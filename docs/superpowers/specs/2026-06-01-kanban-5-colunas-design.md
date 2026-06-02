# Kanban de 5 colunas: separar "planejamento", "planejado" e "em andamento"

**Data:** 2026-06-01
**Status:** aprovado (brainstorming)

## Problema

O kanban tem 3 colunas ([web/src/lib/kanban.ts](../../../web/src/lib/kanban.ts)):

| Coluna | Quem cai nela |
|--------|---------------|
| Precisa de você | `blocked`/`escalated`/`paused`/`auditException` |
| Em andamento | **balde de sobra** — tudo que não é "pronto" nem "atenção" |
| Pronto | status `done` |

O balde do meio mistura estágios muito diferentes: uma spec recém-criada (só o `spec.md` escrito) aparece lado a lado com uma onde o dev já está codando a `T-005`. Visualmente parecem o mesmo estágio, mas não são.

A informação que distingue os estágios **já existe no dado** (`Spec.phase`, `Spec.tasks[].state`, `Spec.squad`), só não estava sendo usada. O `SpecStatus` cru tem só 5 valores (`running/paused/blocked/done/escalated`) e **não** representa "planejado, aguardando execução".

## Decisão

Abrir o balde "Em andamento" em três colunas, derivando o estágio real. O board passa de **3 → 5 colunas**:

```
Precisa de você | Em planejamento | Planejado | Em andamento | Pronto
```

### Decisões de brainstorming (com critério)

1. **Corte por fase do pipeline** (escolhido sobre "por estado das tasks" e "só planejado vs em andamento"): é o corte mais fiel ao modelo do ai-squad (specify → plan → tasks → implementation).
2. **Discovery → "Em andamento"** (escolhido sobre "Em planejamento"): o squad discovery (`frame/investigate/decide`) não tem fase de implementação; tratá-lo como trabalho ativo é mais simples. Trade-off aceito: mistura pesquisa com execução de código na mesma coluna enquanto roda.
3. **Spec com `tasks.md` pronto mas parada em `current_phase=tasks` → "Planejado"** (escolhido sobre "Em planejamento"): captura melhor o "planejado mas não executou". Consequência: o critério de Planejado vs Em andamento passa a ser o **estado das tasks**, não a fase. A regra vira um **híbrido** — fase no início (sem tasks ainda), tasks no meio. Isso unifica os dois casos de "parado" (task-builder parado E orchestrator não rodado) sob uma única regra.

## Regra de classificação (`columnForSpec`)

Cascata — a primeira condição que casar vence. Ordem importa: "Precisa de você" ganha de tudo (item que exige humano não pode se esconder num balde de progresso).

| # | Condição | Coluna (`ColumnKey`) |
|---|----------|----------------------|
| 1 | status `blocked`/`escalated`/`paused` **ou** `auditException` | `attention` (Precisa de você) |
| 2 | status `done` | `done` (Pronto) |
| 3 | squad `discovery` | `running` (Em andamento) |
| 4 | tem tasks **e** alguma `running`/`done` | `running` (Em andamento) |
| 5 | tem tasks **e** todas `pending` | `planned` (Planejado) |
| 6 | resto (sem tasks geradas: `specify`/`plan`) | `planning` (Em planejamento) |

Notas:
- No passo 4, `blocked` já foi capturado no passo 1 (status vira `blocked` se alguma task está blocked), então "alguma não-pending" aqui significa `running`/`done`.
- "Em planejamento" significa **"ainda nem gerou a lista de tasks"** (escrevendo spec ou plano). Quando o `task-builder` gera as tasks, a spec pula pra **Planejado**, e só sai de lá quando a primeira task roda.
- Spec sem `session.yml` / phase vazia / sem tasks → passo 6 → Em planejamento (default conservador para "recém-nascido").

## Layout / visual

- `.kboard`: `grid-template-columns: repeat(5, 1fr)` no desktop; mantém `1fr` (empilha) no breakpoint mobile atual.
- Dois "dots" novos: `planning` (tom neutro/cinza — rascunho) e `planned` (tom de espera distinto de `--running`, ex.: âmbar). Tokens exatos definidos na implementação respeitando o tema light.

## Arquivos afetados

| Arquivo | Mudança |
|---------|---------|
| [web/src/lib/kanban.ts](../../../web/src/lib/kanban.ts) | `ColumnKey` += `planning` \| `planned`; `COLUMN_DEFS` 5 entradas; reescreve `columnForSpec` com a cascata; `bucketByColumn` inicializa os baldes novos |
| [web/src/app.css](../../../web/src/app.css) | grid 5 colunas + 2 dots novos |
| `web/src/lib/kanban.test.ts` (ou equivalente) | um caso por linha da cascata + 3 edge cases (discovery, tasks-parado, implementation-não-iniciado) |

Componentes `KanbanBoard`/`KanbanColumn` **não mudam** — iteram genericamente sobre `COLUMN_DEFS`.

## Testes (TDD)

Escrever `columnForSpec` primeiro: um teste por linha da cascata (1–6) + edge cases. Ver falhar, depois implementar.

## Fora de escopo (YAGNI)

- Não muda `KanbanCard`/`KanbanColumn`/`DetailDrawer`.
- Não adiciona sub-badge de fase nos cards (era a alternativa de 4 colunas, descartada).
- Não toca no collector nem nos tipos do store — toda a derivação é no front, a partir de campos existentes.
