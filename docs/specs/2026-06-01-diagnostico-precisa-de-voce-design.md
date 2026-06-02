# ai-squad-os — Diagnóstico da coluna "Precisa de você"

**Data:** 2026-06-01
**Status:** design aprovado em brainstorm (LGTM do usuário); aguardando review do spec escrito antes do plano de implementação.
**Origem:** a coluna "Precisa de você" é onde mora o trabalho do usuário, mas o card/drawer dão **pouca pista do que fazer** — o rótulo diz *que* travou (`"decisão humana"`, `"T-008 bloqueada"`), não *o que* fazer nem por quê. O histórico (`timeline[]`, `findings[]`) já está no Store; falta sintetizá-lo e levar à ação.

---

## 1. Objetivo

Tornar a coluna "Precisa de você" acionável: a partir de uma spec travada, (a) **mostrar o cru** que explica o bloqueio, (b) **sintetizar** "por que parou + o que fazer" com IA sob demanda, e (c) **levar à ação** gerando um prompt copiável pro Claude Code — onde a resolução de fato acontece.

Restrições herdadas (não negociáveis):
- **Só leitura.** O aiOS observa; nunca escreve no ai-squad. O app **explica e entrega pronto**; **destravar é ação fora do app**.
- **Custo nunca é calculado** — só somado do que já existe; o report.html é a fonte da verdade de $.
- **IA sempre sob demanda** (nunca automática) e **sempre via quota da assinatura, nunca API on-demand** (paga por token).

---

## 2. Decisões de design (com razão e alternativa rejeitada)

| Decisão | Razão | Alternativa rejeitada |
|---|---|---|
| **Híbrido A+B**: IA explica no app + handoff pro Claude Code | Escolha explícita do usuário; respeita read-only (app explica, Claude Code resolve) | Só handoff (B): perde a síntese no cockpit. Só IA (A): explica mas não leva à ação |
| **One-shot no app, conversa no Claude Code** (Eixo 1) | One-shot reusa toda a máquina do resumo; a conversa real (com contexto e escrita) já existe no Claude Code via handoff | Chat multi-turno no drawer: exige estado de sessão novo (resume ou replay de histórico) + custo de tokens do histórico crescente |
| **Costura de adaptador agora, só Claude no dia 1** (Eixo 2) | Cada adaptador é trabalho+teste real e o formato muda entre versões da CLI; abrir 4 portas contra um blocker nunca visto é surface demais | Implementar Codex/Gemini/Kiro/Cursor já: custo sem valor comprovado. Cravar no Claude sem costura: fecharia a porta |
| **Sem seletor de modelo visível no dia 1** | Dropdown com uma opção só é ruído; a costura por baixo torna adicionar depois ~1 linha de UI | Dropdown "Claude" sozinho: não agrega até existir 2º adaptador |
| **Handoff = só gerar o prompt** (usuário abre o Claude Code na mão) | Mais honesto com read-only e mais simples: o app produz texto, nunca dá spawn de terminal nem finge resolver | Copiar comando de resume: presume o comando exato (não validado). Abrir terminal: frágil, específico de SO |
| **Mostrar o cru ao lado do diagnóstico IA** | Defesa contra a IA errar o alvo: como o prompt é desenhado contra dados de blocker ainda não vistos, o humano vê a matéria-prima e não fica refém da síntese. Entrega a camada 1 de brinde | Só o diagnóstico IA: esconde a fonte; se a IA alucinar, o usuário não tem como conferir |
| **Cache por fingerprint do contexto** (não por tempo) | O diagnóstico só muda se timeline/findings mudarem; cachear por conteúdo evita re-spawn e invalida sozinho quando o blocker evolui | Sem cache: re-spawna a cada abertura do drawer, desperdiça quota |
| **`runAgent` genérico** em vez de duplicar o `service` | Resumo e diagnóstico são o mesmo gesto (Claude one-shot streamado); duplicar = dois lugares pra consertar bug de parsing | Pilha paralela: divergência e bug duplicado |
| **Trava de `ANTHROPIC_API_KEY` no spawn** | Garante "nunca API on-demand" mesmo se a env-var vazar no shell que sobe o servidor | Confiar no ambiente: um `export ANTHROPIC_API_KEY` acidental cobraria API sem avisar |

> **Contexto da decisão (registrado):** o usuário **nunca viveu um blocker real** de ponta a ponta. Logo, o prompt é desenhado contra dados de bloqueio ainda não observados. Mitigações no design: (1) o prompt é robusto a dado escasso ("não invente quando vazio"); (2) o cru aparece ao lado do diagnóstico. Quando o 1º blocker real surgir, ajustar o prompt com base no formato observado.

---

## 3. A forma: um contexto, duas saídas, reusando a máquina do resumo

A percepção central: **isto não é uma pilha nova** — é a feature de resumo (`src/summary/`) aplicada a uma spec travada em vez de uma task. O resumo já faz spawn do Claude → stream → cache → revelação typewriter. Reaproveita-se a máquina; troca-se a matéria-prima e o prompt.

