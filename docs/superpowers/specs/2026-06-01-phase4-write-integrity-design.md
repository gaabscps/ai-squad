# Integridade de escrita da Fase 4 — packets que não persistiram + manifesto corrompido

**Data:** 2026-06-01
**Status:** design aprovado (brainstorming), pendente de plano de implementação
**Escopo:** Spec C de 3 (ver "Contexto"). Uma spec, dois componentes: integridade do Output Packet (C-1) e integridade do `dispatch-manifest.json` (C-2).

## Contexto

A mesma run real no repo consumidor `ai-squad-os` (FEAT-001) que originou os Specs A e B expôs **3 problemas independentes** do framework, divididos em 3 specs:
- **Spec A:** audit confunde sujeira pré-existente com fraude do orchestrator (baseline). Ver [`2026-06-01-audit-baseline-design.md`](2026-06-01-audit-baseline-design.md).
- **Spec B:** `cost-report` exclui 100% do custo de implementação quando a allow-list não bate.
- **Spec C (este doc):** dois artefatos de disco da Fase 4 não sobreviveram à run.

A Camada 2 do audit (Spec A) manda **explicitamente** `missing_output_packet` / `orphan_output_packet` para este Spec C, em vez de mascará-los — eles continuam blockers terminais, e devem ser consertados na raiz aqui.

Os dois sintomas observados:

1. **Output Packets de reviewer não persistiram.** Dois packets (`d-T-008-cr-l2`, `d-T-009-cr-l1`) não foram gravados em disco na 1ª execução, provavelmente porque a anomalia de plataforma "safety classifier unavailable" (soluço da Anthropic, server-side) matou o subagent no meio. O orchestrator teve que re-disparar via `Task` manualmente. Um dispatch pode "terminar" sem o packet aterrissar, e nada o detecta cedo.
2. **`dispatch-manifest.json` corrompeu.** Uma edição do próprio orchestrator duplicou conteúdo e deixou um fragmento JSON órfão. O manifesto era manipulado "na mão" pelo orchestrator (um LLM usando a ferramenta de edição), sem helper de escrita atômica.

## Decisão de fronteira: uma spec, dois componentes

Avaliado se C deveria rachar em duas specs (o eixo "atores diferentes": o packet é escrito pelo *subagent* e verificado pelo *orchestrator*; o manifesto é escrito *só pelo orchestrator*).

**Decisão: uma spec só.** Critério de coesão — os dois consertos se encontram no mesmo arquivo (`orchestrator/SKILL.md`), usam o mesmo conceito (escrita que não corrompe), e têm a mesma fronteira de audit (ambos viram blockers terminais hoje). O eixo "ator diferente" descreve *onde o byte é escrito*, não se é uma unidade de trabalho coerente.

**Alternativa rejeitada (duas specs):** dobraria a burocracia — dois planos, dois PRs — sem isolar risco real, já que os dois se encontram no mesmo `SKILL.md`. A diferença de perfil de risco (manifesto = mecânico trivial; packet = mexe no loop de dispatch e na anomalia de plataforma) é absorvida no *plano*, como dois grupos de tasks independentes — separar planos não exige separar specs.

## Princípio que fundamenta o desenho (attestation, herdado do Spec A)

**Um componente não-confiável não pode se auto-medir nem manipular seu próprio estado de forma frágil.** No Spec A, isso virou: o orchestrator-LLM não emite a própria baseline de auditoria (vem de um hook determinístico). Aqui o mesmo princípio aparece duas vezes:

- O orchestrator-LLM **não deve manipular JSON na mão** (C-2): a manipulação sai das mãos do modelo e vai para um script determinístico com garantia atômica.
- A **detecção** de packet faltante **não pode ser uma instrução pulável** pelo orchestrator (C-1): vira hook determinístico. A **ação** (re-dispatch) fica no orchestrator, porque só o LLM dispara `Task` — espelho exato da arquitetura de duas camadas do Spec A (medição determinística + ação a cargo de quem pode agir).

## Componente C-1 — integridade do Output Packet

### O mecanismo da falha

Já existe um hook `SubagentStop` ([`verify-output-packet.py`](../../../squads/sdd/hooks/verify-output-packet.py)) que **bloqueia** um subagent da Fase 4 de terminar se seu Output Packet estiver faltando ou inválido. No caminho normal, um reviewer **não consegue** "terminar limpo" sem ter gravado o packet.

Mas um hook `SubagentStop` só roda quando há um término *limpo* — o subagent decide encerrar e o harness chama o hook. Quando a plataforma **aborta o subagent no meio** (o que "safety classifier unavailable" provoca: a requisição é morta server-side), não há término limpo: o subagent morre antes de gravar o packet, e o `SubagentStop` **nem dispara**. O `Task` retorna ao orchestrator, o packet nunca aterrissa, e só o audit no fim percebe.

Quem **sobrevive** à morte abrupta do subagent é o orchestrator. Logo, a verificação "o packet existe e é válido?" tem de acontecer no orchestrator, logo após cada `Task` retornar — é a única camada que enxerga esse caso.

### Defesa em profundidade — três camadas (duas já existem)

