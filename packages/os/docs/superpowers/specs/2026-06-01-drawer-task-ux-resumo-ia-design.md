# Design — UX da task (T-XXX) no drawer + resumo de ensino via Claude CLI

Data: 2026-06-01
Escopo: **somente o conteúdo da task dentro do aside (`DetailDrawer` → `TaskItem`)**.
Fora de escopo: qualquer tela fora do aside, redesign do board/tabela/kanban, refactors fora deste contexto.

---

## 1. Problema

Ao expandir um `T-XXX` no drawer, o painel hoje despeja **5 blocos crus empilhados** (resumos de dispatch, arquivos mudados, findings, testes, histórico de loops) com fonte monoespaçada em tudo — "cara de terminal cuspindo informação". A causa raiz confirmada: o `TaskItem` rico foi adicionado no commit `da85552`, mas **quase nenhuma das classes CSS dele existe** em `web/src/app.css` (só `.task-loops`). São `<ul>` sem estilo.

Faltam duas coisas:
1. **Hierarquia visual** — o que importa primeiro, o detalhe técnico depois.
2. **Um resumo legível** que explique o que foi feito na task, gerado sob demanda (nunca automático).

## 2. Objetivo

Dentro do aside, tornar a task **fácil de ler e de navegar**, com:
- Um **resumo de ensino** (técnico, mas explicando o porquê e o mecanismo pra um humano) gerado por IA, **disparado por clique**, em **streaming** ao vivo.
- Os **dados crus reorganizados** em cards legíveis, recolhidos por padrão.

Não-objetivos: calcular custo em $, alterar o coletor/store além do necessário, escrever nos artefatos do framework.

## 3. Layout (validado com o usuário)

### Recolhido (linha na lista)
```
T-008   ● concluída      ↻ 2 loops   1.2k tok   ▸
```

### Expandido — resumo no topo, detalhes recolhidos embaixo
- **Bloco "✨ Resumo"** em destaque no topo:
  - **Vazio:** texto-convite + botão `gerar resumo`.
  - **Gerando:** texto aparecendo ao vivo (streaming) + indicador "gerando…".
  - **Pronto:** prosa legível (fonte normal, não-mono) + `gerado HH:MM` + botão `↻ regerar`.
  - **Desatualizado:** resumo + aviso "desatualizado — regerar" (ver §6).
  - **Erro:** mensagem amigável (ex.: "Claude CLI não encontrado" / "falhou ao gerar") + botão tentar de novo.
- **`▸ Detalhes técnicos`** — recolhido por padrão. Ao abrir, os blocos crus, cada um como **card com cabeçalho contável**:
  - `Arquivos (3)` — paths em mono.
  - `Findings (N)` — por severidade (mantém cores atuais).
  - `Testes (2) ✓` — comando em mono, ✓/✗/? por teste.
  - `Loops` — histórico por loop.
  - Mono fica **restrita a path/comando/ids**; rótulos e prosa em fonte normal.

Três mudanças que matam a "cara de terminal": prosa legível no topo; detalhes recolhidos; blocos viram cards contáveis em vez de listas cruas.

## 4. Arquitetura

Três peças, fronteiras limpas (segue a arquitetura do projeto: Coletor → Store → UI):

```
[TaskItem.tsx]  --WS summary:generate-->  [ui/app.ts WS handler]
     ^                                          |
     |                                    [summary/service.ts]
     | summary:chunk / summary:done /            |  spawn claude --print
     | summary:error  <-----------------         |  --output-format=stream-json
                                                  |  --include-partial-messages
                                                  |  --model sonnet
                                          [summary/cache.ts]  <-- lê/grava .aios-cache/
```

### 4.1 Transporte: streaming via WebSocket (decisão A2)
Reusa o WS que **já existe** em `ui/app.ts` (hoje só empurra snapshots). Adiciona mensagens:
- **Cliente → servidor:**
  - `{ type: "summary:fetch", specId, taskId }` — enviado ao **expandir** a task. Só **lê o cache**, nunca chama o CLI.
  - `{ type: "summary:generate", specId, taskId, force? }` — enviado **só pelo clique no botão**. Única mensagem que chama o CLI. `force: true` = "regerar" (ignora cache).
- **Servidor → cliente:**
  - `{ type: "summary:cached", specId, taskId, text, generatedAt, stale }` — resposta ao `fetch` quando há cache (não gasta quota); `stale` indica fingerprint divergente. Sem cache → servidor não responde nada e a UI fica no estado "vazio".
  - `{ type: "summary:chunk", specId, taskId, delta }` — pedaço de texto durante a geração.
  - `{ type: "summary:done", specId, taskId, text, generatedAt }` — fim; texto completo + timestamp.
  - `{ type: "summary:error", specId, taskId, message }` — falha (CLI ausente, exit≠0, timeout).

O cliente roteia por `specId+taskId` (pode haver mais de uma task aberta). Fluxo: expandir → `summary:fetch` → mostra cache (se houver) ou estado vazio; clicar no botão → `summary:generate` → chama o CLI e faz streaming. **Nada é gerado automaticamente** (ver §7).

