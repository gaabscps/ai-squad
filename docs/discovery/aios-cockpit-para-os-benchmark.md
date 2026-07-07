# Descoberta — do cockpit visual ao "OS de verdade"

> Sessão de descoberta: OBS-012 · ai-squad · 2026-07-06
> Objetivo: entender, via mapa do estado atual do aiOS **+** benchmark de produtos reais,
> o que falta para o aiOS deixar de ser um "cockpit visual" e virar um produto/OS/dashboard
> maduro — e escolher a primeira fatia de trabalho.

## TL;DR (a leitura que importa)

O aiOS é **excelente no drill-down** (o drawer por sessão é denso, honesto sobre custo, rico em
timeline/narrativa/diff) e **não tem zoom-out**. Você abre o app e cai direto numa pilha de cards;
não existe uma tela que resuma a **operação inteira** (custo da semana, quantas sessões precisaram
de você, tendência subindo/descendo) antes de você mergulhar numa sessão.

Essa é, exatamente, a diferença entre **cockpit** (um painel de instrumentos, um mostrador por
sessão) e **OS** (um lugar onde você mora, com visão de conjunto no topo e drill-down até o
instrumento que importa). Quase tudo que o benchmark aponta como faltante cai na mesma família:
**agregação e visão de conjunto**. O drill-down já está pronto.

**Decisão desta descoberta:** a primeira fatia é a **Home agregada / Overview** — a tela inicial
em camadas (KPIs grandes → drill-down no clique). É o único item que, sozinho, muda a percepção
"protótipo → produto", **reusa dados que o aiOS já grava** (não exige captura nova) e é
pré-requisito natural das fatias seguintes (tendências, time-range, distribuição de custo moram
dentro dela).

---

## 1. Estado atual do aiOS (mapa condensado)

Produto React (Vite) que observa sessões de trabalho com agentes de IA. Vive em `packages/os` do
monorepo. Fonte de dados = arquivos em `.agent-session/<OBS-NNN>/` (session.yml, trail.jsonl,
cost-report.json, diffs/, product-summary.json selado pelo /ship). Backend Express+WebSocket lê o
disco (read-only), mantém tudo em memória num Store e faz broadcast de snapshots; o front assina via
`useLiveProjects`. Watch de arquivo (chokidar) dispara rebuild ao mudar o disco.

**Superfícies existentes:**

| Superfície | O que é hoje |
|---|---|
| **Board Kanban** | 3 colunas por atenção: *Precisa de você / Em andamento / Pronto*. Um card por sessão observada, com custo (USD ou tokens), duração, fase, barra de custo por fase, motivo de atenção. |
| **DetailDrawer** | Painel lateral (~1024px). Dossiê da sessão: header + story de 1 linha, motivo de atenção, diagnóstico IA (AttentionPanel), bloco de custo/datas/duração, **timeline** (ObservedTimeline curada dos markers), **narrativa** (dev: "o que mudou/decisões/verificações/PR review"; produto: "decidido/em aberto/próximo/entregável"), delivery-report SDD. |
| **Vista Tabela** | SpecTable ordenável (ID/título/projeto/status/fase/custo/última atividade). |
| **Vista Arquivadas** | Mesmo layout, só sessões arquivadas/dormentes. |
| **TopBar** | Marca, pílula de conexão ao-vivo, busca (id/título/projeto), toggle Kanban/Tabela/Arquivadas, botão Pastas. |
| **ExportPage (`?export=1`)** | Página cheia imprimível: facts + timeline + narrativa/produto + **CopyJiraPanel** (Markdown pronto pro Jira). |
| **Modo produto vs dev** | Ramifica por `work_type`. Produto: ProductSummary + timeline re-rotulada em linguagem de produto (Aberta/Pergunta/Decisão/Fechada), sem edit/verify/run. |

**Maturidade (do próprio mapa técnico):** funcionalidade core 9/10, robustez 8/10, polimento UX
7/10. Gaps conhecidos: board de 5 colunas planejado mas não feito; dormência sem marca visual;
diagnóstico de atenção é on-demand (n cliques pra n sessões, sem cache no servidor); narrativa com
prompt PT-only (ignora output_locale); FolderManager tedioso; ExportPage sem CSS de print
dedicado. Nada quebrado — é um **protótipo polido em fase 1**.

---

## 2. Benchmark — padrões de produtos reais

Fontes principais: Langfuse, LangSmith, Braintrust, Linear, Vercel Observability, Sentry, Datadog,
Grafana. Padrões agrupados por categoria; os mais acionáveis viram o Top 10 na seção 3.

### A) Observabilidade de LLM/agentes
- **Trace como árvore com custo/tempo por nó** — cada passo do agente (modelo → tool → tool) carrega
  seu próprio custo e latência. Converte "gastei $26" em "o reviewer paralelo gastou $9". (Langfuse,
  LangSmith)
- **Insights: clustering automático** de traces em padrões e modos de falha, em vez de caçar um a um.
  (LangSmith)
- **Métricas como percentis (P50/P99), não médias** — a média esconde a cauda cara que assusta.
  (LangSmith)
- **Filtro de 1ª classe** por user/session/custo/latência/metadata + tags. (Langfuse)
- **Sessão como agrupador** de turns multi-passo, com rollup de métricas no nível da sessão. (Langfuse)
- **Comparação lado-a-lado** com marcação melhorou/regrediu/igual + "Summary layout" de tipo grande.
  (Braintrust)

