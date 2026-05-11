# Model & Effort Calibration — Guia completo

> Status: opinionated default. Baseado em análise empírica de 160+ tasks reais dos projetos calendarfr, bettersmp e Admin_companies_payments.
> Companion para [`shared/concepts/effort.md`](../shared/concepts/effort.md) e [`docs/operational-model.md`](operational-model.md).

---

## 1. Fases SDD — Skills (herdam da sessão)

Skills não aceitam `model`/`effort` em frontmatter — herdam do contexto da sessão do humano.
A recomendação abaixo é o `/model` que você deve setar **antes** de invocar cada Skill.

| Skill / Fase | Modelo recomendado | Effort (plataforma) | Por quê |
|---|---|---|---|
| `/spec-writer` (Fase 1 — Specify) | **opus** | xhigh (default opus) | Spec é decisão de escopo, AC coverage, riscos — raciocínio pesado. Erro aqui se propaga para todas as fases. |
| `/designer` (Fase 2 — Plan) | **opus** | xhigh (default opus) | Arquitetura, dependências, riscos técnicos. Decisões de design têm custo alto de reversão. |
| `/task-builder` (Fase 3 — Tasks) | **sonnet** | high (default sonnet) | Decomposição é procedural com Spec + Plan prontos. Sonnet com `high` é suficiente. |
| `/orchestrator` — fan-out simples | **sonnet** | high | Dispatch sequencial, poucas dependências — procedural. |
| `/orchestrator` — fan-out complexo ¹ | **opus** | xhigh | Grafo denso de dependências (ex: 26 tasks em 8 ondas), decisão de paralelismo. |
| `/orchestrator --resume` após escalação | **opus** | xhigh | Precisa raciocinar sobre blocker memos e decidir próximo passo. |
| `/orchestrator --resume` simples | **sonnet** | high | Apenas continua tasks restantes — procedural. |
| `/discovery-lead` (Frame) | **opus** | xhigh | Framing de oportunidade é raciocínio-pesado. |
| `/discovery-lead` (Investigate — mapper) | **sonnet** | high | Mapeamento de codebase é procedural. |
| `/discovery-lead` (Investigate — risk-analyst) | **opus** | high | Análise de risco exige julgamento. |
| `/discovery-lead` (Decide) | **opus** | xhigh | Síntese + decisão + override judgment. |

¹ Fan-out complexo: ≥ 15 tasks com múltiplas ondas de paralelismo. Ex: calendarfr FEAT-001 (26 tasks, 8 ondas).

---

## 2. Taxonomia de tasks — 4 tiers

Usado pelo orchestrator para determinar `model`/`effort` no Work Packet de cada dispatch.

| Tier | Nome | % histórica ² | Sinais de classificação | Exemplos reais |
|---|---|---|---|---|
| **T1** | Procedural / spec-copy | ~38% | `complexity=small` + objetivo: "criar config", "adicionar import", "copiar template", "mesmo padrão de" | Admin FEAT-001 T-001..T-010 (todos Baixa), calendarfr T-007 (prettier), T-008 (commitlint), T-018 (import fonts), bettersmp T-005 (build script) |
| **T2** | Pattern-following | ~33% | `complexity=small/medium` + objetivo: "mesmo padrão do piloto", "fixture", "stories", "batch de N services", "seguindo estilo de" | Admin FEAT-002 T-005..T-008 (batch services), calendarfr FEAT-005 T-006..T-011 (card parts), FEAT-002 T-002/T-003 (types/constants) |
| **T3** | Implementação com julgamento | ~22% | `complexity=medium` + setup de tooling / hook com side-effects / componente com ACs específicos / migração com exceção | calendarfr T-004 (tsconfig), T-009 (Vite+NFRs), T-011 (Jest+MSW), T-019 (PaperSheet), Admin FEAT-002 T-002 (factory interceptors), bettersmp T-002/T-003 |
| **T4** | Núcleo de lógica complexa | ~7% | `complexity=large/alto` OU objetivo contém: state machine, concorrência, async callback, a11y/WAI-ARIA, aggregator, sanitize, controlled mode, AtomicBoolean | calendarfr FEAT-005 T-004/T-005 (state machine, aggregator), FEAT-007 BATCH-A (Tiptap+sanitize), BATCH-C (WAI-ARIA keyboard nav), bettersmp T-004 (listener AtomicBoolean+callback) |

² Percentual baseado em 160+ tasks dos 3 projetos analisados.

---

## 3. Dispatches do orchestrator — modelo/effort por passo × tier

### 3a. Pipeline chain por task

```
dev (L1) ──► code-reviewer ‖ logic-reviewer ──► [findings?] ──► dev (L2) ──► [findings?] ──► dev (L3)
                                                                                                    │
                                                         [cap/stall/conflict] ──► blocker-specialist ◄──┘
                                                                  │
                                                                clean
                                                                  │
                                                                 qa ──► [fail?] ──► dev (qa-L1) ──► qa ──► [fail?] ──► dev (qa-L2)
                                                                  │                                                          │
                                                                done                               [cap] ──► blocker-specialist
                                                                  │
                                                          (todos tasks done)
                                                                  │
                                                           audit-agent (singleton)
                                                                  │
                                                               handoff
```