1. **`SubagentStop` (já existe):** barra o término *limpo* sem packet. Cobre o caso em que o subagent escolheu parar.
2. **`PostToolUse(Task)` (NOVO):** detecta o caso que a Camada 1 não alcança — morte abrupta, em que o `SubagentStop` nem dispara. Surfacea a lacuna; o orchestrator re-dispara (≤2). É aqui que a anomalia transitória se **auto-cura** sem derrubar a run.
3. **Audit no fim (já existe, terminal):** se algo escapou das duas, `missing_output_packet` continua `blocked` terminal — a rede de segurança final que o Spec A mandou pra cá.

O ganho da Camada 2 é **cura precoce**: transforma um soluço da plataforma — que hoje derruba a run inteira no audit — num retry barato e silencioso. A rede terminal permanece intacta.

### Detecção — hook `PostToolUse(Task)` (determinística, não-pulável)

- **Gatilho:** `PostToolUse(Task)`, escopo orchestrator. Dispara na sessão do orchestrator, depois que cada `Task` retorna — instante em que o packet ou está no disco ou não está. Em fan-out (N `Task` num turno), dispara uma vez por `Task`, conferindo cada dispatch individualmente.
- **Mecânica:** lê o `dispatch_id` do `tool_input` (está no prompt do Work Packet). Reusa os helpers `find_active_session` / `resolve_project_root` (já presentes nos outros hooks). Checa `outputs/<dispatch_id>.json` via `verify-output-packet.py --check-only` (modo CLI já existente).
- **Saída:** se faltar ou for inválido, emite `additionalContext` nomeando o `dispatch_id` e a lacuna. O hook **não bloqueia** o `Task` (o `Task` "terminou" do ponto de vista da ferramenta; o que falta é o artefato). A garantia dura vem das três camadas, não de um block aqui.
- **Faltante e inválido disparam a mesma resposta.** Ambos só chegam ao `PostToolUse` em morte anormal (o `SubagentStop` já barra término limpo com packet inválido). Logo, ambos significam "este dispatch não entregou artefato usável → re-dispara"; não vale distinguir.

### Conserto — re-dispatch pelo orchestrator (prosa no `SKILL.md`)

Só o LLM dispara `Task`. Ao receber o aviso do hook, o orchestrator re-dispara o **mesmo papel** para a **mesma task**, com `dispatch_id` novo (novo loop), e registra a tentativa.

- **Orçamento próprio:** `task_states[T-XXX].packet_retries`, teto `packet_retry_max=2` por dispatch, **separado** de `review_loops_max`.
  - **Critério:** o que falhou foi a *entrega do artefato*, não o *trabalho*. Contar isso como loop de revisão puniria a task por um soluço de infra — a revisão nem aconteceu; 3 anomalias seguidas escalariam a task ao humano sem ela ter sido revisada de fato.
  - **Alternativa rejeitada (reusar `review_loops_max`):** mais simples (zero contador novo), mas queima budget de revisão com falha de plataforma.
  - **Alternativa rejeitada (retry ilimitado):** uma falha persistente (não-transitória) viraria loop infinito e gasto descontrolado.
- **Teto 2:** na run real um único re-disparo resolveu; 2 dá margem para uma anomalia teimosa sem virar loop infinito. Estourou → `blocked` terminal `blocker_kind: missing_output_packet` (a fronteira terminal já definida no Spec A).
- **Estado:** o contador mora no `session.yml` (`task_states`), junto de `loops`. Consistência — o orchestrator já é sole-writer do `session.yml` via tmp+rename; não introduz novo lugar de estado.

### Re-dispatch é uniforme (inclusive `dev`)

Re-dispara qualquer papel, inclusive `dev` (que edita fonte).

- **Critério:** o framework **já** re-dispara o `dev` a cada loop de revisão — re-disparar dev é operação normal; ele é construído para reler o estado atual e continuar (TDD; testes barram regressão). Uma edição-pela-metade deixada por um dev morto no meio é pega rio abaixo pelos reviewers, pelo qa e pela baseline do Spec A. A morte do dev no meio é rara; tratar como caso normal de re-dispatch é proporcional.
- **Alternativa rejeitada (dev escala na hora):** mais conservadora, mas transforma um soluço de plataforma no dev em parada da pipeline mesmo quando o re-disparo seria trivial; o risco que ela evita já está coberto pelas barreiras rio abaixo.

## Componente C-2 — integridade do `dispatch-manifest.json`

### O mecanismo da falha

O orchestrator (um LLM) editava o manifesto "na mão", usando a ferramenta de edição de texto para costurar o JSON. Um LLM editando JSON é frágil por natureza — não tem a garantia de coerência sintática de um `json.dump`. Numa edição, duplicou conteúdo e deixou um fragmento órfão.

### O helper atômico já existe

[`_pm_shared.py:299`](../../../squads/sdd/hooks/_pm_shared.py) define `atomic_manifest_mutate`: lê o manifesto, aplica uma mudança, grava num arquivo temporário e renomeia por cima (`os.replace`) — operação atômica do FS (ou o arquivo novo inteiro, ou o antigo inteiro; nunca um meio-termo corrompido). Usa ainda um arquivo-cadeado sidecar (`.lock`) para serializar escritas concorrentes. É testado, mas **ninguém o usa para o `dispatch-manifest.json`**.

