# Núcleo Implementador — redesenho do Phase 4 (SDD)

- **Data:** 2026-06-08
- **Status:** design aprovado (pendente plano de implementação)
- **Escopo:** substituir o pipeline multi-agente de implementação (Phase 4 / `orchestrator`) por um núcleo enxuto de agente único com humano no loop, preservando a observabilidade.
- **Fundamentação:** deep research adversária de 2026-06-08 (98 agentes, 16 fontes, 25 claims verificados com voto 2/3) — síntese na seção "Diagnóstico" abaixo.

> Convenção: prosa em português (locale do usuário); tokens de máquina (enums, identificadores, nomes de arquivo/role) em inglês canônico, conforme a invariante do projeto.

---

## 1. Diagnóstico (a causa-raiz)

Os sintomas relatados pelo usuário em produção — **(1)** reescreve código que já existe (handlers, utils); **(2)** trata utils/componentes globais como locais; **(3)** over-abstração apesar de regra de projeto que a proíbe; **(4)** código difícil de ler; **(5)** não segue o spec fielmente ("sempre uma deslizada"); **(6)** lento (2-4h); **(7)** caro (~40M tokens por sessão) — **não são sete problemas independentes. São um problema com sete caras.**

**Causa-raiz:** o **Work Packet** escopado cega o `dev`. Ao despachar, o orchestrator entrega `scope_files` (trava de *escrita*) e `ac_scope` (fatia comprimida do spec), e os passos do `dev` mandam ler **só** as seções do spec referenciadas em `ac_scope` e **só** os `scope_files`. Os ponteiros para o spec inteiro, o plano e o `CLAUDE.md` (`standards_ref`) até são passados — mas **nenhum passo instrui o dev a varrer o codebase atrás de reúso, nem a ler e aplicar as regras do projeto**. O insumo existe; falta a instrução de consumi-lo.

- Sintomas (1)(2): o `dev` trata a trava de escrita como mundo de leitura; nunca vê o util global; escrever cópia local é o caminho de menor resistência.
- Sintoma (3): abstração é o que se inventa quando não se enxerga os call sites concretos (que o pacote esconde) + a regra anti-abstração nunca é lida.
- Sintoma (5): recebe fatia comprimida do spec → preenche ambiguidade errado → reviewers (igualmente famintos) carimbam.
- Sintomas (6)(7): imposto de orquestração — 4-5 roles × N tasks × loops × re-derivação de contexto do zero. 40M é a soma das re-derivações.

**Achado-chave:** a disciplina de TDD do `dev` é forte, mas **ortogonal às dores principais**. Um teste prova "o código atende o comportamento do AC"; não prova reúso, legibilidade ou nível de abstração. O conserto não é mais teste — é **consciência do codebase + consumo ativo das regras + uma lente de revisão de reúso/legibilidade**.

### Validação por pesquisa (resumo)
- Anthropic ("Building Effective Agents"): complexidade multi-agente só "quando soluções simples falham" e "quando demonstravelmente melhora resultados".
- Anthropic (multi-agent research system): nomeia **coding** como mau encaixe — "most coding tasks involve fewer truly parallelizable tasks than research"; e exclui "domains that require all agents to share the same context or involve many dependencies".
- Tran & Kiela (arXiv 2604.02460): sob orçamento de tokens igualado, agente único iguala/supera 5 arquiteturas multi-agente em raciocínio multi-hop.
- Chroma "Context Rot": contexto longo **não** é grátis — degrada mesmo em Opus 4. → o alvo é contexto **curado**, não janela cheia.
- Fronteira onde multi-agente ganha: trabalho **breadth-first genuinamente paralelo** (descoberta ampla, riscos independentes). **Não** trabalho coerente picado.

---

## 2. Decisão

**Approach A — agente único + um revisor de olhos frescos**, com:
- **Humano no loop apertado** (decisão do usuário): 2 checkpoints fixos + escalações sob demanda, em vez de autônomo até o handoff.
- **Features pequenas/médias** (~3-12 arquivos): o usuário já decompõe o que é grande em várias FEATs antes; cada sessão de SDD lida com uma feature coerente que cabe num contexto curado.
- **Preservar a observabilidade** (o diferencial) e o front-end interativo de spec/plan/tasks.