### B) Dashboards de dev/produto polidos
- **Command-K global** como navegação primária. (Linear/Vercel/GitHub)
- **Display options** — grouping/ordering/densidade desacoplados do filtro. (Linear)
- **Views = filtros salvos, nomeados, compartilháveis**, que persistem sozinhos. (Linear)
- **Toggle lista ↔ board** sobre os mesmos dados. (Linear)
- **Board de triagem com fila "For Review"** (novo/não-visto separado do já-triado) + estados de
  ciclo de vida. (Sentry)
- **Time-range selector** com click-drag pra zoom. (Vercel)
- **Deep-link "pular para"** entre superfícies do mesmo objeto. (Vercel)

### C) Conceito "cockpit → OS"
- **Dashboard em camadas** — 4 KPIs North-Star grandes no topo → banda diagnóstica → drill-down no
  clique. **O esqueleto que falta ao aiOS.** (Datadog / fleet ops)
- **Single pane of glass** — agregar por qualquer dimensão, drill-down até o item. (Datadog)
- **Alertas só em falha sustentada/ampla** com anomaly detection. (fleet ops)
- **Tendências e histórico** com retenção diária/semanal. (fleet ops)
- **Empty state que ensina** (onboarding do primeiro passo).
- **Compartilhamento** — link externo com filtro na URL + anotações. (Grafana/Datadog)

**Fontes:** langfuse.com/docs/observability/overview · langchain.com/langsmith/observability ·
braintrust.dev/foundations/comparing-experiments · linear.app/docs/display-options ·
vercel.com/docs/observability · blog.sentry.io/sentry-workflow-triage ·
datadoghq.com/solutions/edge-monitoring · grafana.com (share-dashboards-panels).

---

## 3. Cruzamento — benchmark × aiOS hoje

| Padrão (referência) | aiOS hoje | Veredito |
|---|---|---|
| **Home agregada em camadas** (Datadog) | Abre direto no board; **nenhuma** visão agregada | ❌ Falta inteiro |
| Tendências no tempo (fleet ops) | Só métrica por sessão | ❌ Falta inteiro |
| Time-range global hoje/7d/30d (Vercel) | Sem seletor de janela | ❌ Falta inteiro |
| Views = filtros salvos e nomeados (Linear) | Só filtro de projeto + busca | ❌ Falta inteiro |
| Command-K (Linear/Vercel) | Só busca na topbar | ❌ Falta inteiro |
| Custo como distribuição P50/P95/P99 (LangSmith) | Só custo absoluto por sessão | ❌ Falta inteiro |
| Comparar sessões lado a lado (Braintrust) | Diff **de código**, não sessão-vs-sessão | 🟡 Parcial |
| Timeline como árvore com custo por nó (Langfuse) | Timeline cronológica + custo por fase, sem custo por subagente/tool | 🟡 Parcial |
| Fila "For Review" + estados de ciclo (Sentry) | Board por atenção, sem "novo desde ontem" | 🟡 Parcial |
| Link compartilhável + anotação (Grafana) | Export full-page + Jira, sem URL-com-filtro nem nota | 🟡 Parcial |
| Vista lista/tabela densa ordenável (Linear) | **Já existe** (SpecTable) | ✅ Já tem |

**Padrão da coluna do veredito:** tudo que **falta inteiro** é a mesma família — agregação e visão
de conjunto. Confirma o TL;DR: o aiOS tem o drill-down, falta o zoom-out.

---

## 4. Decisão — primeira fatia e por quê

"Virar um OS" é um **programa**, não uma feature (são 6-7 lacunas independentes na tabela). Por isso
decompomos e brainstormamos **uma fatia por vez** até virar spec, entregar, e seguir pra próxima.

**Primeira fatia escolhida: Home agregada / Overview.** Critérios:

1. **Maior impacto pelo esforço** — é *o* movimento cockpit→OS e reusa dados já capturados (custo,
   datas, atenção, contagem); não depende de instrumentar custo por-passo, que é caro.
2. **Destrava o resto** — tendências, time-range e distribuição P95 moram *dentro* de uma home
   agregada; sem ela não têm onde viver. É o pré-requisito natural.
3. **Trade-off honesto** — ela **não** melhora o drill-down (o drawer segue igual) nem resolve
   navegação (Command-K fica pra depois). Se a dor maior fosse "me perco navegando", a fatia certa
   seria outra (Command-K + views salvas). O dono confirmou que a Overview é a primeira fatia.

## 5. Roadmap sugerido das fatias seguintes (não comprometido)

Ordem por impacto/esforço, cada uma seu próprio ciclo spec→plano→entrega:

1. **Home/Overview agregada** ← em andamento (esta descoberta).
2. **Time-range global + tendências** — série temporal de custo/tempo/%-intervenção; mora na home.
3. **Views salvas e nomeadas** — filtros persistentes na sidebar; baixo esforço, alta retenção.
4. **Command-K** — navegação por teclado; sinal forte de maturidade.
5. **Fila "For Review" + estados de ciclo de vida** — resolve "o que é novo desde ontem?".
6. **Timeline como árvore com custo por nó** — núcleo de observabilidade; exige captura por-passo (caro).
7. **Comparar sessões lado a lado** — eixo comparativo entre sessões (não só diff de código).
8. **Link compartilhável com filtro + anotação humana** — fecha o loop colaborativo do export/Jira.

**Fora do Top por ora (fase 2, alto valor/alto esforço):** clustering automático de sessões
(Insights do LangSmith) e alertas com anomaly detection — exigem heurística/ML madura sobre um
volume de sessões que o aiOS talvez ainda não tenha.
