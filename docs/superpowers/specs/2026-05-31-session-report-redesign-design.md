# Design — Redesenho do session report (visual, narrativo, orientado a code review)

> Status: aprovado em brainstorm (2026-05-31). Próximo passo: writing-plans.
> Arquivo afetado: [`squads/sdd/hooks/session_report.py`](../../../squads/sdd/hooks/session_report.py).
> Reaproveita: [`squads/sdd/hooks/cost_report.py`](../../../squads/sdd/hooks/cost_report.py) (sem mudanças).
> Testes: [`squads/sdd/hooks/__tests__/test_generate_session_report.py`](../../../squads/sdd/hooks/__tests__/test_generate_session_report.py).

## Problema

O report HTML gerado ao fim do pipeline (Phase 4) é pouco legível para um humano que precisa
decidir, pós-pipeline autônomo, **se está tudo certo** e, quando for ler código, **chegar com
contexto**. Cinco problemas concretos (validados no report do FEAT-003):

1. **Sem veredito.** A 1ª seção é "Cost". Não há resposta rápida para "o pipeline terminou bem?
   quantas tasks passaram? tem algo blocked/escalate? quantos ACs cobertos?".
2. **Tabela plana.** Os ~59 dispatches ficam numa tabela única ordenada por `dispatch_id`. Para
   entender uma task é preciso caçar linhas `d-T-002-*` espalhadas; não há narrativa por task.
3. **Sem timeline.** O ciclo dev→review→fix→qa existe nos dados (loops `l1`/`l2`) mas é invisível:
   a ordem é alfabética, não conta a história de como cada task evoluiu.
4. **Findings vazios + diff solto.** O template lê `message`/`ac_ref`, campos que o finding **não
   tem** — o texto real está em `rationale` (+ `file`/`line`/`evidence_ref`). Resultado: findings
   aparecem só com a severidade. E o diff é um bloco único no fim, sem ligar finding↔arquivo↔trecho.
5. **Pouco visual.** Só texto e tabelas padrão. Falta gráfico/timeline/fluxograma que aliviem a
   leitura e ajudem o entendimento.

## Objetivo e audiência

Audiência única: **o humano revisor**, depois de um pipeline autônomo. O report é a ponte entre
"o pipeline terminou" e "aprovo / vou ler o código". Sucesso = o revisor decide olhando só o
report, e quando precisa do código já sabe onde olhar e por quê.

## Decisões fechadas no brainstorm

| Decisão | Escolha | Por quê / alternativa rejeitada |
|---|---|---|
| Estrutura | **Dashboard no topo + um card por task com timeline interna** | Resolve as 3 dores juntas. Timeline-global e Kanban-por-status foram rejeitadas como estrutura principal — viram elementos *dentro* desta (faixa de status = mini-kanban; timeline do loop = timeline em miniatura). |
| Render dos visuais | **SVG inline + HTML `<details>` nativo** | Mantém o report self-contained e offline (princípio do stdlib puro). CDN (Chart.js/Mermaid) rejeitado: exige internet e adiciona dependência externa. |
| Timeline | **Lógica do ciclo (ordem dev→review→qa por loop)**, sem horário | Packets não têm timestamp; e o que importa é o raciocínio/história, não o relógio (confirmado pelo usuário). |
| Narrativa por task | **Costura determinística dos `summary` existentes**, não geração por LLM | Fiel ao que os agents escreveram, reproduzível, sem custo nem dependência de modelo. |
| Dashboard de custo/status | **Mantido como validado** (KPIs + donut + barra) | Aprovado visualmente; não mexer. |

## Arquitetura da solução

Tudo dentro de `session_report.py` (stdlib puro). A função pública e a assinatura **não mudam**:
`build_html_report(session_dir, task_id="", diff_provider=None)` continua retornando `str` ou
`None` (guard: sem `costs/` → `None`). O hook `generate-session-report.py` não muda.

### Fluxo de dados

```
packets (outputs/*.json)
   ├─ task-scoped (têm task_id)  ─→ _group_by_task ─→ {T-001: [...], T-002: [...]}
   └─ pipeline-scoped (audit-agent/committer, sem task_id) ─→ bucket "integridade"

cost_report.build_cost_report(session_dir)  ─→ KPIs de custo (reuso, sem mudança)
```

### Componentes (funções novas/alteradas)