### Conserto — CLI dedicado de append atômico

- **CLI novo** (ex.: `manifest_append.py`) que envelopa `atomic_manifest_mutate`. O orchestrator o chama via Bash passando o JSON do dispatch; o script faz o read-modify-write atômico.
- **O orchestrator nunca mais edita o manifesto na mão.** A manipulação de JSON sai das mãos do LLM.
- **Forma escolhida — CLI, não python inline nem hook automático:**
  - **Rejeitado python inline no SKILL:** o bloco embutido na prosa é justamente o que o LLM tende a variar/errar.
  - **Rejeitado hook automático** (`PostToolUse(Task)` gravando o manifesto sozinho): para o manifesto o orchestrator já sabe a entrada exata na hora do dispatch, então um CLI explícito é mais simples que um hook que teria de reconstruir a entrada. (Contraste com C-1, onde o hook se justifica porque a *detecção* precisa ser não-pulável.)
  - **Escolhido CLI dedicado:** interface estável, testável isoladamente; o `SKILL.md` referencia um comando fixo em vez de descrever costura de JSON.
- **Trade-off:** o orchestrator ganha uma dependência de comando externo (rodar o helper via Bash) em vez da autonomia de só escrever o arquivo — mas é exatamente essa autonomia que causou o bug.

## O que não muda

- O orchestrator continua proibido de editar fonte; suas escritas seguem restritas a `.agent-session/<spec_id>/` (`guard-session-scope.py`).
- `blocked` do audit continua terminal; o orchestrator não re-dispara o audit para flipar o veredito.
- Todos os `blocker_kind` exceto `orchestrator_edited_source` (Spec A) continuam terminais — inclusive `missing_output_packet` / `orphan_output_packet`.
- Anti-fraude da issue #1 intacto.
- A Camada 1 (`SubagentStop`) e a Camada 3 (audit) são preservadas; C-1 só **adiciona** a Camada 2 entre elas.

## Casos de borda

1. **Anomalia teimosa (> 2 falhas no mesmo dispatch):** estoura `packet_retry_max` → `blocked` terminal `missing_output_packet`. Fail-safe; recuperação via `--restart` + revisão humana.
2. **`dev` morto após editar parte dos arquivos:** re-dispatch uniforme retoma; inconsistências são pegas pelos reviewers/qa/baseline rio abaixo (risco aceito, ver C-1).
3. **Orchestrator ignora o aviso do hook:** a Camada 3 (audit, terminal) ainda barra `missing_output_packet`. O hook garante *consciência* precoce; a rede terminal garante *segurança*.
4. **Manifesto inexistente ao chamar o CLI:** `atomic_manifest_mutate` levanta `FileNotFoundError`; o CLI deve falhar com mensagem clara (o manifesto inicial é escrito no step 1b antes de qualquer append).
5. **`--resume`:** o `packet_retries` por task é preservado junto do restante de `task_states`; o CLI de append continua funcionando sobre o manifesto existente (não reescreve `expected_pipeline`).

## Superfície de implementação (para o plano)

1. **Hook novo** (`verify-dispatch-packet.py` ou similar), `PostToolUse(Task)`, escopo orchestrator: lê `dispatch_id` do `tool_input`, checa o packet via `verify-output-packet.py --check-only`, emite `additionalContext` se faltar/inválido. Não bloqueia.
2. **CLI novo** (`manifest_append.py`): envelopa `atomic_manifest_mutate`; recebe o JSON do dispatch via argumento/stdin; append atômico.
3. **`orchestrator/SKILL.md`:**
   - step 1b: substituir "escreva o manifesto" por "chame `manifest_append.py`"; o orchestrator nunca mais edita o manifesto na mão.
   - steps 3/4: ao ver o aviso do hook, re-disparar o mesmo papel (novo `dispatch_id`/loop), incrementar `task_states[T-XXX].packet_retries`; teto 2; estourou → `blocked` terminal.
   - registrar o hook novo no bloco `hooks:` do frontmatter.
4. **`dispatch-manifest.md`:** trocar a regra de append manual pela invocação do CLI.
5. **`session.yml` schema:** adicionar `packet_retries` em `task_states[T-XXX]` (inicializa 0; preservado em `--resume`).
6. **Preflight do `SKILL.md`:** incluir os arquivos novos na checagem de hooks/CLI instalados.
7. **Registro no deploy:** registrar o hook novo e o CLI junto dos demais.
8. **Cópia empacotada** (`packages/cli/components/sdd/...`): replicar as mudanças de fonte.
9. **Testes:** packet faltante re-disparado e recuperado; packet inválido tratado igual a faltante; estouro de `packet_retry_max` → `blocked` terminal; dev re-disparado com edição parcial no disco; append atômico do manifesto não corrompe sob escrita repetida; manifesto inexistente falha claro; `--resume` preserva `packet_retries`; outros `blocker_kind` seguem terminais.