### 4.2 `summary/service.ts` — roda o Claude CLI
- `spawn("claude", [args...])` com **array de argumentos** (nunca string de shell) — sem injeção.
- O conteúdo dinâmico (dados da task) vai pelo **prompt via `stdin`** com `--input-format text`, não interpolado em arg de shell.
- Flags: `--print --output-format=stream-json --include-partial-messages --model sonnet`.
- Parseia o stream-json linha a linha; extrai os deltas de texto do assistant e repassa como `summary:chunk`.
- **Timeout** (ex.: 60s) → mata o processo, emite `summary:error`.
- CLI ausente (`ENOENT`) → `summary:error` com mensagem clara.

### 4.3 `summary/cache.ts` — persistência no aiOS
- Diretório: `.aios-cache/summaries/<specId>/<taskId>.json` na raiz do aiOS. **Nunca** no framework.
- Conteúdo: `{ text, generatedAt, fingerprint }`.
- `.aios-cache/` entra no `.gitignore`.
- API: `read(specId, taskId)`, `write(specId, taskId, { text, fingerprint })`.

## 5. Prompt de ensino (instrução fixa + dados da task)

O prompt mandado ao CLI tem duas partes:

**Instrução fixa (tom):** "Você explica para um dev front-end (~3 anos) que estuda nestas explicações. Seja **técnico, mas didático**: diga o QUE foi feito, o PORQUÊ e o MECANISMO por baixo; defina todo termo fora do domínio front na primeira aparição com uma analogia curta; comece pelo concreto. Português claro e conectado, sem estilo telegráfico. 1–3 parágrafos curtos." (Espelha as regras de comunicação do `CLAUDE.md`.)

**Dados da task (montados do Store, sem ler disco novo):** `spec.title`, `task.id`, `task.state`, `task.loops`, e por dispatch: `role`, `loop`, `status`, `summary`, `filesChanged`, `findings` (severidade+texto), `testEvidence`. Tudo já disponível em memória — nenhuma leitura nova de artefato.

## 6. Freshness — fingerprint (gap de produto aceito)

A task ganha dispatches conforme o pipeline roda; um resumo cacheado pode envelhecer.
- **Fingerprint** = hash estável (ex.: SHA-1) de uma serialização determinística dos dispatches da task (role+loop+status+summary+arquivos+findings+testes).
- Gravado junto do resumo.
- Ao servir cache: recomputa o fingerprint da task atual; se diferente, `stale: true` → UI mostra "desatualizado — regerar". Sem isso, o cache mentiria.

## 7. Disparo manual — garantia de "nunca automático"

- Expandir a task **não gera** resumo. O `summary:generate` enviado no expand serve só pra **buscar cache** (servidor responde `summary:cached` ou silêncio → estado vazio). Para não ambiguar, o protocolo usa: expand → `{ type: "summary:fetch" }` (só lê cache, nunca chama CLI); clique no botão → `{ type: "summary:generate", force }` (única coisa que chama o CLI).
- Resultado: a quota Max 20x só é gasta por ação explícita do usuário.

## 8. Componentes / arquivos tocados

**Front (web/src):**
- `components/TaskItem.tsx` — reestrutura o expandido: bloco Resumo no topo + `Detalhes técnicos` recolhível agregando os blocos atuais como cards. Estado local do resumo (vazio/gerando/pronto/stale/erro).
- `state/` — hook ou helper para falar com o WS de resumo (reusa a conexão existente do `useLiveProjects`, ou um pequeno `useTaskSummary`).
- `app.css` — **criar** os estilos faltantes (`task-item`, `task-expanded`, `task-summary*`, `task-block` como card, `finding-*`, `test-*`, `task-loop*`) no tema claro atual; mono restrita a path/cmd/id.

**Back (src):**
- `ui/app.ts` — handlers das novas mensagens WS.
- `summary/service.ts` — spawn + parse do stream do CLI (novo).
- `summary/cache.ts` — leitura/escrita do `.aios-cache` (novo).
- `summary/fingerprint.ts` — hash determinístico da task (novo, ou junto do cache).
- `.gitignore` — adicionar `.aios-cache/`.

## 9. Erros & bordas

- CLI ausente / não autenticado → `summary:error` amigável; botão continua disponível.
- Geração em andamento + usuário fecha o drawer → processo segue; ao reabrir, cache pega o resultado (ou regenera se necessário).
- Dois cliques rápidos / regerar durante geração → servidor cancela o processo anterior daquele task antes de iniciar outro (1 geração por task por vez).
- Task sem dispatches → botão desabilitado com dica "sem dados para resumir".

## 10. Testes

- **Front:** `TaskItem` renderiza estados vazio/gerando/pronto/stale/erro; expandir não dispara geração; clique dispara; detalhes recolhidos por padrão.
- **Back:** `cache` read/write round-trip; `fingerprint` muda quando dispatch muda e é estável quando não muda; `service` parseia stream-json e emite chunks; trata ENOENT/timeout.
- Reusa Vitest + Testing Library já presentes no projeto.

## 11. Decisões e alternativas rejeitadas

- **A2 (streaming WS) sobre A1 (POST bloqueante):** infra de WS já existe (`ui/app.ts`), então o custo de A2 some e o ganho de UX (texto ao vivo) fica de graça. A1 seria mais simples só num mundo sem WS.
- **Persistir em disco** sobre memória/sempre-regerar: poupa quota Max 20x ao reabrir; fingerprint cobre o risco de cache velho.
- **Resumo no topo + dados embaixo** sobre substituir os dados: nada se perde para auditoria; leitura fácil vem primeiro.
- **Dados do Store, sem ler disco novo:** mantém a fronteira Coletor→Store→UI; o serviço de resumo não vira um segundo coletor.
