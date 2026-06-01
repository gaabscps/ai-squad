# ai-squad-os — Redesign de UX (cockpit utilizável)

**Data:** 2026-06-01
**Status:** design aprovado em brainstorm; aguardando review do usuário antes do plano de implementação.
**Origem:** MVP funcional, mas a UI é "dados cuspidos" (lista plana de cards com tema dark mínimo). Objetivo: tornar realmente utilizável com UI/UX moderna, sem "cara de feito por AI".

---

## 1. Objetivo e princípios

Transformar o board atual (lista plana de cards por projeto) num cockpit que sirva **três gestos** que o usuário faz no dia a dia:

1. **Relance** — olhar de longe e ver o que exige atenção, o que roda e o que terminou, sem clicar.
2. **Investigação** — abrir uma spec e entender fase, tarefas, custo e histórico em profundidade.
3. **Comparação** — comparar custo/progresso entre specs e projetos.

Restrições herdadas do projeto (não negociáveis):
- **Só leitura.** O aiOS observa artefatos do ai-squad; nunca escreve neles. Nenhum botão de ação que mute o framework.
- **Custo nunca é calculado** — só somado do que já existe em `costs/*.json` e encaminhado ao `report.html`.
- Single-user, local. Volume típico: **5–10 projetos, 10–40 specs**.

---

## 2. Decisões de design (com razão e alternativa rejeitada)

| Decisão | Razão | Alternativa rejeitada |
|---|---|---|
| **Kanban por status** como visão primária (3 colunas) | Usuário escolheu explicitamente; faz "o que travou/escalou" virar a 1ª coluna, sempre visível | Board por projeto (rec. inicial): mantinha o agrupamento mas não destacava atenção tão bem |
| Colunas: **Precisa de você · Em andamento · Pronto** | Bate exatamente com os 3 sinais de relance que o usuário marcou; agrupa por **ação**, não por jargão de status | 5 colunas (1/status): "escalado" é raro → coluna quase sempre vazia. 2 colunas: junta travado+rodando, mata o destaque do urgente |
| **Botão "Tabela"** como 2ª visão | Recupera o gesto de **comparação** (kanban não soma bem custo); densa e ordenável | Faixa de totais no topo: comparação só de alto nível. Custo só no card: comparar exige olhar card a card |
| **Direção visual clara** (light) | Preferência explícita do usuário; ele acha dark quase-preto "alto contraste, não dark mode" | Devtool dark (rec. inicial) e Editorial dark: rejeitados por conforto visual do usuário. **Dark fica fora de escopo** (ver §7) |
| **Painel de detalhe lateral** (drawer da direita) | Investigar sem perder o board de vista | Página/rota separada: cortaria o contexto do board |
| **Custo agregado no nível da spec**, não destaque no topo | Usuário **não** marcou custo como sinal de relance | Faixa de KPI de custo no topo: competiria com o que urge |
| **Faseamento em 2 etapas** | Cada parte testável sozinha; redesign no ar mais rápido | Tudo junto: atrasa ver o redesign funcionando |

---

## 3. Arquitetura visual (layout)

```
┌─────────────────────────────────────────────────────────────┐
│  ai-squad-os   ● ao vivo   [⌕ buscar…]        [Kanban|Tabela] │  ← barra superior
├─────────────────────────────────────────────────────────────┤
│  (todos) site-vendas  app-mobile  api-core  painel-admin      │  ← filtro por projeto (chips)
├──────────────────┬──────────────────┬───────────────────────┤
│ ● Precisa de você│ ● Em andamento   │ ● Pronto              │  ← 3 colunas do kanban
│   3              │   3              │   2                   │
│ ┌──────────────┐ │ ┌──────────────┐ │ ┌──────────────┐      │
│ │ card (porquê)│ │ │ card (fase + │ │ │ card         │      │
│ │              │ │ │  progresso)  │ │ │              │      │
│ └──────────────┘ │ └──────────────┘ │ └──────────────┘      │
└──────────────────┴──────────────────┴───────────────────────┘
        clicar num card → painel de detalhe desliza da direita
```

