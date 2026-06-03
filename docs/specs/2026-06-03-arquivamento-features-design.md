# Arquivamento de features `done` — design

**Data:** 2026-06-03
**Status:** aprovado (brainstorming)

## Problema

O board (kanban) e a tabela acumulam features já concluídas. Uma feature `done`
não exige mais ação, mas continua ocupando espaço e ruído visual. O usuário quer
que features concluídas **saiam do board e da tabela** depois de um tempo, mas
continuem **acessíveis numa outra tela** para consulta.

## Regra de arquivamento

Uma feature está **arquivada** se, e somente se, as três condições valem:

```
spec.status === "done"
  E spec.lastActivityAt != null
  E (agora − lastActivityAt) > archiveAfterDays
```

- **Só `done` arquiva.** Features `blocked`/`paused`/`running` paradas há semanas
  **continuam visíveis** de propósito — elas caem em "Precisa de você" e exigem
  atenção; escondê-las seria o oposto do desejado. Arquivamento não é "inatividade
  genérica", é "concluída e fria".
- **`lastActivityAt == null` → NÃO arquiva.** Sem data não há como medir idade;
  a decisão conservadora é manter a feature visível (mostrar a mais > esconder o
  desconhecido).
- **A idade é função do relógio, não do disco** (ver "Onde mora o cálculo").

`archiveAfterDays` é **configurável** em `aios.config.json`, default `7`.

## Onde mora o cálculo: no front, em render-time

Função **pura**, nova, em `web/src/lib/kanban.ts`:

```ts
isArchived(spec: Spec, now: number, archiveAfterDays: number): boolean
```

Recebe `now` como parâmetro (testável sem mexer no relógio). O componente passa
`Date.now()` no render.

**Por que no front e não no back:** se o back marcasse `archived` durante o
`rebuild`, "agora" seria o instante do rebuild. Mas uma feature `done` e fria não
gera eventos de arquivo → o file-watching não dispara rebuild → ela só sairia do
board "por acaso", num rebuild futuro por qualquer outro motivo. Calcular no
front, em render-time, garante que abrir/recarregar o cockpit reflete a idade
atual.

**Trade-off aceito:** o front precisa conhecer o `archiveAfterDays` (vai no
payload), e se o app ficar aberto cruzando a fronteira do dia N só atualiza no
próximo render/snapshot. Aceitável num cockpit single-user que se reabre. **Sem
timer no MVP** (YAGNI).

## Config

Novo campo em `AiosConfig` (`src/config.ts`):

```jsonc
{ "archiveAfterDays": 7 }   // default 7 quando ausente
```

- `loadConfig` lê `raw.archiveAfterDays ?? 7`.
- `saveHidden` (e qualquer reescrita) **preserva** o campo, como já faz com
  `roots`/`include`.
- O valor é **anexado ao payload WebSocket** que o front já recebe junto com
  `Project[]`, porque é o front que faz o cálculo.

## UI — aba "Arquivadas"

- Novo `ViewMode`: `"kanban" | "table" | "archived"` no `TopBar`.
- `Board.tsx` parte do mesmo `flattenSpecs(projects, showHidden)` e bifurca pelo
  `view`:
  - `kanban` / `table` → **excluem** as arquivadas (limpa board e tabela).
  - `archived` → mostra **só** as arquivadas.
- A aba reusa o **`SpecTable`** (lista), não o kanban. As colunas do kanban são
  estágios de trabalho (planning → running → done); tudo arquivado é `done`, então
  um kanban de coluna única seria desperdício. Arquivo = consulta linear →
  tabela, **ordenada por `lastActivityAt` desc** (mais recente no topo).
- `ProjectFilter`, busca (`query`) e `showHidden` continuam funcionando na aba —
  filtrar arquivadas por projeto/termo. O `DetailDrawer` abre normal (custo,
  timeline visíveis).
- **Empty state:** "Nenhuma feature arquivada."

## Fluxo

```
session.yml (status=done, last_activity_at)
        │  collector (só leitura)
        ▼
   Spec no Store ──WS──► front recebe Project[] + archiveAfterDays
        │                       │
        │              isArchived(spec, Date.now(), archiveAfterDays)
        │                       │
        ├── false ──► Kanban / Tabela (board limpo)
        └── true  ──► aba "Arquivadas" (SpecTable)
```

## O que NÃO muda (invariantes)

- **Zero escrita** em `.agent-session/` — o aiOS continua só-leitura nos artefatos
  do ai-squad.
- **Sem novo estado persistido** além do `archiveAfterDays`. Arquivamento é 100%
  derivado de `(status, idade, limite)` — espelha o `columnForSpec`.
- **Sem desarquivar manual.** Uma feature está arquivada sse e somente se atende à
  regra; não há override. (YAGNI num cockpit single-user; evita o caso-limite
  "fica fixada pra sempre ou re-arquiva?".)
- `AttentionPanel` e contadores não mudam: arquivadas são `done`, nunca entram em
  "Precisa de você".

## Testes (TDD)

`isArchived` (puro):
- done + idade > limite → `true`
- done + idade < limite → `false`
- done + `lastActivityAt == null` → `false`
- status ≠ done + idade > limite → `false`
- borda exata (`idade == limite` não arquiva; `> limite` arquiva)

`Board` / filtragem por view:
- aba `kanban`/`table` exclui spec arquivada
- aba `archived` mostra só arquivadas
- busca e `ProjectFilter` aplicados dentro da aba
- empty state quando não há arquivadas

`config`:
- `archiveAfterDays` ausente → default 7
- reescrita preserva `archiveAfterDays`
