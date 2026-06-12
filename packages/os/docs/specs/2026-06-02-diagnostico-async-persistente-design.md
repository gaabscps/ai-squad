# ai-squad-os — Diagnóstico de atenção assíncrono, persistente e concorrente

**Data:** 2026-06-02
**Status:** design aprovado em brainstorm (LGTM do usuário 2026-06-02); insumo para o spec formal do pipeline SDD (`/pm` → `/spec-writer FEAT-002`).
**Origem:** hoje, ao clicar "O que preciso fazer aqui?" no drawer de uma spec da coluna "Precisa de você", o estado da geração vive **dentro do componente do drawer** (`useAttentionDiagnosis`, via `useState`). Fechar o drawer desmonta o componente e o estado visual some; o socket singleton continua vivo, mas como o hook se desinscreve no cleanup, os chunks que continuam chegando caem no vazio — o usuário não vê o streaming nem fica sabendo que terminou. Rodar a mesma spec de novo cancela a anterior. Não há feedback de completude com o drawer fechado, nem visão das várias análises em paralelo.

---

## 1. Objetivo

Tornar a geração do diagnóstico de atenção **assíncrona, persistente e concorrente**:
- **Persistente** durante a geração: fechar ou trocar o drawer não perde nem cancela a análise.
- **Concorrente**: rodar várias análises ao mesmo tempo (cap 3 + fila).
- **Com feedback**: dock de jobs ativos (barra indeterminada + etapa) e toast de completude/falha, independentes de qual drawer está aberto.

Restrições herdadas (não negociáveis):
- **Só leitura.** O aiOS observa; nunca escreve no ai-squad.
- **Custo nunca é calculado** — só somado do que já existe.
- **IA sempre sob demanda** (nunca automática) e **sempre via quota da assinatura, nunca API on-demand**.

---

## 2. A virada de design

O dono do estado da geração deixa de ser o **componente do drawer** e passa a ser um **store global de jobs** no front (Context + `useReducer`, montado no topo da app — nunca desmonta), alimentado pelo socket singleton que **já** persiste. O drawer vira uma *janela* que lê esse store; o dock e o toast são outras janelas do mesmo store.

> **Alternativa rejeitada:** mover a fila e o estado dos jobs para o **backend** (backend como dono, re-emitindo tudo ao reconectar). Rejeitada porque o usuário aceitou **Nível 1 durante a geração** — não precisa sobreviver a reload da página —, então guardar o estado in-flight no front é suficiente e bem mais simples. O backend ganha **só** a fila de concorrência, que ele precisa de qualquer jeito para controlar o `spawn`.

---

## 3. Decisões de design (com razão e alternativa rejeitada)

| Decisão | Razão | Alternativa rejeitada |
|---|---|---|
| **Persistência em dois regimes**: Nível 1 enquanto gera, Nível 3 após gerado | Escolha explícita do usuário. O Nível 3 do resultado **já existe** (cache em disco por fingerprint); o Nível 1 in-flight elimina o trabalho pesado de re-acoplar stream vivo a socket novo | Nível 2 in-flight (re-acoplar após reload): trabalho real no backend sem valor pedido |
| **Cap 3 + fila** de concorrência | Cada geração dá `spawn` num processo Claude consumindo a quota; cap protege contra rate-limit ao disparar muitas; a fila não bloqueia o usuário | Sem limite: risco de estourar rate-limit/máquina. Cap sem fila: menos fluido (precisa voltar e reclicar) |
| **Dock de jobs + toast** | O usuário pediu "progressbar" para acompanhar VÁRIAS; o dock mostra todas de relance e é o lar do progresso quando o drawer está fechado; o toast cobre a completude | Só toast + contador: esconde o progresso das que não estão no drawer. Toast com barra embutida: polui com 3 toasts persistentes |
| **Barra indeterminada + rótulo de etapa** (`na fila`/`gerando`/`pronto`) | O streaming do LLM não tem progresso determinístico; barra indeterminada é honesta | Pseudo-progresso "fake" até 90%: mente sobre o estado real |
| **Toast + dock caseiros** (sem lib) | O dock é caseiro de qualquer jeito (nenhuma lib de toast resolve painel de jobs); trazer lib resolveria só metade e somaria dependência; controle total do visual (preferência por tema light) | sonner: dependência + estilo default a sobrescrever; dock continua caseiro |
| **Manter a API pública de `useAttentionDiagnosis`** | `AttentionPanel`/`DetailDrawer` consomem `d.generate`/`d.state`/`d.text`; trocar só as tripas (lê do store) deixa o painel intacto — menos superfície de risco | Reescrever o painel: mudança maior sem ganho |
| **Botão de cancelar no dock** (`attention:cancel`) | Com 3 simultâneas + fila, é preciso poder matar uma travada; `runAgent` já devolve `cancel()` (`proc.kill()`) — custo baixo | Sem cancelar: usuário fica refém de uma análise presa |

