# Design — Revelação suave (typewriter) do resumo + custo da geração

Data: 2026-06-01
Escopo: **só a apresentação do resumo no `SummaryBlock`** (dentro do aside) + threading do custo pela pilha de summary já existente.
Fora de escopo: markdown/formatação do texto (o conteúdo está bom), qualquer tela fora do aside.

## Problema

1. **Aparição "quadrada":** os chunks do WS chegam em rajadas de 3-4 palavras; cada `summary:chunk` é anexado direto ao `text`, então o texto pula de várias palavras de uma vez — efeito truncado/quadrado, não o "digitando" suave dos chats modernos.
2. **Sem custo visível:** o evento `result` do CLI traz `total_cost_usd`, mas a gente descarta. O usuário quer ver quanto custou gerar aquele resumo.

## Parte 1 — Revelação suave (`useTypewriter`)

Novo hook isolado `web/src/state/useTypewriter.ts`:
- Assinatura: `useTypewriter(target: string, animate: boolean): string`.
- Mantém um índice `revealed`. A cada `requestAnimationFrame`, avança `max(2, ceil((target.length - revealed) / 30))` caracteres — ritmo **adaptativo**: suave, mas drena o backlog em ~30 frames (~0,5s) pra nunca ficar muito atrás de um stream rápido.
- `animate === false` → retorna `target` inteiro imediatamente (cache reabre instantâneo).
- Quando `target` cresce (novo chunk), continua revelando de onde parou. Quando `revealed >= target.length`, para o rAF.
- Cleanup do rAF no unmount e quando `animate` vira false.

`useTaskSummary` ganha um flag **`streamed: boolean`** — `false` ao montar e em `summary:cached`; vira `true` no primeiro `summary:chunk`. Distingue "veio do stream" (anima) de "veio do cache" (instantâneo). Resetado em `generate`/`regenerate`.

`SummaryBlock`:
- `const display = useTypewriter(s.text, s.streamed && (s.state === "streaming" || s.state === "ready"))`.
- Renderiza `display` no lugar de `s.text`.
- Cursor `▋` piscando (CSS `@keyframes blink`) ao lado do texto enquanto `s.state === "streaming"` ou enquanto `display.length < s.text.length`.

## Parte 2 — Custo da geração

Threading do `total_cost_usd` pela pilha existente:
- **`parse.ts`:** o evento `done` ganha `costUsd: number | null` — extraído de `result.total_cost_usd` (number) quando presente, senão `null`. `ParsedEvent` done = `{ kind: "done"; text: string; costUsd: number | null }`.
- **`service.ts`:** `onDone(fullText, costUsd)` — repassa o custo do evento `done`.
- **`handler.ts`:** inclui `costUsd` no `summary:done` e grava no cache.
- **`cache.ts`:** `CachedSummary` ganha `costUsd: number | null`; `writeSummary` recebe e grava.
- **`summaryClient.ts`:** `SummaryServerMsg` ganha `costUsd?: number | null` (em `summary:done` e `summary:cached`).
- **`useTaskSummary.ts`:** estado `costUsd: number | null`; setado em `done` e `cached`.
- **`SummaryBlock`:** no rodapé, quando `s.costUsd != null` e `state` é `ready`/`stale`: `custo desta geração · {fmtUsd(costUsd)}`, discreto (cinza, fonte pequena), com `title` explicando que inclui o overhead do CLI.

## Decisões

- **Ritmo adaptativo** sobre ritmo fixo: ritmo fixo (1 char/frame) travaria ~25s num resumo de 1500 chars despejado de uma vez; o adaptativo mantém o "digitando" sem lag.
- **`streamed` flag** sobre animar sempre: reabrir do cache deve ser instantâneo (é cache); animar seria irritante.
- **Custo: número real do CLI** (inclui overhead de ~29k tokens dos hooks locais), com `title` explicativo em vez de esconder/ajustar — honestidade sobre o custo real. Alternativa rejeitada: subtrair o overhead (não temos um número limpo e seria enganoso).
- **Sem dependência nova:** `requestAnimationFrame` é nativo (jsdom suporta); coerente com o ethos sem-lib do projeto.

## Testes

- `useTypewriter`: revela progressivamente até o fim; `animate=false` → texto inteiro na hora; continua de onde parou quando o target cresce. (rAF mockado / fake timers.)
- `parse`: extrai `total_cost_usd`; `costUsd: null` quando ausente.
- `service`/`handler`/`cache`/`hook`: `costUsd` threaded ponta a ponta.
- `SummaryBlock`: mostra o custo no estado ready; cursor presente durante streaming.
