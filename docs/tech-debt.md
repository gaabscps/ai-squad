---
created: 2026-05-11
last_updated: 2026-05-11
source: FEAT-004 handoff + followups consolidados
---

# Tech Debt — ai-squad

Catálogo de débitos técnicos identificados durante a execução das features. Cada item tem ID estável, categoria, impacto, e esforço estimado para priorização independente.

> **Convenção de prioridade:**
> - `P1` — bloqueia uso real ou corrompe dados silenciosamente
> - `P2` — degrada observabilidade ou auditabilidade
> - `P3` — inconsistência ou duplicação sem impacto funcional imediato

---

## Índice rápido

| ID | Categoria | Resumo | Prioridade | Esforço |
|----|-----------|--------|-----------|---------|
| [DEBT-001](#debt-001) | Bug | `_DEBT_MARKER_EXEMPT_PATHS` estreita — self-block no ai-squad | P1 | M |
| [DEBT-002](#debt-002) | Bug | Multi-feature mtime race em `find_active_session` | P2 | M |
| [DEBT-003](#debt-003) | Bug | `BaseException` silent allow em `scan_failed` | P2 | S |
| [DEBT-004](#debt-004) | Bug | Spec literal `pm_cost_within_budget` ≠ implementação `pm_cost_cap_exceeded` | P3 | S |
| [DEBT-005](#debt-005) | Infra | Reviewer subagents são read-only — Output Packets viram stubs | P1 | L |
| [DEBT-006](#debt-006) | Infra | `needs_review` + qa pass não equivale a `done` no audit-agent | P2 | S |
| [DEBT-007](#debt-007) | Design | Drift canônico: pm-bypass.md vs cópias inline no designer/task-builder | P3 | S |
| [DEBT-008](#debt-008) | Design | `fmtUsd`/`mdTable` duplicados em agentops report | P3 | S |
| [DEBT-009](#debt-009) | Design | audit-agent 3 edge cases em pm_cost checks | P3 | S |
| [DEBT-010](#debt-010) | Test | Race de 2 threads sem Barrier em capture-pm-usage tests | P3 | S |
| [DEBT-011](#debt-011) | Test | Cenários de integração under-asserted: designer/task-builder negative paths | P3 | M |
| [DEBT-012](#debt-012) | Design | Cache cross-dispatch é arquiteturalmente limitado por fan-out | P3 | L |
| ~~[DEBT-013](#debt-013)~~ | Infra | ~~`$HOME/.claude/hooks/` defasado vs repo~~ — **RESOLVIDO** em @ai-squad/cli 0.2.0 (per-repo hooks) | P1 | S |

---

## Bugs

### DEBT-001

**`_DEBT_MARKER_EXEMPT_PATHS` estreita — `/pm` self-bloqueia no ai-squad**

- **Origem:** FEAT-004 / T-004
- **Arquivo:** `squads/sdd/hooks/verify-pm-handoff-clean.py`
- **Prioridade:** P1
- **Esforço:** M

**Descrição:**
A lista de paths isentos da varredura de debt markers está hardcoded com prefixos muito estreitos:
`.agent-session/`, `node_modules/`, `vendor/`, `dist/`, `build/`, `.next/`.

Quando o `/pm` Skill roda *dentro* do próprio repo ai-squad, os arquivos que contêm literais de marcador legítimos não estão isentos:
- Skill docs que ensinam como usar `TODO:` / `FIXME:` como exemplo
- Fixtures de teste que contêm `xfail`, `@skip`, `mock-only` como strings de teste
- O próprio `docs/tech-debt.md` (este arquivo contém exemplos de marcadores)

**Impacto:** O hook bloqueia o handoff do PM com falso-positivo toda vez que o ai-squad usa `/pm` em si mesmo.

**Fix sugerido:**
Opção A — Expandir `_DEBT_MARKER_EXEMPT_PATHS` para incluir `squads/sdd/hooks/__tests__/`, `squads/sdd/skills/__tests__/`, `squads/sdd/agents/__tests__/`, `docs/`, `shared/concepts/`, `*.md` em geral.
Opção B — Trocar de path-prefix para path-pattern (glob ou regex) com um arquivo de configuração `.pm-scan-ignore` no root (análogo ao `.gitignore`).

Opção B é mais sustentável a longo prazo.

---

### DEBT-002

**Multi-feature mtime race em `find_active_session`**

- **Origem:** FEAT-004 / T-016
- **Arquivo:** `squads/sdd/hooks/_pm_shared.py` — função `find_active_session`
- **Prioridade:** P2
- **Esforço:** M

**Descrição:**
`find_active_session` usa `os.path.getmtime` nos arquivos `session.yml` dentro de `.agent-session/*/` para determinar qual feature está ativa, retornando a mais recentemente modificada.

Em ambientes com múltiplas features abertas simultaneamente (p.ex. dois `/orchestrator` em paralelo), o hook `capture-pm-usage.py` pode escrever o `pm_session` no manifesto da feature *errada* se ambas tiverem `session.yml` com mtimes próximos.

**Impacto:** `pm_sessions[]` no dispatch-manifest.json associado à feature errada. Relatório de custo PM no agentops fica incorreto para ambas as features.

**Fix sugerido:**
Ler `session.yml.current_owner` em vez de confiar em mtime. Se `current_owner == "pm"` e `current_phase` está em uma das phases planejadas, essa é a sessão ativa. Desempatar por `last_activity_at` se mais de uma se qualificar.

---

### DEBT-003

**`BaseException` silent allow em `scan_failed`**

- **Origem:** FEAT-004 / T-005
- **Arquivo:** `squads/sdd/hooks/verify-pm-handoff-clean.py`
- **Prioridade:** P2
- **Esforço:** S

**Descrição:**
O bloco `try/except` no fallback de timeout captura `Exception`, mas não `BaseException`. Subclasses como `MemoryError`, `SystemExit`, `KeyboardInterrupt` propagam silenciosamente para fora do except, podendo fazer o hook terminar sem emitir `{decision: "block"}` — o que resulta em allow implícito (hook sem output = allow na plataforma Claude Code).

**Impacto:** Em condições de memória muito baixa, o hook pode falhar silenciosamente e deixar o handoff passar com debt markers presentes.

**Fix sugerido:**
Mudar `except Exception as e` para `except BaseException as e` no bloco de scan_failed. Adicionar um sentinel de output no `finally` que garante que um JSON de block é emitido se `_output_written` for False.

---

### DEBT-004

**Spec literal `pm_cost_within_budget` ≠ implementação `pm_cost_cap_exceeded`**

- **Origem:** FEAT-004 / T-009 AC-018, T-025
- **Arquivos:** `squads/sdd/agents/audit-agent.md`, `shared/schemas/output-packet.schema.json`
- **Prioridade:** P3
- **Esforço:** S

**Descrição:**
A Spec (AC-018) usa o literal `pm_cost_within_budget` como nome do finding kind para quando o custo PM ultrapassa o cap. A implementação usou `pm_cost_cap_exceeded` (semânticamente mais preciso: exceeded é o estado ruim, within_budget seria o estado OK).

A inconsistência está entre:
- `squads/sdd/agents/audit-agent.md` Check 11 — usa `pm_cost_cap_exceeded` ✓
- `shared/schemas/output-packet.schema.json` enum — usa `pm_cost_cap_exceeded` ✓
- AC-018 no spec original — diz `pm_cost_within_budget` ✗

**Impacto:** Auditoria semântica da Spec falha (AC-018 literalmente não satisfeito pela implementação). Sem impacto funcional — o hook funciona corretamente.

**Fix sugerido:** Emitir spec amendment atualizando AC-018 para `pm_cost_cap_exceeded`. É a implementação que está certa.

---

## Infra

### DEBT-005

**Reviewer subagents são read-only — Output Packets viram stubs gerados pelo orchestrator**

- **Origem:** FEAT-004 Wave B1/B2/B3 (52 stubs gerados)
- **Arquivos:** `squads/sdd/agents/code-reviewer.md`, `squads/sdd/agents/logic-reviewer.md`
- **Prioridade:** P1
- **Esforço:** L

**Descrição:**
`code-reviewer` e `logic-reviewer` têm apenas ferramentas Read + Grep. Não conseguem escrever o Output Packet em `outputs/<dispatch_id>.json`. O orchestrator compensa gerando stubs com:

```json
{"_note": "stub generated by orchestrator — reviewer returned findings in transcript only"}
```

**Impacto concreto:**
- Findings com `severity`, `dimension`, `evidence_ref` existem só no transcript — invisíveis ao agentops
- Custo dos dispatches de reviewer não aparece em `cost by role` no relatório
- Audit-agent gera false-positive `bypass_detected` porque stubs não passam na checagem de completude
- FEAT-004 audit L3 foi bloqueado por isso e precisou de explicação manual

**Opções de fix:**

| Opção | Mecanismo | Complexidade | Trade-off |
|-------|-----------|-------------|-----------|
| A | Adicionar `Bash` restrito ao reviewer (`cat > outputs/*.json` apenas) | S | Abre superfície de ataque mínima; precisa de hook de validação de path |
| B | Stop hook `capture-reviewer-output.py` captura transcript e escreve packet | M | Zero mudança no subagent; parse de transcript é frágil |
| C | MCP tool `write_output_packet` dedicado | L | Cleanest; requer novo MCP server |

**Recomendação:** Opção A como quick fix, Opção C como target de longo prazo.

---

### DEBT-006

**`needs_review` + qa pass não é interpretado como `done` no audit-agent**

- **Origem:** FEAT-004 Wave B1/B2/B3
- **Arquivo:** `squads/sdd/agents/audit-agent.md`
- **Prioridade:** P2
- **Esforço:** S

**Descrição:**
O audit-agent Check 7 (reviewer stage completeness) exige `status: done` nos reviewer dispatches para marcar a task como completa. Mas o padrão de Wave A (que passou limpo) e a prática real de FEAT-004 é:

- Reviewer retorna `status: needs_review` com minors deferidos
- QA passa validando ACs
- Orchestrator marca task `state: done`

O audit-agent não tem a regra: **`needs_review` + qa pass subsequente = `done` para fins de gate**. Isso gera falso-positivo `bypass_detected` para tasks legítimas.

**Fix sugerido:**
Adicionar ao Check 7 do audit-agent: se uma task tem dispatch `status: needs_review` em reviewer E tem dispatch `status: done` em qa subsequente, interpretar como `reviewer_done: true` para o gate.

---

## Design

### DEBT-007

**Drift canônico: pm-bypass.md vs cópias inline no designer/task-builder**

- **Origem:** FEAT-004 / T-013 e T-014 (correram em paralelo a T-012 que atualizou o canônico)
- **Arquivos:** `squads/sdd/skills/designer/skill.md`, `squads/sdd/skills/task-builder/skill.md`, `shared/concepts/pm-bypass.md`
- **Prioridade:** P3
- **Esforço:** S

**Descrição:**
T-012 dev L2 atualizou `shared/concepts/pm-bypass.md` com duas adições críticas:
1. Partial-write repair (write to `.tmp` + `os.replace`)
2. `current_phase` advance após bypass approval

T-013 (designer) e T-014 (task-builder) correram em paralelo e integraram versões do pm-bypass sem essas duas adições. As cópias inline nos dois Skills estão defasadas em relação ao canônico.

**Impacto:** Em PM-mode, designer e task-builder podem deixar arquivos em estado parcial se o processo for interrompido mid-write, ou não avançar `current_phase` corretamente.

**Fix sugerido:** Re-ler `shared/concepts/pm-bypass.md` e sincronizar o bloco Step 6.5 nos dois Skills linha a linha.

---

### DEBT-008

**`fmtUsd`/`mdTable` duplicados em agentops report**

- **Origem:** FEAT-004 / T-020
- **Arquivo:** `packages/agentops/src/render/report.ts`
- **Prioridade:** P3
- **Esforço:** S

**Descrição:**
As funções `fmtUsd` (formata float como `$0.0042`) e `mdTable` (constrói tabela markdown) foram duplicadas em `report.ts` em vez de extraídas para um módulo compartilhado. A função `fmtUsd` também existe em `cost-breakdown.ts`.

**Impacto:** Se o formato de saída mudar, requer duas edições. Baixo risco de divergência hoje, alto risco quando mais seções de relatório forem adicionadas.

**Fix sugerido:** Criar `packages/agentops/src/render/utils.ts` com `fmtUsd` e `mdTable`. Re-exportar de `cost-breakdown.ts` se necessário para não quebrar imports existentes.

---

### DEBT-009

**audit-agent 3 edge cases em pm_cost checks**

- **Origem:** FEAT-004 / T-024
- **Arquivo:** `squads/sdd/agents/audit-agent.md`
- **Prioridade:** P3
- **Esforço:** S

**Descrição:**
Check 11 (`pm_cost_cap_exceeded`) tem 3 edge cases não cobertos:

1. **`sum` sobre `cost_usd` undefined** — se um `pm_session` não tiver o campo `cost_usd`, `sum()` retorna `None` em vez de `0`, quebrando a comparação com o cap.
2. **`artifact_path` null** — Check 10 (`pm_gate_violations`) faz match de artifact_path; se `phase_history[phase].artifact_path` for null, a comparação pode lançar TypeError.
3. **`notes` ausente** — se `session.yml.notes` não existir (session mais antiga), Check 10 falha ao tentar iterar `pm_decision` entries.

**Fix sugerido:** Adicionar guards explícitos nos 3 pontos no audit-agent.md com comportamento definido: `cost_usd` ausente → tratar como 0; `artifact_path` null → skip match (log warning); `notes` ausente → skip Check 10 (não é violação, é session pré-FEAT-004).

---

## Test hygiene

### DEBT-010

**Race de 2 threads sem Barrier em capture-pm-usage tests**

- **Origem:** FEAT-004 / T-023
- **Arquivo:** `squads/sdd/hooks/__tests__/test_capture_pm_usage.py`
- **Prioridade:** P3
- **Esforço:** S

**Descrição:**
O teste de race condition usa um `threading.Barrier` para sincronizar 5 threads, mas o caso de 2 threads não tem Barrier — usa `time.sleep(0.01)` como sincronização implícita. O teste funciona na maioria das vezes, mas pode ser não-determinístico em máquinas lentas ou CI com context-switch agressivo.

**Fix sugerido:** Extrair `_run_concurrent_writes(n_threads)` com Barrier para N arbitrário. Testar com n=2, n=5, n=10.

---

### DEBT-011

**Cenários de integração under-asserted: designer/task-builder negative paths**

- **Origem:** FEAT-004 / T-015
- **Arquivo:** `squads/sdd/skills/__tests__/test_pm_bypass_integration.md`
- **Prioridade:** P3
- **Esforço:** M

**Descrição:**
O cenário de integração do PM bypass cobre os happy paths dos 3 Skills, mas tem gaps nas asserções negativas:

1. **designer negative** — cenário de `auto_approved_by: pm` com AC-coverage gap (marker `[NEEDS CLARIFICATION]` presente) não verifica se o Skill *recusa* o bypass E escreve o marker corretamente em `session.yml.notes`.
2. **task-builder negative** — `[P]`-violation detection em PM mode não tem cenário de rejeição explícito.
3. **`current_phase` advance ambiguity** — não está claro se o bypass avança `current_phase` para a próxima phase planejada ou para `"implementation"`. O cenário não asserções isso.

**Fix sugerido:** Adicionar 3 cenários negativos ao documento, com asserções explícitas sobre o estado de `session.yml` após cada rejeição.

---

### DEBT-012

**Cache cross-dispatch é arquiteturalmente limitado pelo fan-out**

- **Origem:** investigação de custos pós-FEAT-004 (2026-05-12)
- **Arquivo:** N/A (decisão arquitetural — não há fix de arquivo único)
- **Prioridade:** P3
- **Esforço:** L

**Descrição:**
A análise de cache em FEAT-004 (apenas 3 dispatches com telemetria real, restante perdida pelo bug de captura — ver Fix #3) mostra que **dentro de cada dispatch**, o prompt cache funciona muito bem: `cache_read / cache_creation ≈ 12.5x` — Claude Code reaproveita cache entre os turnos da mesma conversa.

**Mas entre dispatches paralelos da mesma task** (dev → code-reviewer → logic-reviewer → qa, todos para o mesmo T-001), não há reuso de cache:
- Cada subagent tem system prompt diferente (body do agents/*.md)
- Cada subagent é uma sessão Claude Code independente (Task tool)
- O prompt cache da Anthropic é content-addressed dentro de uma sessão; cross-conversation só hita se o conteúdo for *identico* + dentro do TTL (5 min standard, 1h extended)

**Implicação prática:**
Cada dispatch paga `cache_creation` cheio na primeira turn (~2.5M tokens / dispatch para tasks com spec+plan+tasks completos no contexto). Para a feature inteira (~150 dispatches em FEAT-004), isso é ~375M tokens de cache_creation a custo de input cheio.

**Por que não dá pra "compartilhar" cache entre roles:**
Compartilhar exigiria unificar dev/reviewer/qa em uma única conversa, o que destrói o fan-out paralelo e o isolamento de contexto que é o motivo arquitetural do split Skills/Subagents (ver memória `project_skills_vs_subagents_split`).

**Fix sugerido (caro — só se custo justificar):**
- **Opção A (preferida):** orchestrator pré-extrai um "context bundle" mínimo por task (apenas as seções relevantes do spec/plan + diffs dos arquivos em `scope_files`) e embute no Work Packet em vez de pedir pra cada subagent reler `.agent-session/<id>/spec.md` inteiro. Reduz cache_creation por dispatch, sem mudar fan-out.
- **Opção B (radical):** loops sequenciais da MESMA role (dev L1 → L2 → L3) compartilham uma única conversa Claude Code via histórico (não via novo Task dispatch). Cache reusa naturalmente entre loops. Quebra a captura por dispatch_id atual; exige re-design do manifest.

**Bloqueio pra implementar:** sem métrica confiável (depende do Fix #3 chegar a produção via DEBT-013), qualquer otimização aqui é cega. Prerequisito: medir cache_creation real em ≥3 sessões pós-fix.

---

### DEBT-013 — RESOLVIDO (2026-05-12, @ai-squad/cli 0.2.0)

**`$HOME/.claude/hooks/` defasado vs `squads/sdd/hooks/` — sem sync mechanism**

- **Resolução:** Per-repo hook install via `ai-squad deploy`. Component frontmatter migrado para `$CLAUDE_PROJECT_DIR/.claude/hooks/`. Skills+agents continuam globais.
- **Origem:** investigação de custos pós-FEAT-004 (2026-05-12)
- **Arquivo:** `$HOME/.claude/hooks/capture-subagent-usage.py` (e outros)
- **Prioridade:** P1
- **Esforço:** S

**Descrição:**
Os Subagents referenciam hooks via `$HOME/.claude/hooks/<nome>.py` no frontmatter (ver `squads/sdd/agents/dev.md:14`). Mas os hooks são editados no repo em `squads/sdd/hooks/`. Sem um mecanismo de sync, as cópias divergem:

- `$HOME/.claude/hooks/capture-subagent-usage.py` está **significativamente atrás** da versão do repo (falta o módulo de failure handling AC-003, warning channel AC-007, várias helpers).
- `$HOME/.claude/hooks/stamp-session-id.py` tem regex divergente (`d` vs `d-`).

**Impacto:** fixes aplicados no repo NÃO chegam a sessões reais até alguém copiar manualmente. Os Fixes #1-#3 desta investigação (AC-009 enforcement, AC-014 transcript aggregation, fallback de correlação) são **silenciosamente inativos** em runtime até sync.

**Fix sugerido:**
- **Opção A (simples):** script `scripts/install-hooks.sh` que copia `squads/sdd/hooks/*.py` pra `$HOME/.claude/hooks/`. Rodar como passo manual antes de cada session.
- **Opção B (zero-copy):** mudar frontmatter dos subagents pra referenciar `$CLAUDE_PROJECT_DIR/squads/sdd/hooks/<nome>.py` em vez de `$HOME/.claude/hooks/`. Elimina divergência por design. Requer testar que `$CLAUDE_PROJECT_DIR` está populado em subagent context.
- **Opção C (pre-commit hook):** git hook que sincroniza após cada commit em `squads/sdd/hooks/`. Robusto mas adiciona magic.

**Recomendação:** Opção B se viável (`$CLAUDE_PROJECT_DIR` é setado pelo Claude Code antes de subagent dispatch). Senão, A com instrução clara no README.

---

## Como atacar

Ordem sugerida de resolução independente:

1. ~~**DEBT-013**~~ — **RESOLVIDO em @ai-squad/cli 0.2.0**
2. **DEBT-001** — P1 bug funcional que bloqueia uso real do ai-squad em si mesmo
3. **DEBT-005** — P1 infra gap que degrada todo o pipeline (começa pela Opção A)
4. **DEBT-006** — P2 desbloqueador: remove false-positives no audit-agent
5. **DEBT-002** — P2 race condition em ambiente multi-feature
6. **DEBT-003** — P2 edge case de segurança no hook de debt scan
7. **DEBT-007** — P3 sync rápido entre Skills e canônico
8. **DEBT-004 + DEBT-008 + DEBT-009** — P3 polish, qualquer ordem
9. **DEBT-010 + DEBT-011** — P3 test hygiene, atacar junto
10. **DEBT-012** — P3 só atacar depois de medir cache real ≥3 sessões pós-DEBT-013

> Cada item é independente e pode virar uma task isolada dentro de uma FEAT-005 ou ser atacado diretamente como hotfix dependendo do impacto.