**Mapeamento status → coluna** (status já é derivado hoje em `deriveStatus`):

| Coluna | Inclui (status/flag) |
|---|---|
| Precisa de você | `blocked`, `escalated`, `paused`, ou `auditException === true` |
| Em andamento | `running` |
| Pronto | `done` |

> Decisão: `auditException` pode coexistir com qualquer status, mas, como exige olho humano, o card vai pra "Precisa de você" e mostra o motivo ⚠ auditoria. Razão: relance prioriza ação; um item em auditoria pendente não pode se esconder na coluna "Em andamento".

---

## 4. Direção visual (tokens "clean light")

Antídoto à "cara de AI": paleta contida + **um** acento, escala tipográfica intencional, hierarquia clara (status é o que grita), monoespaçada para ID/números.

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#f6f7f9` | fundo da app |
| `--surface` | `#ffffff` | cards, drawer, barra |
| `--border` | `#e7e9ee` | bordas suaves |
| `--text` | `#111827` | texto primário |
| `--text-dim` | `#6b7280` / `#9ca3af` | secundário / terciário |
| `--accent` | `#2563eb` | acento único (azul) |
| status `running` | `#2563eb` | borda esq. + ponto |
| status `blocked` | `#ef4444` | |
| status `escalated` | `#a855f7` | |
| status `paused`/`audit` | `#f59e0b` | |
| status `done` | `#22c55e` | |
| squad SDD / Discovery | `#2563eb` / `#0d9488` | tag do card |
| fonte UI | system-ui sans | texto |
| fonte mono | ui-monospace | ID, tokens, $, refs `arquivo:linha` |

Detalhes de capricho: borda esquerda colorida = status; sombra suave (`0 1px 2px`) nos cards, elevando no hover; cantos `10–12px`; espaçamento generoso.

---

## 5. Anatomia dos componentes

### 5.1 Barra superior
Marca + pílula de conexão (`● ao vivo` / `reconectando…`, já existe no estado WS) + busca (filtra por id/título/projeto — útil em 10–40 specs) + toggle **Kanban | Tabela**.

### 5.2 Filtro por projeto
Chips (reaproveita o filtro atual). Mantém "mostrar ocultos" e o ocultar/mostrar por projeto (comportamento e WS `hide/unhide` atuais preservados).

### 5.3 Card do kanban
- Linha 1: `id` (mono, dim) + tag do projeto/squad.
- Título da spec.
- **Se "Precisa de você":** faixa colorida com **o porquê** — ⛔ conflito de reviewers / ↑ decisão humana / ⚠ exceção de auditoria.
- **Se "Em andamento":** fase atual (label) + barra de progresso segmentada (deriva de `plannedPhases` × `phase`, como o `PhaseBar` atual).
- Rodapé: custo (`tokens · US$`, mono, dim) + última atividade relativa (`lastActivityAt`).
- Borda esquerda = cor do status. Hover eleva.

### 5.4 Painel de detalhe (drawer)
Desliza da direita sobre o board esmaecido. Conteúdo (tudo leitura):
1. Header: id, projeto·squad, status, ✕.
2. Título grande.
3. **Por que** (quando aplicável): bloco colorido com o motivo do bloqueio/escalada/auditoria.
4. **Fases**: todas as `plannedPhases`, feita/atual.
5. **Tarefas**: lista; cada uma colapsável (ver §6 — fase 2 enriquece).
6. **Custo**: total `US$` + tokens + breakdown por tipo de token (input/output/cacheRead/cacheCreation — campos já em `CostRollup`) + link `report.html`.
7. **Linha do tempo**: `notes[]` (timestamp/kind/note).
8. **Docs**: links `spec.md/plan.md/tasks.md` (SDD) ou `memo.md` (Discovery), via rota `/file`.

