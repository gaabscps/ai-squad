# Design — token usage + per-type cost in the session report

> Status: design aprovado em brainstorm (2026-05-31). Implementação manual
> (Read/Edit/Write) — o ai-squad não roda o próprio SDD.

## Problema

O report da sessão (e o cost report markdown) mostra o custo só em **`$`**, agregado
por fase (planning / orchestration / implementation). O usuário quer ver o **custo
em tokens** junto do `$` para ter noção do volume real que está gastando — e, mais
do que o total, entender **onde** o custo nasce (que tipo de token leva o dinheiro).

Os tokens **já são capturados**: `transcript_cost.extract_transcript_cost` acumula,
por modelo, os buckets `input_tokens`, `output_tokens`, `cache_read_input_tokens`,
`cache_creation_input_tokens` (+ `ephemeral_5m/1h`) em `by_model`. O agregador
`cost_report.build_cost_report` é que **descarta** esse `by_model` — só soma
`total_cost_usd` por fase. Logo o dado existe; falta agregá-lo e exibi-lo.

## Goal

No report da sessão (HTML) e no cost report markdown, expor, ao lado do `$`:
- o **total de tokens**;
- uma **matriz fase × tipo** onde cada célula carrega **tokens + o `$` daquele tipo
  naquela fase**, decompondo o custo total de forma que a soma das células reconcilie
  com o `total_cost_usd` exibido.

## Fora de escopo (registrado)

- **Visão temporal dia/semana/mês (feature B).** É cross-sessão, sobre os transcripts
  persistentes do `~/.claude` (o `.agent-session/` é efêmero — apagado pelo `/ship`),
  com superfície de saída nova. Feature independente; não entra aqui.
- **Breakdown por modelo.** A matriz agrega sobre todos os modelos de uma fase. Quebrar
  por modelo é densidade extra sem pedido; YAGNI.
- **`ephemeral_5m`/`ephemeral_1h`** como linhas próprias. São subdivisões de
  `cache_creation`; entram na coluna `cache_creation`, não como tipos separados.

## Decisões travadas no brainstorm

| Eixo | Decisão | Alternativa rejeitada (e por quê) |
|------|---------|-----------------------------------|
| **Escopo** | Só feature A (tokens no report da sessão). | B (temporal) — fonte de dados e superfície diferentes; sequenciar depois se quiser. |
| **Granularidade** | Total + por tipo + por fase (matriz fase × tipo). | Total puro (dominado por cache_read, distorce); só por tipo ou só por fase (perde um eixo). |
| **Cada célula** | `tokens ($)` — volume e valor juntos. | Só tokens — perde o efeito educativo de "onde o $ nasce". |
| **Cálculo do `$` por tipo** | No **capture** (`cost_for_usage` retorna `cost_by_type`; gravado em `by_model`), com **fallback de re-precificação** no report para arquivos legados. | Sempre re-precificar no report — se preços mudarem entre captura e report, a matriz não fecharia com o `total_cost_usd` já gravado. |
| **Buckets** | 4 canônicos: input, output, cache_read, cache_creation. | Incluir ephemeral_5m/1h como tipos — ruído. |

## Fatos de dados (verificados)

- **Tokens nas 3 fases:** `session-<id>.json` guarda `planning` e `orchestration` como
  o resultado completo de `extract_transcript_cost` (com `by_model`); `agent-*.json`
  guarda a fase `implementation` (com `by_model`). Logo há buckets para as três fases.
- **`$` por tipo é derivável.** `pricing.cost_for_usage` já calcula os componentes:
  - `input` = `input_tokens × in_rate`
  - `output` = `output_tokens × out_rate`
  - `cache_read` = `cache_read × 0.10 × in_rate`
  - `cache_creation` = `(w5 × 1.25 + w1 × 2.00) × in_rate`
  Hoje ele colapsa tudo em `cost_usd`; basta também retornar os componentes.

## Arquitetura — fluxo do dado

```
capture (transcript_cost via cost_for_usage)
  └─ by_model[model] += token buckets  +  cost_by_type {input,output,cache_read,cache_creation}
        │
        ▼
build_cost_report  (soma sobre arquivos/fases)
  └─ tokens.by_phase[phase][type] (counts)  +  cost.by_phase[phase][type] ($)
     tokens.by_type / cost.by_type (soma das fases)
     tokens.total / (cost total = total_cost_usd já existente)
     [fallback: arquivo sem cost_by_type → re-precifica via load_prices() a partir dos buckets]
        │
        ├─────────────────────────┐
        ▼                          ▼
session_report.py (HTML)     cost_report.render_markdown (handoff/console)
  KPI de Custo: + linha       + linha de tokens por fase (paridade onde tem $)
  "12.4M tokens"
  <details> "Token usage":
  matriz fase × tipo (tokens + $)
```

