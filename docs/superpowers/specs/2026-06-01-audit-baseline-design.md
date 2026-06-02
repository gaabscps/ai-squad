# Audit baseline — isentar sujeira pré-existente da Check 6

**Data:** 2026-06-01
**Status:** design aprovado (brainstorming), pendente de plano de implementação
**Escopo:** Spec A de 3 (ver "Contexto"). Trata só o falso-positivo de propriedade de arquivo no audit-agent.

## Contexto

Uma run real no repo consumidor `ai-squad-os` (FEAT-001, 64 dispatches, 22/22 ACs e 265 testes verdes) emitiu um handoff de **falha**. A causa foi um falso-positivo na Check 6 do audit-agent: um `.gitignore` que o humano havia modificado **antes** de iniciar a Fase 4 foi acusado como `orchestrator_edited_source` → `bypass_detected`, e como o veredito `blocked` é terminal por design anti-fraude (issue #1), o orchestrator foi obrigado a recusar o handoff de um trabalho íntegro.

Esse handoff expôs ao todo **3 problemas independentes** do framework, divididos em 3 specs:
- **Spec A (este doc):** audit confunde sujeira pré-existente com fraude do orchestrator.
- **Spec B:** `cost-report` exclui 100% do custo de implementação quando a allow-list não bate (subcontagem silenciosa).
- **Spec C:** integridade de escrita da Fase 4 (Output Packets de reviewer que não persistiram + `dispatch-manifest.json` corrompido por edição não-atômica).

## Problema

A Check 6 ([`squads/sdd/agents/audit-agent.md`](../../../squads/sdd/agents/audit-agent.md), linha ~70) roda `git diff --name-only HEAD` e exige igualdade entre `{arquivos sujos na árvore}` e `{união dos files_changed[] dos dev packets}`, excluindo apenas `.agent-session/`. Qualquer sobra vira `orchestrator_edited_source` (blocker). O audit não tem **baseline** — uma "foto" do que já estava sujo antes da Fase 4 começar — então não distingue:

1. **Sujeira herdada do humano** (ex.: `.gitignore` mexido à mão antes da run) — não é responsabilidade da pipeline.
2. **Edição concorrente do humano durante a run** (o dev humano mexe em algo no meio da pipeline — comportamento legítimo) — também não é fraude.
3. **Fraude real** do orchestrator editando fonte fora do fluxo de `dev` dispatches — isto a Check 6 *deve* continuar pegando.

## Decisão de abordagem

Avaliadas 3 abordagens (pesquisa apoiada em Anthropic/Claude Code docs + literatura de attestation):

- **A — Worktree isolado por task** (recomendação oficial da Anthropic): limpo por construção, sem baseline. **Rejeitada** para este escopo: é reforma da Fase 4 inteira (gestão de worktree, merge de volta, reviewers/qa no mesmo worktree do dev, orchestrator não-confiável gerenciando merges). Desproporcional para um falso-positivo; fica como forte candidata a V2.
- **B — Baseline emitida por hook determinístico** *(escolhida)*: cirúrgica, mexe só no audit + 1 hook + extensão do guard. Honra o princípio de attestation.
- **C — Check 6 restrita ao `scope_files` declarado**: **rejeitada** por reabrir furo de segurança (orchestrator editaria fonte fora do scope e escaparia) — troca falso-positivo por falso-negativo.

**Princípio que fundamenta B (attestation / Root of Trust):** um componente não-confiável não pode medir a si mesmo. O orchestrator (LLM, já observado pulando etapas) não pode emitir a baseline. A medição vem de um **hook** — script shell que o harness executa, fora do controle do modelo.

**Simplificação confirmada no código:** o `guard-session-scope.py` (PreToolUse) já impede mecanicamente o orchestrator de escrever fonte fora de `.agent-session/`. Logo, o orchestrator **não consegue sujar a fonte em momento algum** — não existe vetor de "envenenar a baseline editando antes da captura". A captura precisa apenas ser **anterior ao primeiro `dev`** (questão de correção, não de segurança).

## Arquitetura — duas camadas

### Camada 1 — baseline automática (sempre, PM e HOTL)

Resolve o caso comum sem incomodar ninguém.

- **Gatilho:** hook `PreToolUse(Task)` (mesmo evento que o `guard` já intercepta). Dispara antes de cada dispatch; como o primeiro dispatch da pipeline é sempre um `dev`, a captura acontece imediatamente antes da primeira edição de fonte.
- **Idempotência por existência:** grava a baseline só se ela ainda não existe. Resume e restart **reusam** a baseline original e nunca recapturam (recapturar no restart absorveria as edições da run anterior como se fossem pré-existentes).
- **Conteúdo:** `git status --porcelain` → lista de paths já sujos no início.
- **Definição de "sujo" unificada:** a baseline e a Check 6 devem usar a **mesma** noção de modificado. A Check 6 hoje usa `git diff --name-only HEAD` (ignora untracked); o plano deve alinhar as duas (provável padronização em `git status --porcelain`), senão a subtração não bate.
- **Anti-adulteração:** a baseline mora em `.agent-session/<spec_id>/` num path que o `guard-session-scope` passa a tratar como **off-limits ao orchestrator** — exatamente como já protege `outputs/`. O hook (determinístico) grava direto no disco; o orchestrator-LLM fica impedido de reescrevê-la depois. Fecha a ressalva conhecida (hook garante "quem escreve primeiro", o guard garante "ninguém adultera depois").

**Consumo na Check 6:**
```
delta = {sujos agora} − {sujos na baseline}     # o que a pipeline introduziu
```
- Path no `delta` **sem** dev packet → continua `orchestrator_edited_source` (blocker). Anti-fraude intacto.
- Path na **baseline** sem dev packet → **isento** (não é finding).
- **Transparência:** a isenção é registrada no Output Packet (evidência + nota tipo `"N paths exempted as pre-existing (baseline)"`), espelhando o `excluded_subagents` do cost-report — surfaced, never silently dropped.

### Camada 2 — confirmação humana (só com humano presente)

Cobre o que a baseline não pega: edição concorrente do humano **durante** a pipeline (arquivo não estava na foto inicial), e baseline ausente.

- **Onde vive:** no **orchestrator, no handoff** — não no audit. O audit-agent é read-only, Haiku, singleton, e a Fase 4 roda sem humano no meio; ele continua emitindo `blocked` mecânico e terminal. É o orchestrator, ao receber esse `blocked`, que decide se há humano pra consultar.
- **Mecanismo:** para cada path órfão (`orchestrator_edited_source`), o orchestrator roda `git diff <arquivo>`, mostra o diff e pergunta via `AskUserQuestion`: *"Este arquivo foi modificado, mas nenhum agente dev o declarou — ou foi você manualmente, ou algo editou fora do fluxo. Você reconhece esta mudança como sua?"*.
  - **Confirma →** desbloqueia e **registra a autorização humana** no handoff.
  - **Nega →** handoff de falha (bypass real).
- **Espelha o GAP B:** o orchestrator nunca se auto-certifica, mas o humano (autoridade) pode autorizar via `AskUserQuestion` uma vez. Padrão já existente e validado no framework.
- **PM autônomo (sem humano):** o caminho não abre → fica só a Camada 1 + bloqueio fail-safe.
- **Honestidade da pergunta é a defesa:** a Camada 2 é um caminho de desbloqueio, então um orchestrator fraudulento poderia tentar induzir um "sim". A proteção não é técnica — é mostrar o diff completo e nomear o risco, para o humano decidir com informação real.

## Fronteira — o que a Camada 2 pode e não pode desbloquear

Distinção central, **não negociável**:

- **Bloqueio de ambiente (desbloqueável por humano):** apenas `orchestrator_edited_source` (propriedade de arquivo). É o único bloqueio que depende de um fato que **só o humano conhece** (você mexeu naquele arquivo, fora da pipeline).
- **Bloqueio de falha interna (terminal, vai pro Spec C ou `--restart`):** `role_mismatch`, `pipeline_stage_skipped`, `ac_not_validated`, `schema_violation`, `missing_output_packet`, `orphan_output_packet`. Uma pergunta não faz o `qa` ter rodado nem o packet existir. Se a Camada 2 desbloqueasse estes, viraria um botão de pular o audit e destruiria a issue #1.

Em particular, `missing_output_packet`/`orphan_output_packet` (packets que não persistiram, manifesto corrompido) **continuam terminais** — são o Spec C, e devem ser consertados na raiz, nunca mascarados pela Camada 2.

## Casos de borda

1. **Baseline ausente** (feature antiga, hook não rodou): Check 6 cai no comportamento atual (compara árvore inteira, sem isenção) e registra nota de baseline ausente. Fail-safe — bias toward blocked. Com humano presente, a Camada 2 ainda pode destravar os paths reconhecidos.
2. **Comparação por path, não por conteúdo:** se um arquivo já estava sujo e um dev o edita, o path inteiro fica isento (perde verificação de ownership só dele). Mantido por-path (consistente com a Check 6 atual); hash seria precisão que não compensa. Risco baixo — o orchestrator não explora isso (guard o impede de editar fonte).

## O que não muda

- O orchestrator continua proibido de editar fonte (`guard-session-scope`).
- `blocked` continua terminal; o orchestrator não pode re-disparar o audit pra flipar o veredito.
- Todos os blocker_kinds exceto `orchestrator_edited_source` continuam terminais.
- Anti-fraude da issue #1 intacto: fonte sujada **durante** a pipeline sem dev packet continua sendo `bypass_detected`.

## Superfície de implementação (para o plano)

1. **Hook novo** (`capture-baseline.py` ou similar), `PreToolUse(Task)`, scope `orchestrator`, idempotente, grava `git status --porcelain` no path protegido. Registrado no deploy junto dos demais hooks.
2. **`guard-session-scope.py`:** estender a lista off-limits ao orchestrator para incluir o path da baseline.
3. **`audit-agent.md` Check 6:** ler a baseline, computar `delta`, isentar com registro de evidência; tratar baseline ausente (fail-safe + nota); unificar a definição de "sujo" com a baseline.
4. **`orchestrator/SKILL.md` (handoff, step 8/pós-audit):** Camada 2 — para `orchestrator_edited_source`, se humano presente, mostrar `git diff` + `AskUserQuestion`; confirmar → desbloquear + registrar autorização; negar → falha. Restringir estritamente a `orchestrator_edited_source`.
5. **Cópia empacotada** (`packages/cli/components/sdd/...`): replicar as mudanças de fonte.
6. **Testes:** cobertura para sujeira pré-existente isentada; edição concorrente do humano destravada via Camada 2; fraude real (fonte sujada na pipeline sem packet) ainda bloqueada; baseline ausente fail-safe; outros blocker_kinds não desbloqueáveis pela Camada 2.