### 3b. Tabela de dispatches

| Passo | Descrição | T1 — Procedural | T2 — Pattern | T3 — Julgamento | T4 — Núcleo complexo |
|---|---|---|---|---|---|
| **dev L1** | Primeira implementação | `haiku high` | `sonnet medium` | `sonnet high` | `sonnet high` |
| **dev L2** | Retry com `previous_findings` do reviewer | `sonnet medium` ³ | `sonnet high` ³ | `sonnet high` | `sonnet high` |
| **dev L3** | Retry final (review loop cap = 3) | `sonnet high` ³ | `sonnet high` | `sonnet high` | `opus medium` ⁴ |
| **dev qa-L1** | Retry após qa fail (pula reviewers) | `sonnet medium` | `sonnet high` | `sonnet high` | `sonnet high` |
| **dev qa-L2** | Retry final após qa fail | `sonnet high` | `sonnet high` | `sonnet high` | `opus medium` ⁴ |
| **code-reviewer** | Qualquer pass (L1/L2/L3) | `haiku high` | `haiku high` | `sonnet medium` | `sonnet medium` |
| **logic-reviewer** | Qualquer pass (L1/L2/L3) | `sonnet medium` | `sonnet medium` | `sonnet high` | `opus high` |
| **qa** | Qualquer attempt | `haiku high` | `haiku high` | `sonnet medium` | `sonnet medium` |
| **blocker-specialist** | Qualquer trigger (cap, stall, conflict) | `opus xhigh` ⁵ | `opus xhigh` ⁵ | `opus xhigh` ⁵ | `opus xhigh` ⁵ |
| **audit-agent** | Singleton pré-handoff (pipeline-end) | `haiku medium` ⁶ | `haiku medium` ⁶ | `haiku medium` ⁶ | `haiku medium` ⁶ |

³ **Bump automático em loop:** nunca desce modelo em retry — sempre sobe. Se `dev L1` falhou com `haiku`/`sonnet medium`, o problema é mais difícil que o tier indicava. L2 sobe para dar mais capacidade com os `previous_findings` já disponíveis.

⁴ **`opus medium` no L3/qa-L2 de T4:** `sonnet high` falhou duas vezes com findings detalhados. O gargalo passou a ser capacidade de raciocínio, não mais orientação. `opus medium` (não `high`) porque `previous_findings` já guia — não precisa de reasoning budget alto, precisa de reasoning _quality_ alta. `high` seria redundante dado o contexto rico.