A virada de fundo: **o Phase 4 deixa de ser um despachante de subagentes e vira uma skill interativa — par dos Phases 1-3.** Os quatro Phases passam a ser skills com o humano no loop. Isso unifica a arquitetura.

**Alternativas rejeitadas:**
- **B (single-agent solo, sem revisor):** o autor é o pior juiz da própria abstração; perde-se a rede de olhos frescos justamente nas dores do usuário.
- **C (manter o pipeline, só consertar a alimentação):** conserta correção mas deixa custo/lentidão intactos (continua 4-5 dispatches × N × loops) e mantém o handoff sequencial que a pesquisa nomeia como formato errado. Serve só como ponte de baixo risco, não como destino.

---

## 3. Arquitetura (a forma)

```
/implementer FEAT  (skill nova, roda na sessão do humano):
   1. reuse-mapper (subagente, Sonnet) → Reuse Map (descoberta curada)
   2. carrega contexto curado DO DISCO: spec + plan + checklist de ACs
        + Reuse Map + regras do projeto aplicadas ativamente
   3. [Checkpoint A: plano de ataque + reúso]  ← FIXO
   4. implementa com TDD/verificação inline
        ↳ pergunta sob demanda em ambiguidade / reúso borderline / desvio
   5. fresh-eyes reviewer (subagente, Sonnet) → contexto cheio + Reuse Map
   6. [Checkpoint B: selo final]  ← FIXO
   7. observabilidade: chronicler (delivery report) + cost report + commit
```

Sem loop de dispatch, sem manifesto, sem calibração de tier, sem cascata.
**Núcleo = 1 skill implementadora + 2 subagentes focados (mapper, revisor) + 2 finalizadores observacionais (chronicler, committer).**

---

## 4. Componentes

### 4.1 Implementador (skill `/implementer`)
- **Roda na sessão do humano** (não é subagente despachado) — para permitir checkpoints interativos no meio. Um subagente rodaria até o fim e só então retornaria, empurrando as revisões pro fim (o problema do gate tardio).
- **Deriva todo o contexto do disco**, não da memória da conversa: spec.md + plan.md + checklist de ACs + Reuse Map + `CLAUDE.md`. Comportamento idêntico se rodar logo após o planejamento (auto-advance) ou dias depois (`/implementer FEAT`). Critério: higiene de context rot — carregar artefatos densos e limpos, não arrastar o entulho da conversa de planejamento.
- **Consome ativamente as regras** (conserto do "regra passada mas nunca lida"): passo explícito de aplicar a regra anti-abstração / legibilidade do `CLAUDE.md`.
- **Survey de reúso antes de escrever** (conserto das dores 1-2): ancorado no Reuse Map.
- **Herda as disciplinas boas do antigo `dev`:** TDD-leaning, `decisions[]` (decisão/desvio com rationale + ref), política de comentários Anthropic-style, sem git commits no meio.

### 4.2 Reuse-mapper + Reuse Map
- **Pré-passo de descoberta** (subagente, **Sonnet** — não Haiku: descoberta é fundacional, exige julgamento; mapa errado propaga o bug que estamos consertando). É o tipo **bom** de subagente (breadth-first discovery — ponto-doce validado pela pesquisa).
- Emite o **Reuse Map**, artefato denso contendo:
  - Código existente relevante à feature (utils, handlers, componentes) com `file:line` + uma linha do que faz.
  - Fronteiras **global × local** das áreas tocadas (conserto explícito do "trata global como local").
  - Regras do projeto que se aplicam aqui, destiladas do `CLAUDE.md`.
- **Consumido por** implementador (ancora o Checkpoint A) **e** revisor (verifica reúso contra o mesmo mapa). Artefato compartilhado = consistência.
- Mantém a janela do implementador limpa (carrega 1-2 páginas em vez de 30 leituras exploratórias).
- *Otimização futura (fora de escopo v1):* índice persistente do codebase em vez do pré-passo a cada run.