---

## 4. Backend (`src/attention/handler.ts` + protocolo WS)

| Mudança | O quê | Reusa |
|---|---|---|
| **Fila de concorrência** | `MAX_CONCURRENT = 3`. `active` Map (já existe) + fila `pending[]`. No `generate`: se `active.size < 3` → inicia; senão → enfileira e emite `attention:queued`. Quando uma termina (done/error/cancel) → puxa a próxima | `active` Map e `clearIfCurrent` já existentes |
| **Msg `attention:queued`** (saída) | `{projectId, specId}` — job entrou na fila (estado "na fila" no dock) | espelha as msgs existentes |
| **Msg `attention:cancel`** (entrada) | `{projectId, specId}` → `handle.cancel()` se rodando, ou remove de `pending[]` se ainda na fila | `AgentHandle.cancel()` (`src/ai/run.ts:86`) |

O cancelamento por re-geração da mesma spec (`handler.ts:73`) **continua**: gerar a mesma spec de novo substitui a anterior.

---

## 5. Frontend

| Peça | O que faz | Reusa / espelha |
|---|---|---|
| `web/src/state/diagnosisJobs.tsx` (**novo**) | Store global: Context + `useReducer`. Único assinante do `attentionClient`. Fonte de verdade por chave `projectId\|specId`: estado, texto, handoff, custo, etc. Mantém a lista de jobs ativos para o dock | espelha `web/src/state/projects.tsx` |
| `web/src/state/useAttentionDiagnosis.ts` (**refatora**) | Mesma API pública (`generate`/`regenerate`/`state`/`text`/`handoff`/...), mas **lê do store** em vez de `useState` próprio. `generate` registra o job no store e chama `client.generate` | mantém a assinatura atual |
| `web/src/components/JobDock.tsx` (**novo**) | Dock no canto inferior; lista jobs ativos (`queued\|generating\|streaming`) com nome da spec + barra indeterminada + rótulo + botão cancelar. Some quando vazio; recolhível | — |
| `web/src/components/Toast.tsx` + `ToastProvider` (**novo**) | Sistema de toast caseiro (Context + componente). Disparado na transição de um job → `ready`/`error`. Toast nomeia a spec e é clicável (abre o drawer dela) | espelha o padrão de Provider de `projects.tsx` |

**Por que a API do hook não muda:** o `AttentionPanel` consome `d.generate`/`d.state`/`d.text` (`AttentionPanel.tsx:15`). Mantendo a interface e trocando só as tripas, painel e `DetailDrawer` ficam intactos.

---

## 6. Fluxo central

```
1. Drawer da FEAT-007 → "O que preciso fazer aqui?"
        │  store: job(007)=generating; client.generate(007)
        ▼
2. FECHA o drawer → AttentionPanel desmonta
        │  store (global) segue inscrito em 007 e acumulando chunks; socket não fecha
        ▼
3. Abre FEAT-012 e gera também → roda em paralelo (cap 3)
        │  Dock: 007 ▓▓▓░ gerando   012 ▓░░░ gerando
        ▼
4. 007 termina (drawer da 012 aberto)
        │  store: job(007)=ready, grava cache → dispara TOAST verde
        ▼
5. Toast "Diagnóstico da FEAT-007 pronto" (clicável → abre o drawer da 007)
```

---

## 7. Ciclo de vida / persistência

| Momento | Garantia | Como |
|---|---|---|
| **Gerando** (in-flight) | Nível 1: sobrevive a fechar/trocar drawer; reload pode perder o streaming | Estado no store global do front |
| **Gerado com sucesso** | Nível 3: sobrevive a restart do servidor | **Já existe** — `.aios-cache` em disco por fingerprint |

---

## 8. Fora de escopo (YAGNI)

- Re-acoplar o streaming ao vivo após reload da página (Nível 2 in-flight) — dispensado.
- Persistir jobs **em andamento** em disco — geração dura segundos.
- Histórico de análises passadas além do cache atual por spec.
- Adaptadores não-Claude / seletor de modelo.
- Qualquer escrita no ai-squad.

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Toast dispara para spec que o usuário não lembra | Toast nomeia a spec e é clicável (abre o drawer) |
| Dock cobre conteúdo | Canto inferior, recolhível, some quando vazio |
| Job "fantasma" no backend após reload (socket morto) | `send` num ws fechado é no-op; o processo termina e grava o cache; `clearIfCurrent` limpa o Map |
| Refactor de `useAttentionDiagnosis` quebrar o painel | Manter a API pública; testes do hook e do painel continuam verdes |
