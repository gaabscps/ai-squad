---
created: 2026-05-15
issues:
  - "#5 FEAT-007 — session_id no Work Packet"
  - "#4 FEAT-008 — model override + resume integrity"
status: approved
---

# Design — FEAT-007 + FEAT-008: Pipeline Integrity Hardening

Fecha duas issues que degradam integridade do pipeline SDD:

- **#5 / FEAT-007** — `verify-tier-calibration.py` usa fallback heurístico pra localizar `tasks.md`. Solução: `session_id` first-class no Work Packet.
- **#4 / FEAT-008** — duas falhas no FEAT-006: (A) Task tool `model` override silently dropped, (B) orchestrator resume pulou CR ‖ LR sem registro de exceção.

As features são independentes em escopo, mas FEAT-007 vira pré-condição limpa pra FEAT-008 (lookup direto por `session_id` em vez de mtime; campo `session_id` já presente quando `verify-pipeline-completeness.py` for adicionado).

## Decisões arquiteturais

### 1. `session_id` como campo first-class do Work Packet (FEAT-007)

**Schema change:** YAML embedded no Task tool prompt ganha `session_id: <FEAT-NNN>`, obrigatório pra dispatches task-scoped (dev, CR, LR, QA); opcional pra audit-agent (pipeline-scoped).

**Derivação:** orchestrator lê cwd `.agent-session/<FEAT-NNN>/` no momento do dispatch e injeta no YAML.

**Propagação:** Subagent contracts copiam `session_id` do Work Packet pro Output Packet — sem lookup.

**Backward-compat:** `verify-tier-calibration.py` mantém fallback heurístico por 1 release pra Work Packets antigos sem `session_id`. Hard-require em release posterior.

### 2. `model_resolved_to` como campo obrigatório do Output Packet (FEAT-008 Gap A)

**Schema change:** Output Packet ganha `model_resolved_to: <model-id-da-execução>`. Subagent runtime captura o model que efetivamente rodou (não o solicitado).

**Validação:** `verify-tier-calibration.py` compara `model_resolved_to` vs `model_requested` (do Work Packet). Drift → block com `model_override_dropped: requested=<X>, resolved=<Y>`.

**Documentação:** precedência canonical (Task tool `model:` > agent file frontmatter > parent default) em `shared/concepts/effort.md`.

### 3. Hard rule reviewer gate (FEAT-008 Gap B)

**Orchestrator skill:** adiciona cláusula "Reviewer stages são mandatórios" no step "Per-task state machine". Skip permitido apenas quando `tasks.md` carrega `**Skip reviewers:** <reason>` na task.

**Novo hook `verify-pipeline-completeness.py`:** SubagentStop matcher `dev`. Pra cada Output Packet de dev com `status=done`, verifica em `dispatch-manifest.json`:
- existe dispatch `code-reviewer` com mesmo `task_id` E
- existe dispatch `logic-reviewer` com mesmo `task_id` E
- ambos `dispatched_at` ≤ N segundos após dev `dispatched_at`

OU `tasks.md` da task carrega `**Skip reviewers:**`.

Caso contrário: block `pipeline_incomplete: dev <task_id> done sem CR/LR dispatch`.

## Estrutura por feature

### FEAT-007 (issue #5) — entrega

1. Orchestrator skill emite `session_id` no Work Packet (1 ponto de edição em `squads/sdd/skills/orchestrator/skill.md`).
2. Subagent contracts (5 agents) propagam `session_id` — adição de 1 linha cada.
3. `verify-tier-calibration.py`: lookup direto, remove fallback (~50 linhas) + 2 NOTE markers; mantém fallback gated por `if not session_id:` pra backward-compat.
4. Audit-agent usa `session_id` pra correlação de orphans em vez de varredura.
5. Tests: 1 happy-path (com session_id), 1 backward-compat (sem session_id), 1 regression do orphan correlation.

### FEAT-008 (issue #4) — entrega

**Gap A — model override:**
1. Output Packet schema: campo obrigatório `model_resolved_to`.
2. Subagent contracts populam `model_resolved_to` antes do write.
3. `verify-tier-calibration.py` valida drift.
4. `shared/concepts/effort.md`: documenta precedência.
5. Repro test: dispatch fake logic-reviewer com `model: sonnet`, assert `model_resolved_to` no Output Packet.

**Gap B — reviewer skip gate:**
1. Orchestrator skill: hard rule + `**Skip reviewers:**` syntax.
2. Novo hook `verify-pipeline-completeness.py`.
3. Tests: pipeline normal passa; dev sem CR/LR depois de N seg bloqueia; skip-justified passa.

## Hooks duplicados — estratégia

Existem 4 cópias de `verify-tier-calibration.py`:
- `./.claude/hooks/` (repo runtime)
- `./squads/sdd/hooks/` (canonical source)
- `./packages/cli/.claude/hooks/` (cli runtime)
- `./packages/cli/components/sdd/hooks/` (cli source-of-truth)

Pares idênticos confirmados via md5: `(canonical, cli-canonical)` e `(repo-runtime, cli-runtime)`.

**Estratégia:** editar as 2 canônicas (`squads/sdd/hooks/` + `packages/cli/components/sdd/hooks/`), depois sincronizar pras runtime copies. Verificar se há script de sync no repo — se não, anotar débito (DEBT) e fazer cópia manual com checksum verification.

## Critérios de aceitação

**FEAT-007 (issue #5):**
- [ ] Work Packet schema doc atualizado
- [ ] Orchestrator skill emite `session_id` derivado do cwd
- [ ] `verify-tier-calibration.py` sem fallback scanning quando `session_id` presente (-50 linhas)
- [ ] 2 NOTE markers removidos
- [ ] Output Packet carrega `session_id`
- [ ] Audit-agent usa `session_id` pra correlação
- [ ] Regression tests cobrindo "sessão sem session_id" (backward-compat)

**FEAT-008 (issue #4):**
- [ ] Output Packet de LR tem `model_resolved_to: claude-sonnet-*` quando dispatchado com `model: sonnet`
- [ ] Drift entre `model_requested` e `model_resolved_to` bloqueia
- [ ] Re-rodar `/pm FEAT-006 --resume` não pula CR/LR sem `**Skip reviewers:**`
- [ ] `verify-pipeline-completeness.py` cobre happy + skip-justified + violation
- [ ] Precedência documentada em `shared/concepts/effort.md`

## Execução

- 2 ramos / 2 PRs, FEAT-007 first.
- Cada feature: writing-plans → TDD → verification-before-completion.
- PRs fecham as issues com `Closes #5` / `Closes #4`.

## Out of scope

- 23 null-usage entries do FEAT-006 (forward-only, não recuperáveis).
- Hard-require de `session_id` (deixar pra release posterior, após N runs estáveis).
- DEBT-001..012 do `docs/tech-debt.md` — não relacionados.
