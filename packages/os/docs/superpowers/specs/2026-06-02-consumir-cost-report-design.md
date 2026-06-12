# Consumir `cost-report.json` como fonte de verdade de custo

**Data:** 2026-06-02
**Status:** aprovado (brainstorm)
**Squad consumidor:** aios (cockpit), lado coletor + UI

## Contexto

A pipeline SDD que este cockpit observa passou a publicar um artefato de custo
escopado e canônico em `<projeto>/.agent-session/<spec_id>/cost-report.json`, com
schema versionado no repositório do framework em
`shared/schemas/cost-report.schema.json`.

Hoje o aios **ignora** esse arquivo e re-soma os `costs/*.json` crus por conta
própria — número pior e potencialmente divergente, sem sinais de escopo (não sabe
quais subagents foram excluídos, não distingue fase, não sabe se o custo de
implementação é confiável).

**Objetivo:** consumir `cost-report.json` como fonte de verdade **quando presente**,
caindo de volta na soma crua (rotulada "preliminar") **quando ausente**. Mudança
aditiva e backward-compatible: sem o arquivo, o comportamento atual é preservado.

### Descobertas da validação do repo (antes do design)

1. **O front não tem tipo próprio de custo.** [`web/src/state/projects.tsx`](../../../web/src/state/projects.tsx)
   importa `Project` direto de `src/store/types.ts`. Logo, expandir `CostRollup`
   em **um único lugar** (o backend) propaga automaticamente pro front. Não há dois
   tipos pra sincronizar.

2. **Os arquivos reais são mais esparsos que o schema.** Amostras no disco:
   - `FEAT-001` (aios): tem `excluded_subagents`, `complete: false`, blocos
     completos de `tokens`/`token_cost` por fase — **mas não tem** `scoping_suspect`,
     `recovered_subagents`, `spec_id`, `generated_at`.
   - `FEAT-010` (soundwave): só os 4 campos de custo + `complete: true` —
     **sem bloco `tokens` nenhum**.

   Consequência de design: **todo campo é opcional**; o consumidor degrada por
   campo (o custo pode ser autoritativo enquanto `tokens` está ausente).
   Ausência de `scoping_suspect` ⇒ `false`.

## Decisões tomadas no brainstorm

| # | Decisão | Critério / alternativa rejeitada |
|---|---|---|
| D1 | **Breakdown de custo por fase no DetailDrawer** (planning/orchestration/implementation) quando a fonte é authoritative. Card e tabela seguem só com o agregado. | `scoping_suspect` só ganha significado se existir o custo por fase — o sinal diz que **só** o implementation é não-confiável. Alternativa (só agregado + badges) foi rejeitada porque perderia o detalhe que dá sentido ao `scoping_suspect`. |
| D2 | **Tokens vêm do `cost-report` quando há bloco `tokens.total`**; fallback pra soma crua quando ausente (caso FEAT-010). | Mantém $ e tokens coerentes na mesma fonte escopada. Alternativa (tokens sempre da soma crua) foi rejeitada porque tokens inflaria contando subagents excluídos, divergindo do $. |
| D3 | **Coletor estruturado como módulo parser separado (`cost-report.ts`)** + coordenador (`cost.ts`). | O ponto de risco é a tolerância ao schema esparso; isolá-lo num módulo testado sozinho dá fronteira limpa. Espelha o padrão existente `dispatch-normalize.ts` ⟂ `dispatches.ts`. Alternativas A (tudo numa função) e B (duas funções no mesmo arquivo) foram rejeitadas por colar validação-de-schema com soma-crua. |
| D4 | **Quando `scopingSuspect=true`, o headline (`totalCostUsd`) segue mostrando o total do report; só a linha `implementation` do breakdown vira "—".** | O contexto diz "implementation_cost_usd NÃO é confiável, mostrar '—'" — fala da fase, não do total. Esconder o total descartaria planning+orchestration, que são confiáveis. Trade-off: o headline soma um implementation suspeito, mas o breakdown logo abaixo explicita o que não confiar. |

## Arquitetura

Três peças, fronteiras limpas:

```
cost-report.json ──▶ readCostReport()  (cost-report.ts)  ── parser tolerante, retorna objeto|null
                          │
costs/*.json ──▶ sumRawCosts()  (cost.ts)  ── soma crua reusável (plano B)
                          │
                          ▼
                   readCostRollup()  (cost.ts)  ── coordenador/juiz
                          │
                          ▼
                     CostRollup  (store/types.ts)  ── tipo único, consumido por backend + front
```

### 1. Tipo `CostRollup` — expansão aditiva

Único lugar a mudar: `src/store/types.ts`. Nada renomeado.

```ts
export type CostSource = "empty" | "preliminary" | "authoritative";

export interface CostPhaseBreakdown {
  planning: number | null;
  orchestration: number | null;
  implementation: number | null; // null quando scopingSuspect=true
}

export interface CostRollup {
  // --- existentes, intocados ---
  totalCostUsd: number | null;
  partial: boolean;            // unpriced_models não-vazio
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  totalTokens: number;
  reportPath: string | null;   // report.html — fonte humana de $, inalterada
  // --- novos, aditivos ---
  source: CostSource;
  scopingSuspect: boolean;     // ausente no arquivo ⇒ false
  excludedSubagents: number | null;
  recoveredSubagents: number | null;
  byPhase: CostPhaseBreakdown | null; // preenchido só quando authoritative
  complete: boolean | null;    // campo `complete` do report; null em preliminary
}
```