```
                 ┌─ AttentionContext ─┐   (1 construtor; dado já no Store)
   spec travada →│ status + motivo    │
                 │ timeline[] notes   │
                 │ findings da task   │
                 │ projectPath + id   │
                 └─────────┬──────────┘
                           │
            ┌──────────────┴───────────────┐
            ▼                              ▼
   (A) prompt de diagnóstico       (B) prompt de handoff
       → spawn Claude → stream         → bloco copiável (SEM IA)
       → "por que parou +              → usuário cola no Claude Code
          o que fazer" no drawer          e abre na mão
```

O mesmo `AttentionContext` alimenta as duas saídas. A camada "mostrar o cru" cai de brinde: o que vai pro prompt também aparece na tela.

---

## 4. Backend (em `src/attention/`, espelhando `src/summary/`)

| Peça | O que faz | Reusa / espelha |
|---|---|---|
| `context.ts` | Função pura: `Spec` + `projectPath` → `AttentionContext` (status, motivo via `attentionReason`, timeline notes relevantes, findings da task travada). Robusto a vazio. | — |
| `prompt.ts` | `AttentionContext` → prompt one-shot. Tom didático (igual ao resumo); regra explícita "não invente se vazio"; saída em 3 blocos: **por que parou** / **o que te pedem** / **próximo passo concreto**. | espelha `src/summary/prompt.ts` |
| `handoff.ts` | `AttentionContext` → bloco de texto copiável pro Claude Code (caminho do projeto + spec id + estado/contexto + pedido "ajude a retomar"). **Sem chamada de IA.** | — |
| `fingerprint.ts` | Hash determinístico do `AttentionContext` (status + notes + findings) pra detectar diagnóstico velho. | espelha `src/summary/fingerprint.ts` |
| `cache.ts` | Read/write do diagnóstico em `.aios-cache`, chaveado por `projectId|specId` + fingerprint. | espelha `src/summary/cache.ts` |
| `src/ai/run.ts` (**costura do Eixo 2**) | Extrai `runSummary` num `runAgent(prompt, cb, {adapter, cwd})`. `adapter = { buildArgs(): string[]; parseLine(line): ParsedEvent \| null }`. Dia 1: só `claudeAdapter` (a lógica atual de `CLI_ARGS` + `parseStreamLine`). **Resumo e diagnóstico passam a usar.** No spawn, remove `ANTHROPIC_API_KEY` da env. | refatora `src/summary/service.ts` + `src/summary/parse.ts` |
| WS `attention:diagnose` (fetch/generate) | Rota nova espelhando `summary:fetch`/`summary:generate`: `fetch` devolve cache (com flag `stale` via fingerprint); `generate` cancela duplicata, spawna, streama `chunk`/`done`/`error`, grava cache. Chave `projectId\|specId`. | espelha `src/summary/handler.ts` |

**Refactor do summary:** `runSummary` vira um wrapper fino sobre `runAgent(prompt, cb, { adapter: claudeAdapter })`, mantendo a assinatura atual (`SummaryCallbacks`/`SummaryHandle`) pra não quebrar `handler.ts`. Escopo do refactor limitado a extrair argv+parse pro adaptador; nada além disso.

---

## 5. Frontend (no `DetailDrawer`, só pra item da coluna "attention")

Renderiza uma seção nova **apenas quando `columnForSpec(spec) === "attention"`**:

1. **O cru, sempre visível** — timeline notes + findings da task travada (camada 1, grátis, sem IA). Reusa a renderização de markdown existente onde fizer sentido.
2. Botão **"O que preciso fazer aqui?"** → dispara o diagnóstico one-shot, streamado e revelado com typewriter. Hook `useAttentionDiagnosis` (máquina de estados idle→loading→streaming→done/error), espelhando `web/src/state/useTaskSummary.ts` + `web/src/state/useTypewriter.ts`. Cliente WS singleton espelhando `web/src/state/summaryClient.ts`.
3. Botão **"Copiar prompt pro Claude Code"** → copia o bloco de handoff (`navigator.clipboard`). O usuário abre o Claude Code na mão.

Sem seletor de modelo visível (ver §2). O rodapé do diagnóstico mostra o custo da geração (`total_cost_usd` do `result`), igual ao resumo.

---

## 6. Fora de escopo (YAGNI)

- **Conversa / estado multi-turno no app** — Eixo 1: a ida-e-volta vive no Claude Code via handoff.
- **Adaptadores Codex / Gemini / Kiro / Cursor** — Eixo 2: a costura fica pronta; a implementação vem quando houver necessidade real.
- **Seletor de modelo na UI** — adiado até existir um 2º adaptador.
- **Spawn de terminal / abrir o Claude Code pelo app** — o usuário abre na mão.
- **Decisão por finding** (atacado/aceito/recusado) — depende de [ai-squad#43](https://github.com/gaabscps/ai-squad/issues/43); mesmo limite do redesign de UX.
- **Qualquer escrita no ai-squad.**

---

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Prompt desenhado contra dados de blocker não observados | "Não invente se vazio" no prompt + cru visível ao lado; reabrir o prompt quando o 1º blocker real surgir |
| Vazamento de `ANTHROPIC_API_KEY` → cobrança de API | Trava no spawn (remove a env-var) |
| Re-spawn desnecessário gastando quota | Cache por fingerprint do contexto |
| Refactor do summary quebrar a feature existente | Manter assinatura de `runSummary`; o refactor só extrai argv+parse; testes do summary continuam verdes |