- **`_group_by_task(packets)`** — agrupa por campo `task_id`. Packets sem `task_id` vão para o
  bucket pipeline (integridade). Dentro de cada task, ordena por loop.
- **`_loop_of(dispatch_id)`** — extrai o nº do loop de `d-T-002-cr-l1` → `1`. Único uso do
  `dispatch_id` (o agrupamento usa `task_id`, que já existe no packet).
- **`_task_verdict(task_packets)`** — veredito final da task: deriva do `qa` se presente, senão do
  último loop dos reviewers/dev. Mapeia para `done | needs_review | blocked | escalate`.
- **`_split_findings(task_packets)`** — separa findings **resolvidos** de **abertos**. Heurística:
  por (task, família-reviewer), o último loop é o que vale; findings de loops anteriores =
  resolvidos; findings do último loop contam como abertos apenas se o status final ≠ `done`.
- **`_finding_text(finding)`** — **corrige o bug dos findings vazios**: usa `rationale` como texto,
  `severity` + `dimension` para o rótulo, e `file:line` ou `evidence_ref` ou `ac_ref` como
  referência (o que existir). Fallback para `summary` do packet se `rationale` ausente.
- **`_narrative(task_packets)`** — monta a frase-história costurando os `summary` existentes:
  dev L1 → (se houve loop ≥2) "reviewers apontaram N achados" → dev L2 → qa. Determinístico.
- **`_timeline_svg(task_packets)`** — desenha os nós do ciclo (role, loop, status) em SVG/HTML com
  cores por status, e a etiqueta "N loops até passar" / "divergência L1 reconciliada".
- **`_donut_svg(status_counts)`** e **`_cost_bar(rep)`** — SVG/CSS inline para o dashboard.
- **`_dashboard(rep, tasks, open_count, ac_cov)`** — os 4 KPIs validados: Veredito · Donut de
  status · Custo (barra) · Findings abertos + cobertura de AC.
- **`_integrity_section(pipeline_packets)`** — NOVA faixa: resultado do `audit-agent`
  (reconciliação, orchestrator-bypass). Ancora a confiança no resto do report.
- **`_task_card(task_id, task_packets, diff_provider)`** — o `<details>` por task: header
  (T-XXX · badge de veredito · título · arquivos) → narrativa → timeline → findings
  (resolvido esmaecido/riscado, aberto em vermelho) → diff do(s) arquivo(s) colapsável → ACs.

### Ordenação dos cards

Abertos/escalados/blocked primeiro, depois `needs_review`, depois `done`; dentro de cada grupo,
`task_id` ascendente. Foco no que exige atenção do revisor sem perder a ordem natural.

### Estrutura final do HTML (topo → fim)

1. Header (spec_id, contagem de tasks/subagents).
2. **Dashboard** — 4 KPIs (mantido como validado).
3. **Integridade do pipeline** — faixa do audit-agent (nova).
4. **Cards por task** — ordenados por atenção; fechados por padrão (`<details>`).
5. **Handoff** — conteúdo de `handoff.md` em `<details>` colapsável (texto puro, como hoje).

## Testes

Estender `test_generate_session_report.py`:

- **Regressão do bug de findings:** packet com finding só com `rationale` (sem `message`) → o texto
  do `rationale` aparece no HTML.
- **Agrupamento:** packets de várias tasks → cada task vira um card; packets sem `task_id`
  (audit-agent) → faixa de integridade, não card.
- **Resolved vs open:** task com finding em `cr-l1` e `cr-l2` done → finding marcado resolvido;
  task cujo último loop ≠ done → finding aberto e contado no KPI.
- **Veredito/donut:** contagem de status correta no dashboard.
- **Guard:** sem `costs/` → retorna `None` (comportamento atual preservado).
- **Self-contained:** o HTML não contém `<script src=` nem `http`-CDN (garante offline).

## Não-objetivos (YAGNI)

- Nada de JS de terceiros / CDN / build step.
- Sem timestamps reais (timeline é lógica).
- Sem persistência ou estado entre runs.
- Não altera o formato dos Output Packets nem o `cost_report` — o report só **lê**.
- Sem geração de texto por LLM — narrativa é costura de strings.

## Compatibilidade

Assinatura pública e contrato de retorno preservados; o hook chamador não muda. A mudança é
internamente substancial mas externamente transparente.