## Componentes e mudanças

### `squads/sdd/hooks/pricing.py`
- `cost_for_usage` passa a retornar, além de `cost_usd`/`priced`/…, um campo
  `cost_by_type: {input, output, cache_read, cache_creation}` (os componentes que já
  calcula). Aditivo, não-quebra. Modelo não-precificado → `cost_by_type` ausente/None
  (mesma semântica de `priced: False`).

### `squads/sdd/hooks/transcript_cost.py`
- Ao montar `by_model[model]`, incluir `cost_by_type` (vindo de `cost_for_usage`) e
  manter os buckets de token já presentes. Aditivo ao shape dos arquivos de custo.

### `squads/sdd/hooks/cost_report.py`
- `build_cost_report` passa a acumular, por fase e por tipo:
  - **tokens** (dos buckets em `by_model`);
  - **`$`** (de `cost_by_type` em `by_model`; **fallback**: se ausente, re-precifica
    via `pricing.load_prices()` + `cost_for_usage` a partir dos buckets).
- Retorna, somado ao dict atual:
  ```python
  "tokens": {
    "by_phase": {phase: {input, output, cache_read, cache_creation, "total"}},
    "by_type":  {input, output, cache_read, cache_creation},
    "total": N,
  },
  "token_cost": {
    "by_phase": {phase: {input, output, cache_read, cache_creation, "total"}},
    "by_type":  {input, output, cache_read, cache_creation},
    # total do $ continua sendo total_cost_usd (não dup)
  },
  ```
- **Invariante de reconciliação:** `sum(token_cost.by_type.values()) ≈ total_cost_usd`
  (tolerância de arredondamento). Vira asserção de teste.
- `render_markdown` ganha uma linha de **tokens por fase** (paridade "onde tem $, tem token").
- Degradação: captura ausente / unpriced → tokens podem existir sem `$` (mostra
  tokens, `$` em branco); zero captura → matriz vazia, sem quebrar.

### `squads/sdd/hooks/session_report.py`
- Helper novo `_fmt_tokens(n)` → compacto (`K`/`M`, ex.: `1.35M`, `775K`).
- **KPI de Custo (dashboard):** uma linha a mais com o total de tokens
  (`{_fmt_tokens(total)} tokens`) ao lado do `$`.
- **Seção nova "Token usage"** após o dashboard, num `<details>` expansível: a matriz
  fase × tipo, cada célula `{_fmt_tokens(tok)} (${cost:.2f})`, com linha/coluna de
  total e o canto reconciliando com o `$` do dashboard.
- Tudo chrome em inglês (consistente com o padrão recém-aplicado) + os números (dados).

### Testes — `squads/sdd/hooks/__tests__/`
- Enriquecer as fixtures (`_seed_costs` / `_packet`) com `by_model` real (buckets +
  `cost_by_type`) para planning/orchestration (`session-*.json`) e implementation
  (`agent-*.json`).
- Asserções:
  - matriz presente no HTML (`Token usage`, as 4 colunas de tipo, as 3 fases + Total);
  - `_fmt_tokens` formata K/M corretamente (unit);
  - **reconciliação:** soma das células `$` == `total_cost_usd` (tolerância);
  - soma de `tokens.by_phase` por tipo == `tokens.by_type`; soma de `by_type` == `tokens.total`;
  - **fallback:** arquivo de custo sem `cost_by_type` ainda produz a matriz (re-precificada);
  - captura ausente → tokens 0, sem exceção.
- `cost_for_usage`: unit test do novo `cost_by_type` (componentes somam `cost_usd`).

## Verificação

- `pytest squads/sdd/hooks/__tests__/` verde (incluindo os novos asserts e os existentes).
- Smoke test: gerar o HTML de uma sessão real (ex.: `FEAT-003`) e conferir a seção
  "Token usage" + reconciliação visual com o `$` do dashboard.

## Deploy

Após implementar e testar: `npm run sync` (em `packages/cli`) + `ai-squad deploy
--hooks-only` para os reports gerados neste repo passarem a exibir os tokens. As
cópias deployadas (`.claude/hooks/`) são geradas — não editar à mão.