⁵ **`blocker-specialist` sempre `opus xhigh`:** fixo independente de tier. Frequência baixíssima (escalation only) + stakes altos (última linha antes do humano). Ver [`shared/concepts/effort.md`](../shared/concepts/effort.md#anti-patterns) — downgrade do blocker-specialist é anti-pattern documentado.

⁶ **`audit-agent` sempre `haiku medium`:** fixo pelo framework. Reconciliação mecânica de manifest vs outputs — sem raciocínio criativo. `medium` (não `low`) porque falso-negativo derrota toda a camada de auditoria.

---

## 4. Modificador de domínio

Incide **sobre** o tier base. Quando a task pertence a um domínio crítico, sobe os levers independentemente da complexidade estimada.

| Domínio da task | Modificador |
|---|---|
| Auth / token / sessão (ex: Admin FEAT-002 T-001/T-002) | dev: sobe 1 tier. logic-reviewer: `opus high` em qualquer tier. |
| Pagamento / transação financeira | Idem. |
| Concorrência / async (Java callbacks, React controlled mode race) | dev: sobe 1 tier. logic-reviewer: `opus high` em qualquer tier. |
| UI / config / tooling puro sem lógica de negócio | Sem modificador — usa tier base. |
| Build script / QA manual / roteiro de teste | Pode descer 1 tier se complexity=small e zero lógica de negócio. |

**Exemplos aplicados:**

| Task real | Tier base | Domínio | dev final | logic-reviewer final |
|---|---|---|---|---|
| Admin FEAT-001 T-001 (`timeoutConfig.js`) | T1 | Service config puro | `haiku high` | `sonnet medium` |
| Admin FEAT-001 T-002 (`interceptors.js` com auth 401) | T1 | **Auth** | `sonnet medium` (+1 tier) | `opus high` |
| Admin FEAT-002 T-001 (`getTokenFromCookie`) | T1 | **Auth/token** | `sonnet medium` (+1 tier) | `opus high` |
| Admin FEAT-002 T-005..T-008 (batch services s/ auth) | T1 | Service wiring | `haiku high` | `sonnet medium` |
| calendarfr T-007 (prettier config) | T1 | Tooling | `haiku high` | `sonnet medium` |
| calendarfr T-019 (PaperSheet component) | T3 | UI | `sonnet high` | `sonnet high` |
| calendarfr FEAT-005 T-004 (state machine) | T4 | Lógica de domínio | `sonnet high` | `opus high` |
| calendarfr FEAT-007 BATCH-A (Tiptap + sanitize) | T4 | UI + sanitização | `sonnet high` | `opus high` |
| bettersmp T-004 (AtomicBoolean + callback async) | T4 | **Concorrência** | `opus medium` (+1 tier) | `opus high` |
| bettersmp T-005 (build script) | T1 | Build puro | `haiku high` | `sonnet medium` |

---

## 5. Heurística de classificação automática (para o orchestrator)

O orchestrator pode classificar o tier lendo `Estimated complexity` + keywords do objetivo de cada task antes do dispatch.

```
T1 → complexity=small/baixa
     E objetivo contém qualquer de:
     [config, import, constants, gitignore, README, stories, copiar,
      mesmo padrão, fixture simples, build, install, doc, CLAUDE.md,
      prettier, commitlint, lint-staged, tsconfig simples, badge]

T2 → complexity=small/medium
     E objetivo contém qualquer de:
     [mesmo padrão de, batch de, seguindo estilo de, part-component,
      re-export, barrel, fixture de, story de, migration batch]

T3 → complexity=medium
     E qualquer de:
     [hook, setup de tooling, componente com props/ACs, integração,
      migração com exceção, interceptor, factory, jest, vite, playwright,
      CSS responsivo, breakpoint]

T4 → complexity=large/alto
     OU objetivo contém qualquer de:
     [state machine, concorrência, async callback, a11y, WAI-ARIA,
      aggregator, sanitize, controlled mode, AtomicBoolean, race condition,
      idempotent, type-guard, dedup, rich data transform]
```

**Fallback seguro:** quando a classificação for ambígua (keywords ausentes, complexity não encontrado), usar **T3** como default. Melhor over-investir uma task procedural do que under-investir uma task complexa.

---

## 6. Plataforma — defaults e limites

| Modelo | Effort default da plataforma | Nota |
|---|---|---|
| claude-opus-4-7 | `xhigh` | Único modelo que suporta `xhigh` de forma plena. |
| claude-opus-4-6 | `high` | |
| claude-sonnet-4-6 | `high` | Default atual dos subagents do framework. |
| claude-haiku-4-5 | `medium` | Tier mais econômico; `high` é o teto recomendado. |

**Os 5 níveis de effort:**

| Effort | Behavior | Quando usar |
|---|---|---|
| `low` | Fast, minimal reasoning | Latency-sensitive, trivial. **Não usar em dev** — documentado como anti-pattern. |
| `medium` | Balances cost and quality | Reviewers procedurais (code-reviewer), QA, audit-agent. |
| `high` | More internal reasoning | Dev T3/T4, logic-reviewer, qualquer task com julgamento. |
| `xhigh` | Deep reasoning | blocker-specialist, spec-writer, designer. **Opus 4.7 only.** |
| `max` | No ceiling on reasoning | Casos extremos. Retorno decrescente documentado — não usar como default. |

---

## 7. Anti-patterns documentados

1. **`dev` com `effort: low` em qualquer tier.** `low` é para tarefas triviais sem implementação. Dev sempre requer leitura cuidadosa do spec — mínimo `medium`, recomendado `high`.

2. **`opus xhigh` em tudo como "safe default".** Queima quota 5× mais rápido que Sonnet. O blocker-specialist existe para o nível máximo; os outros roles não precisam competir com ele.

3. **Descer modelo em retry.** Loop N+1 com modelo menor que Loop N é contra-intuitivo e ineficiente. Bump sempre; nunca desce.

4. **`xhigh` ou `model: opus` no `code-reviewer`.** Pattern matching contra convenções é procedural — o upgrade não agrega. Over-investimento com ganho marginal.

5. **`haiku` no `logic-reviewer` de T3/T4.** O logic-reviewer de T4 é onde o upgrade paga mais — race conditions, invariantes quebradas, edge cases. Haiku não tem raciocínio suficiente para detectar essas categorias.

6. **Omitir o `audit-agent` para economizar.** O skill do orchestrator documenta explicitamente: `"The cost is one cheap haiku dispatch; the protection is non-negotiable."` O hook `verify-audit-dispatch.py` bloqueia o Stop do orchestrator se o audit-agent não tiver rodado.

---

## 8. Override via Work Packet

O orchestrator pode sobrescrever os defaults por dispatch individual via campos opcionais do Work Packet:

```json
{
  "dispatch_id": "DEV-T-007",
  "to_role": "dev",
  "model": "haiku",
  "effort": "high",
  "objective": "Criar prettier.config.mjs e .prettierignore conforme spec"
}
```

Campos `model` e `effort` no Work Packet sobrescrevem o frontmatter do agent **apenas para aquele dispatch**. O próximo dispatch reverte ao default do agent. Ver [`shared/concepts/work-packet.md`](../shared/concepts/work-packet.md) para o schema completo.

---

*Última atualização: 2026-05-10 — análise empírica de calendarfr (8 FEATs, ~126 tasks), bettersmp (2 FEATs, 7 tasks), Admin_companies_payments (2 FEATs, 28 tasks).*