### 4.3 Fresh-eyes reviewer
- **Único subagente de revisão** (Sonnet; sobe pra Opus em feature arriscada). É o **merge** de `code-reviewer` + `logic-reviewer`.
- **Alimentado com contexto cheio** (não diff comprimido) + Reuse Map — por isso **consegue** fazer o check de reúso que os reviewers atuais são estruturalmente incapazes de fazer.
- **Dupla lente**, achados etiquetados: `reuse`, `abstraction`, `readability`, `spec_fidelity`, `pattern_fit`.
- **Fluxo dos achados:** trivial → implementador aplica sozinho; material/judgment call → sobe pro Checkpoint B.
- Complementar ao Checkpoint A: A revisa a *intenção* (antes do código); o revisor revisa o *código real* e pega o que escapou (não achou no plano, ou derivou na implementação).

### 4.4 Checkpoints humanos

**Fixos (sempre no pipeline):**
| # | Quando | O que o humano decide |
|---|--------|------------------------|
| **A** | Antes de escrever código | Plano de ataque + reúso (o que reusar / criar / tocar). Pega over-abstração, duplicação e global-como-local antes de existir código. |
| **B** | Após o revisor, antes de `done` | Selo final: o construído, achados do revisor e resolução, evidência, delivery report. |

**Disparados por condição** (princípio: *perguntar em vez de chutar* sempre que houver bifurcação que o spec/plano não resolve e com trade-off real — antídoto da "deslizada"):
- Ambiguidade do spec.
- Reúso borderline (estender shared vs. escrever novo).
- Desvio de plano material.
- Achado material do revisor.
- Checkpoint de meio (fatia vertical) — **só** em feature maior/arriscada (≥ ~8 arquivos ou área sensível).

### 4.5 Modelo de status (consumido pelo aiOS)
Novos estados de espera humana de primeira classe no `session.yml`, formalizados em `session.schema.json`:

| Momento | `status` | `attention.kind` | Coluna aiOS |
|---|---|---|---|
| Trabalhando | `implementing` | — | Em andamento |
| Checkpoint A | `needs_attention` | `plan_approval` | PRECISA DE SUA ATENÇÃO |
| Pergunta disparada | `needs_attention` | `input` | PRECISA DE SUA ATENÇÃO |
| Checkpoint B (pós-revisor, pré-done) | `needs_attention` | `final_approval` | PRECISA DE SUA ATENÇÃO |
| Selado | `done` | — | Done |

Decisão: **status guarda-chuva `needs_attention` + discriminador `attention.kind`** (não status planos distintos) — o aiOS filtra a coluna com uma condição só (`status == needs_attention`) e usa o `kind` apenas para o selo. Robusto a novos `kind` no futuro.

### 4.6 Observabilidade (preservada — o diferencial)
- `chronicler` + delivery report: **mantidos**, extrator reworkado para ler a trilha nova (evidência do implementador + achados do revisor + `decisions[]`).
- Cost report: **mantido**, scoping simplificado (conjunto de agentes agora é fixo e conhecido).
- Baseline git **leve**: mantido só para o delivery report saber "o que mudou" (sem a complexidade de atribuição do audit, que morreu).

---

## 5. Atribuição de modelo (sem Haiku, sem Tier×Loop)

A tabela Tier×Loop morre. Colapsar o pipeline remove a pressão de custo que empurrava trabalho pra modelo barato (e que causou o bug de amplificação 3-12x). Com poucos agentes por feature, cada um pode ser capaz.

| Papel | Modelo | Razão |
|---|---|---|
| Implementador | **Opus** | Trabalho mais duro (escreve o código) |
| Reuse-mapper | **Sonnet** | Boa compreensão de código, capaz; descoberta não é trivial |
| Fresh-eyes reviewer | **Sonnet** (→ Opus em feature arriscada) | Julgamento de reúso/legibilidade/fidelidade |

**Haiku sai do core inteiro** (desconfiança do usuário + descoberta/revisão exigem julgamento).

---

## 6. Inventário: morre / muda / fica

### Skills
| Skill | Decisão | Razão |
|---|---|---|
| `spec-writer` | FICA | Phase 1 interativo |
| `designer` | FICA (peso cresce) | `plan.md` vira o handoff curado; precisa capturar o "porquê" |
| `task-builder` | MUDA (encolhe) | Sem dispatches, vira checklist de ACs (ou funde no plano) |
| `orchestrator` | MORRE | Máquina de dispatch; substituída por `/implementer` |
| `pm` | **DELETA** | Encarna o modelo autônomo-sem-humano abandonado |
| `implementer` | NOVA | Phase 4 como skill interativa |