### 2. `cost-report.ts` — parser tolerante (novo)

```ts
export interface CostReport { /* objeto já normalizado, campos opcionais resolvidos */ }
export function readCostReport(specDir: string): CostReport | null;
```

Regra de validade (decide authoritative vs fallback):

| `cost-report.json` | retorno |
|---|---|
| Ausente | `null` |
| Existe mas JSON inválido/corrompido | `null` (não inventa número) |
| Existe, parseia, `total_cost_usd` numérico | objeto normalizado |

Mapeamento (todos defensivos):
- `byPhase` ← `{planning_cost_usd, orchestration_cost_usd, implementation_cost_usd}`;
  `implementation` vira `null` se `scoping_suspect` for `true`.
- `tokens`/`totalTokens` ← `tokens.by_type` e `tokens.total` **quando presentes**;
  ausentes ⇒ deixados `null`/indefinidos para o coordenador resolver com soma crua.
- `partial` ← `unpriced_models.length > 0`.
- `scopingSuspect` ← `scoping_suspect ?? false`.
- `excludedSubagents` ← `excluded_subagents ?? null`.
- `recoveredSubagents` ← `recovered_subagents ?? null`.
- `complete` ← `complete ?? null`.

### 3. `cost.ts` — coordenador

Extrair a soma crua de hoje num helper reusável; `readCostRollup` vira o juiz:

```
readCostRollup(specDir):
  reportPath = report.html se existir   (inalterado)
  report = readCostReport(specDir)
  if report:
     source = "authoritative"
     totalCostUsd, byPhase  ← report
     tokens/totalTokens     ← report SE tiver bloco; senão sumRawCosts(...).tokens   (D2)
     partial, scopingSuspect, excluded/recovered, complete ← report
  else:
     raw = sumRawCosts(costsDir)
     source = raw tem dados ? "preliminary" : "empty"     (comportamento atual preservado)
     campos novos em default neutro (scopingSuspect=false, byPhase=null, complete=null, ...)
```

Backward-compatible: sem `cost-report.json`, o caminho é o de hoje, só ganhando
`source`.

### 4. Watcher — +1 glob

Em `src/collector/watcher.ts`, adicionar ao array de patterns:

```ts
join(r, "*", ".agent-session", "**", "cost-report.json"),
```

A chegada/atualização do arquivo reprocessa o board (debounced, como os demais).

### 5. UI

| Lugar | Mudança |
|---|---|
| `web/src/components/DetailDrawer.tsx` | Quando `source==="authoritative" && byPhase`: `<dl>` por fase (planning/orchestration/implementation via `fmtUsd` — `null`→"—"). Badge **"preliminar"** quando `source==="preliminary"`. Badge "$ parcial" atual mantido. |
| `web/src/components/KanbanCard.tsx` | Marcador discreto "preliminar" quando `source==="preliminary"`. Agregado inalterado. |
| `web/src/components/SpecTable.tsx` | Idem card. |
| `web/src/format.ts` | **Sem mudança** — `fmtUsd(null)` já devolve "—". |
| `web/src/app.css` | Estilos do badge "preliminar" e da lista por fase. |

`totalCostUsd` no headline segue o total do report mesmo com `scopingSuspect`
(ver D4); só a linha `implementation` do breakdown vira "—".

## Testes

- `src/collector/cost-report.test.ts` (novo): válido completo · válido mínimo
  (shape FEAT-010, sem `tokens`) · JSON inválido · ausente · `scoping_suspect=true`
  (implementation → null).
- `src/collector/cost.test.ts` (**novo — não existe hoje**): coordenador escolhe
  authoritative / preliminary / empty; fallback de tokens quando o report não tem
  bloco `tokens`.
- `src/collector/watcher.test.ts`: glob inclui `cost-report.json`.
- Web: teste do `DetailDrawer` cobrindo breakdown por fase + badge "preliminar" +
  implementation "—" sob `scopingSuspect`.

## Escopo / estimativa

~11 arquivos: 3 backend código (`types.ts`, `cost-report.ts`, `cost.ts`) +
2 backend teste + `watcher.ts` (+ seu teste) + 4 web (`DetailDrawer`, `KanbanCard`,
`SpecTable`, `app.css`). Risco baixo — aditivo e backward-compatible.

## Não-objetivos (YAGNI)

- **Não** calcular $ — o aios só lê números já gravados; `report.html` segue a
  fonte humana de custo em $.
- **Não** surfacar `spec_id`/`generated_at` do cost-report na UI (redundantes com
  o que o cockpit já tem).
- **Não** badge no headline agregado sob `scopingSuspect` nesta iteração (ver D4);
  reabrir se a leitura confundir na prática.
- **Não** validar o arquivo contra o JSON Schema canônico em runtime — tolerância
  por campo é suficiente e evita acoplar o cockpit ao schema versionado do framework.
