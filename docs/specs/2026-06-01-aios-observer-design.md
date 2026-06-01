# ai-squad-os — Design: Observador (Fase 1)

> **Status:** design aprovado (brainstorming 2026-06-01).
> **Escopo:** MVP read-only. Cockpit local que observa pipelines do ai-squad.
> **Próximo passo:** plano de implementação (writing-plans).

---

## 1. Motivação e enquadramento

O [ai-squad](https://github.com/gaabscps/ai-squad) é um **framework distribuível e agnóstico**: instala skills/agents no `~/.claude/` global e hooks por-repo, e roda pipelines SDD/Discovery dentro do Claude Code. Cada pipeline deixa um rastro em disco — `.agent-session/<spec_id>/session.yml`, `dispatch-manifest.json`, e transcripts de custo em `~/.claude/projects/<hash>/session-*.jsonl`.

Hoje esse rastro está **espalhado e invisível**: não há uma visão única de "o que está rodando, em que fase, quanto custou", através de todos os projetos.

O **ai-squad-os** preenche esse buraco como uma **camada separada e consumidora**: lê os artefatos que o framework já produz e os projeta num board visual ao vivo. Não inventa dados; agrega o que existe.

### Por que um repo separado (e não dentro do ai-squad)

O ai-squad é **projeto-agnóstico por princípio**: nenhum arquivo dele pode citar projetos específicos do usuário. Um cockpit que lista "projeto X FEAT-020, projeto Y FEAT-006" é, por definição, específico dos projetos do usuário — o oposto de agnóstico. Morar dentro do ai-squad contaminaria o framework e quebraria a instalação limpa em outro repo.

**Alternativa rejeitada:** monorepo (framework + cockpit em packages separados). Descartada porque arrasta o cockpit pra dentro do pacote agnóstico; o ganho (um repo só) não paga o custo (princípio quebrado).

### Decisões de escopo travadas (brainstorming)

| Decisão | Escolha | Alternativa rejeitada / porquê |
|---|---|---|
| Natureza | Camada separada que lê o framework | "Repo vira o centro de tudo" — quebraria o agnóstico |
| Usuário/deploy | Single-user, local | Serviço de equipe/nuvem — infra cara, prematura |
| Função | Observar (read-only) **agora** | Controlar agentes (Fase 3) — bloqueado por plataforma (ver §7) |
| Forma | Web app local (navegador) | TUI (menos visual) / desktop (peso sem ganho) |
| Descoberta | Híbrida (auto-scan + add/hide) | Só manual (atrito) / só auto (sem controle) |
| Stack | Node+TS / Express + Vite/React | Python backend — UI puxa pra JS; CLI já é Node |

---

## 2. Arquitetura

Três unidades com fronteiras explícitas — cada uma entende-se isoladamente:

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Coletor    │───▶│    Store     │───▶│     UI      │
│ lê disco +  │    │ estado em    │    │ Express +   │
│ file-watch  │◀───│ memória      │◀───│ WebSocket   │
│ (só leitura)│    │ (normalizado)│    │ + React     │
└─────────────┘    └──────────────┘    └─────────────┘
```

- **Coletor** — descobre projetos (auto-scan híbrido), lê `session.yml` + manifests + `.jsonl` de custo, observa mudanças no disco (`chokidar`). **Nunca escreve nos repos do usuário.** Não conhece HTTP nem React.
- **Store** — mantém o estado normalizado em memória (Project → Spec → Task → Custo). É o contrato entre Coletor e UI; não sabe de onde o dado veio nem como é exibido.
- **UI** — servidor Express local serve a página e empurra atualizações por WebSocket; front em Vite + React. Consome o Store; não lê disco direto.

A separação permite que as **Fases 2 e 3** entrem como uma 4ª peça (um *Executor*) ao lado do Coletor, consumindo o mesmo Store, sem reescrever as três.

**Stack:** Node + TypeScript / Express (backend), Vite + React (front), `chokidar` (file-watching), `ws` ou `socket.io` (WebSocket). Mesma linguagem nos dois lados reduz atrito; o CLI do ai-squad já é Node.

---

## 3. Modelo de dados (Store)

Árvore de três níveis; cada campo deriva de um arquivo real do ai-squad.

```typescript
type Project = {            // um repo no disco
  id: string;               // slug do path
  path: string;
  name: string;
  specs: Spec[];
  hidden: boolean;          // o "ocultar avulso" da descoberta
};

type Spec = {               // uma Session (.agent-session/<id>/session.yml)
  id: string;               // FEAT-006 / DISC-001   ← task_id
  squad: "sdd" | "discovery";                       // ← squad
  title: string;                                     // ← feature_name
  phase: string;                                     // ← current_phase
  plannedPhases: string[];                           // ← planned_phases
  status: "running" | "paused" | "blocked" | "done" | "escalated"; // DERIVADO
  tasks: Task[];                                     // ← task_states
  health: { pendingHuman: number; escalationRate: number; auditException: boolean };
  lastActivityAt: string;                            // ← last_activity_at
  timeline: TimelineEntry[];                         // ← notes[]
  cost: CostRollup;                                  // ← soma de costs/agent-*.json + link pro report
};

type Task = {               // task_states.T-XXX
  id: string;
  state: "pending" | "running" | "done" | "blocked";
  loops: number;            // loops>1 = reviewer rejeitou (retrabalho)
};
```

**Decisões:**

1. **`status` é derivado, não lido cru.** Combina `current_phase` + `audit_exception` + flags numa única cor. A regra de "o que é uma Session em apuros" mora num lugar só (o Store), não espalhada na UI.
2. **SDD e Discovery no mesmo `Spec`, com `squad` como discriminador.** A forma do card é igual; só os rótulos das fases mudam. Alternativa rejeitada: dois tipos separados — dobraria a UI sem ganho.
3. **`cost` é rollup pré-calculado.** Cruzar manifest × jsonl é caro; calcular a cada render mataria a fluidez. Soma uma vez no Coletor.

**Fora do Store (YAGNI):** conteúdo de `spec.md`/`plan.md`/`tasks.md` (o card só linka). Busca full-text entra depois, se necessário.

---

## 4. Tempo real

O servidor observa os arquivos; quando mudam, reprocessa e empurra pra UI.

```
agente termina T-008 → orchestrator reescreve session.yml
  → [chokidar] SO avisa "arquivo mudou"
  → debounce 200ms (espera a rajada de escritas terminar)
  → Coletor relê → atualiza Store
  → [WebSocket] servidor empurra → card muda de cor no navegador
```

- **File watcher** (`chokidar`): o SO avisa quando o arquivo muda, em vez de polling (reler em loop). Instantâneo e só trabalha quando há mudança.
- **Debounce 200ms:** uma gravação do orchestrator pode ser uma rajada; só reage depois de 200ms sem nova mudança, evitando reprocessar N vezes.
- **WebSocket:** cano de mão dupla sempre aberto; o servidor empurra a atualização sem o navegador perguntar (HTTP normal não serve, é pergunta-resposta).

**Decisão:** o watcher observa só `session.yml` + manifests, **não** os `.md`. Esses mudam durante a escrita interativa e não afetam o board (status/custo). Observá-los seria reprocessar à toa.

---

## 5. Custo (tokens já agregados das fontes da feature)

O aiOS **não calcula custo em $**. A conversão `pricing × tokens` é trabalho do **report do ai-squad** — a fonte da verdade de custo, renderizada em `.agent-session/<spec>/report.html`. O aiOS apenas **soma as fontes de custo que cada feature já carrega**, mostra um indicador resumido (em tokens), e **encaminha pro report** pra revisão humana detalhada. O report é complementar, nunca substituído.

### Fontes já existentes (gravadas pelos hooks do ai-squad)

- `.agent-session/<spec>/costs/agent-<id>.json` — um arquivo de custo **por subagente** (tokens por tipo: `input`, `output`, `cache_read`, `cache_creation`).
- `.agent-session/<spec>/report.html` — o report renderizado (custo + code review + git diff), gerado no hook de fim de sessão. É o destino do "encaminhar pra revisão humana".
- `cost_report.py` (stdlib puro) — já contém a lógica de **somar** os `costs/agent-*.json` e o formatador `fmt_tokens` (1.4M / 775K).

### O que o aiOS faz

```
1. ler todos os costs/agent-*.json da feature
2. somar tokens por tipo (input / output / cache_read / cache_creation)
3. exibir no card: total de tokens (formato compacto) + link → report.html
```

```typescript
type CostRollup = {
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  totalTokens: number;        // soma — NUNCA convertido em $ pelo aiOS
  reportPath: string | null;  // .agent-session/<spec>/report.html, se existir
};
```

- **JSONL** (JSON Lines): um JSON por linha, log append-only — formato dos transcripts de custo.
- **Token:** unidade de cobrança da LLM (~4 chars). O aiOS mostra a **contagem**, não o preço.

**Decisões:**

1. **Não recalcular $ — encaminhar pro report.** O report já faz `pricing × tokens` e é a fonte da verdade. Se o aiOS recalculasse, criaria um segundo número que poderia divergir — confusão garantida. O board mostra tokens (métrica crua, sempre consistente com a fonte) e linka pro `report.html` pro $ detalhado. *Alternativa rejeitada: o aiOS exibir seu próprio $ — descartada porque duplica responsabilidade e arrisca divergência; o report é complementar, não substituído.*
2. **Reusar a soma, não reimplementá-la.** A agregação dos `costs/agent-*.json` já existe em `cost_report.py`. O aiOS porta/reusa essa soma, garantindo que o número do board é **exatamente** o número do report. *Mesmo princípio do GAP A: fonte de custo única.*
3. **Formato compacto, igual ao report.** Reusa `fmt_tokens` (1.4M / 775K / 500) pra o card falar a mesma língua do report.

**Fora (YAGNI):** qualquer cálculo de $, tabela de pricing, alertas de orçamento, gráfico histórico. Tudo isso ou é do report, ou é camada posterior.

---

## 6. Recorte do MVP

Critério de corte: o MVP responde **"o que está rodando, em que fase, e quanto custou — em todos os projetos, ao vivo"**. Nada além.

| Entra ✅ | Fica pra depois ⏳ |
|---|---|
| Coletor: auto-scan híbrido + watcher | App desktop (Tauri/Electron) |
| Board: cards por spec, agrupados/filtráveis por projeto (tags) | Busca full-text nas specs |
| Barra de fases (`plannedPhases` vs `phase`) | Gráfico histórico de custo |
| Status colorido + flags (`blocked`/`paused`/`audit_exception`) | Alertas de orçamento |
| Tokens agregados por spec/projeto + link pro report | Fase 2 (montar comandos) e Fase 3 (controle) |
| Timeline (`notes[]`) + link pros `.md` | Multi-usuário / nuvem |
| SDD **e** Discovery (squad discriminador) | — |

**Invariante de risco:** o MVP é **100% read-only** — nunca escreve nos `.agent-session/`. No pior caso, um bug mostra um número errado na tela; jamais corrompe o estado de um pipeline. Custo: não controla nada pela UI ainda. Benefício: roda com zero medo desde o dia 1.

---

## 7. Roadmap em fases (e o bloqueio de plataforma)

| Fase | O que faz | Viável hoje (2026-06)? |
|---|---|---|
| **1 — Observador** | Board + status real-time + custo/$ agregado, read-only | **Sim, risco ~zero** |
| **2 — Ações leves** | Botões que *montam* comandos (`/orchestrator --resume`) pra colar no terminal | Sim, risco baixo |
| **3 — Cockpit (controla)** | Supervisor dispara/aprova/intervém sozinho | **Bloqueado por plataforma** |

**Por que a Fase 3 está bloqueada** (pesquisa 2026-06-01, confirma e estende `ai-squad/docs/v2/supervisor-research.md`):

- **Agent Teams** (feature do Claude Code para multi-nível) continua **experimental**; nested teams ainda proibido (profundidade máx. = 1).
- **Managed Agents API** (REST, beta) roda multi-sessão, mas **não enxerga as skills/agents instaladas no `~/.claude/`** — usá-la exigiria reescrever o framework inteiro dentro da API.
- **Dirigir o Claude Code CLI por fora** (`spawn` + parse) preserva as skills, mas **não é suportado nem estável**.

Conclusão: o controle autônomo real só fica limpo quando Agent Teams sair de experimental **ou** a Managed Agents API ganhar acesso a skills locais. Até lá, Fase 1 (e eventualmente 2) entrega valor sem retrabalho — a arquitetura de 3 peças garante que a Fase 3 encaixa como um Executor novo, sem reescrever o que já existe.

---

## Fontes (pesquisa de viabilidade, 2026-06-01)

- [Claude Agent SDK — Managed Agents Sessions API](https://platform.claude.com/docs/en/managed-agents/sessions.md)
- [Claude Code — Agent Teams (experimental)](https://code.claude.com/docs/en/agent-teams)
- [Claude Code — Cost Management](https://code.claude.com/docs/en/costs)
- [Claude Code — Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code — How sessions work](https://code.claude.com/docs/en/how-claude-code-works.md)
- `ai-squad/docs/v2/supervisor-research.md` (research V2, 2026-05-03)