### Agents
| Agent | Decisão | Razão |
|---|---|---|
| `dev` | MORRE como subagente | Disciplinas migram pra skill `implementer` |
| `code-reviewer` + `logic-reviewer` | FUNDEM → 1 | Revisor de dupla lente, contexto cheio |
| `qa` | MORRE | Verificação inline + Checkpoint B |
| `audit-agent` | MORRE | Reconciliava dispatches/manifesto e detectava bypass — moot no novo design |
| `blocker-specialist` | MORRE | O humano é a escalação |
| `chronicler` | FICA (rework) | Delivery report = diferencial |
| `committer` | FICA | Auto-commit após Checkpoint B |
| `reuse-mapper` | NOVO | Descoberta (Sonnet) |
| fresh-eyes reviewer | = merge | Único subagente de revisão |

### Hooks
| Grupo | Decisão | Itens |
|---|---|---|
| Enforcement de dispatch + pm | MORREM | `verify-tier-calibration`, `verify-dispatch-packet`, `verify-pipeline-completeness`, `verify-audit-dispatch`, `verify-reviewer-write-path`, `manifest_append`, `verify-output-packet`, `verify-pm-handoff-clean`, `_pm_shared`, `register-impl-session` |
| Custo / observabilidade | FICAM (rework onde marcado) | `cost-report`, `cost_report`, `capture-session-cost`, `capture-subagent-cost`, `transcript_cost`, `pricing`, `hook_runtime`, `delivery_report`+`verify-delivery-report` (rework), `session_report`/`generate-session-report` |
| `guard-session-scope` | MUDA (repurpose) | De "orchestrator não edita source" → "implementador só escreve no escopo aprovado no Checkpoint A" |
| `block-git-write` | FICA | Sem commit no meio; committer commita no fim |
| `capture-baseline` + `audit_baseline` | FICA leve | Só para o delivery report ("o que mudou") |

---

## 7. Fora de escopo / adiado

- **Council (squad de debate pré-spec):** adiado atrás do core. É o tipo bom de multi-agente (divergente/voting) e faz sentido para forks de arquitetura abertos e caros — mas **sob demanda**, nunca fase obrigatória; padrão judge-panel (N agentes defendem abordagens diferentes → ADR). Construir só após o core aterrissar e provar valor. Critério: uma coisa de cada vez; o core conserta a dor real, o council melhora um estágio que já funciona (humano + agente brainstormando).
- **Índice persistente do codebase** (em vez do reuse-mapper a cada run) — otimização futura.

---

## 8. Migração e validação (trocar o motor sem se queimar)

1. **Strangler:** construir o novo **ao lado** do velho. A lista de morte (Seção 6) só executa **depois** que o núcleo provar valor. Nada é deletado no dia 1.
2. **Teste mecânico (automatizado, nos `__tests__/`):** unit tests dos hooks que mudam (`cost-report`, `delivery_report`, `guard-session-scope` repurposado, baseline-leve) + teste de schema do `session.schema.json` (`needs_attention` + `attention.kind`).
3. **Teste comportamental (julgado pelo humano, em repo consumidor real — nunca no próprio ai-squad):** rodar `/implementer` numa feature pequena real e checar os 5 pontos de dor + custo + velocidade.
4. **Benchmark head-to-head** (gera a evidência que a pesquisa não tinha): implementar a MESMA feature dos dois jeitos (orchestrator velho × núcleo novo); comparar custo (\$ + tokens) e correção. Vitória do novo = sinal verde pra executar a lista de morte.

### Barra de aceitação (a refinar)
- Zero util/handler reescrito que já existia.
- Zero global tratado como local.
- Código legível e aprovado pelo humano sem reclamação de abstração.
- Fiel ao spec sem deslizada material.
- Custo cai vs. pipeline velho na mesma feature (alvo numérico: **medir primeiro, cravar depois**).
- Humano interrompido só nos checkpoints planejados.
- aiOS mostra o status certo na coluna PRECISA DE SUA ATENÇÃO.

---

## 9. Questões em aberto
- Número-meta de corte de custo (decisão: medir o head-to-head primeiro, cravar depois).
- Repo + feature específicos para a validação comportamental (definir no plano).
- `task-builder`: encolher para checklist de ACs **ou** fundir inteiramente no `designer`/`plan.md`? (Decidir no plano.)