### 5.5 Tabela (2ª visão)
Uma linha por spec; colunas ordenáveis: projeto, id, título, status, fase, custo (US$/tokens), última atividade. Clicar abre o mesmo drawer. Cobre o gesto de comparação.

---

## 6. Fase 2 — tarefa expandível rica (coletor novo)

Hoje o aiOS lê só `session.yml` + `costs/`. A fase 2 adiciona um **coletor** que lê `outputs/*.json` + `dispatch-manifest.json`.

**Ponte de dados** (verificada em sessões reais): `dispatch-manifest.json → actual_dispatches[]` amarra `dispatch_id → task_id → output_packet_ref`. A partir de uma tarefa (T-001), acham-se todos os seus pacotes (`dev`, `code-reviewer`, `logic-reviewer`, `qa`, por loop).

**Tarefa colapsada:** uma linha (status + `↻ loops` + tokens). **Expandida:**
- **O que foi feito** — `dev.summary`.
- **Arquivos mudados** — `dev.files_changed[]` (+ refs `:linha` quando houver).
- **Findings de review** — `reviewer.findings[]` (severidade, arquivo:linha, sugestão). **Mostrar TODOS** (não amostra).
- **Testes** — `dev.test_evidence[]` (comando + resultado).
- **Histórico de loops** — dev → review → qa por loop.
- **Tokens por tarefa** — 🟡 `manifest.actual_dispatches[].usage.total_tokens` somado por `task_id`; **best-effort** (às vezes `null`).

**Acréscimos ao data model** (`store/types.ts`): `Task` ganha `dispatches[]` com `{role, loop, status, summary, filesChanged[], findings[], testEvidence[], tokens}`.

**Limites honestos (não viáveis hoje):**
- **US$ por tarefa** — ❌ `costs/agent-<hash>.json` não amarra com `task_id` (nome é hash, `scope` é por fase). $ fica no nível da spec.
- **Diff colorido (linhas +/−)** — ❌ artefatos têm lista de arquivos e refs `arquivo:linha`, não os hunks. O aiOS lê `.agent-session`, não o git do projeto.
- **Decisão por finding** (atacado/aceito/recusado) — ❌ hoje. Não há `id` consistente nos findings (formato antigo) nem referência do dev de volta aos `F-xxx` (formato novo). Gap registrado em **[ai-squad#43](https://github.com/gaabscps/ai-squad/issues/43)**. Até lá, exibir findings e o "o que foi feito" em **blocos separados**, sem check "resolvido" por finding (evita palpite). "Acende" quando o schema do framework ganhar `findings_resolved`.

---

## 7. Fora de escopo (YAGNI)

- **Dark mode** — preferência do usuário é light; se um dia voltar, nunca preto puro (cinzas dessaturados de baixo contraste).
- Drag-and-drop no kanban (é read-only; arrastar não faz sentido).
- US$ por tarefa e diff colorido (§6 — dados não existem).
- Qualquer escrita no ai-squad.

---

## 8. Faseamento / entrega

**Fase 1 — Redesign visual (agora).** Tokens light + barra + filtros + kanban (3 colunas) + tabela + drawer de detalhe, usando os dados atuais (`session.yml` + `costs/`). Reestrutura os componentes React existentes (`Board`, `SpecCard`, `PhaseBar`, `CostTag`, `StatusBadge`, `Timeline`) e o `app.css`. Backend praticamente intocado.

**Fase 2 — Tarefa expandível rica.** Coletor de `outputs/` + `dispatch-manifest.json`; `Task.dispatches[]` no store; tarefa colapsável no drawer. Independente da Fase 1.

**Fase 3 (contingente) — Decisão por finding.** Só quando [ai-squad#43](https://github.com/gaabscps/ai-squad/issues/43) entregar o campo de resolução.
