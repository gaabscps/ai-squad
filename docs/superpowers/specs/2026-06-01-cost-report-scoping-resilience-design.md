# Cost-report scoping resiliente — não zerar custo de implementação em silêncio

**Data:** 2026-06-01
**Status:** design aprovado (brainstorming), pendente de plano de implementação
**Escopo:** Spec B de 3 (ver "Contexto"). Trata só a subcontagem silenciosa do `cost-report` quando o scoping exclui demais.

## Contexto

Uma run real no repo consumidor `ai-squad-os` (FEAT-001, 64 dispatches, 22/22 ACs e 265 testes verdes) expôs **3 problemas independentes** do framework, divididos em 3 specs:

- **Spec A** (`2026-06-01-audit-baseline-design.md`): audit confunde sujeira pré-existente com fraude do orchestrator.
- **Spec B (este doc):** `cost-report` exclui o custo de implementação inteiro quando o scoping não bate, e apresenta `$0` como se fosse válido.
- **Spec C:** integridade de escrita da Fase 4 (Output Packets de reviewer que não persistiram + `dispatch-manifest.json` corrompido por edição não-atômica).

## Problema

O `cost-report` da run mostrou **total $6,55** quando o custo real era **~$57,62** — quase **9× de subcontagem**, e sem nenhum alarme (saiu uma nota de rodapé fraca, mas o `$0` foi apresentado como resultado válido). O que sumiu:

| Fase | Reportado | Real |
|---|---|---|
| Planning | $6,55 | $7,93 |
| Orchestration | **$0,00** | $36,39 |
| Implementation (66 subagents) | **$0,00** | $13,30 |
| **Total** | **$6,55** | **~$57,62** |

### Causa-raiz real — uma corrida leitura-antes-da-escrita

A hipótese inicial (allow-list autoritativa presente mas sem fallback, em `_agent_in_scope`) **não foi o que aconteceu**. Os dados da run mostram outra coisa:

- A allow-list `implementation_sessions:` **não existe** no `session.yml` da run — nunca foi gravada. Logo o report caiu no **fallback de cross-validação de disco** (`allowed is None`), e foi *ele* que excluiu os 66 subagents.
- O fallback mantém um agent file só se o `parent` dele (a sessão que o despachou) também tiver gravado um `session-*.json` na pasta `costs/` — o conjunto `present_sessions`.
- **A marca de proveniência da própria sessão do orchestrator é escrita por hooks de `Stop`**, que só disparam quando a sessão termina:
  - `capture-session-cost` grava o `session-<orchestrator>.json` (carrega o custo de orchestration **e** é o que valida os subagents da implementação).
  - `register-impl-session` grava a allow-list autoritativa.
- Mas o **report é gerado no handoff, enquanto o orchestrator ainda está vivo** — *antes* desses hooks de `Stop`. Linha do tempo da run (mtimes; TZ local UTC-3):

  | Hora | Evento |
  |---|---|
  | orchestrator (`47105724`) despacha os 66 subagents | parents gravados em `costs/agent-*.json` |
  | **report gerado** → `cost-report.json` + `handoff.md` | `present_sessions` ainda só tem as sessões de planning |
  | 31 min depois | só agora aparece `session-47105724.json` (com os $36,39 de orchestration) |

No instante do report, a sessão do orchestrator é **invisível para os dois mecanismos de scoping ao mesmo tempo** — a allow-list (ausente) e o fallback (`present_sessions` ainda não a contém). Por isso os 66 subagents que ela despachou falham o teste de escopo, e orchestration **também** fica $0 (o file que guarda esse custo não existia ainda).

### Onde nasce no código

- `squads/sdd/hooks/cost_report.py`, `_agent_in_scope` (~125-140) e o consumo em `build_cost_report` (~272): o fallback exclui qualquer agent cujo parent não esteja em `present_sessions`, e `present_sessions` depende de arquivos escritos tarde (no `Stop`).
- `squads/sdd/hooks/register-impl-session.py`: a allow-list autoritativa é gravada num **`Stop` hook** — tarde demais, depois do report.

## Decisão de abordagem — três camadas

Objetivo: tornar o scoping resiliente **sem reabrir o GAP A** (cli 0.9.0), em que o read-scoping nunca pode inflar custo com contaminação de outro projeto/feature.

### Camada 1 — conserto de raiz: registrar a sessão na ENTRADA, não na saída

A proveniência da sessão do orchestrator precisa existir **antes** do report. A correção:

- **Mudar o gatilho do `register-impl-session` de `Stop` para `PreToolUse(Task)`** — que dispara antes de cada dispatch e, portanto, antes do report. O `session_id` do orchestrator está disponível no payload do evento (o mesmo evento que o `guard-session-scope` já intercepta).
- Continua **idempotente** (grava cada id uma vez) e **acumulativo** (resume: cada sessão de orchestrator que despacha se auto-registra no seu primeiro dispatch). O caso "sessão travou e não registrou no Stop" deixa de existir.
- **Remover a trava "só registra se `dispatch-manifest.json` existir":** no primeiro dispatch o manifesto ainda pode não existir; o próprio fato de estar despachando um `Task` é o sinal de que o pipeline rodou.

**Por que modificar o hook existente** (e não criar um novo nem juntar com o hook do Spec A): ele já faz exatamente a coisa certa — gravar o id da sessão; o único defeito é *quando*. Mexer no que existe é mais limpo que somar um terceiro hook no mesmo evento. **Não foi fundido ao hook do Spec A** de propósito — Spec A e Spec B devem permanecer independentes (a mesma razão por que a opção "ancorar no timestamp da baseline do Spec A" foi rejeitada na Camada 3).

**Alternativas rejeitadas para a âncora de raiz:**
- *Auto-âncora: derivar a sessão dos próprios agent files* — heurística (qual é o parent "dominante"?), mexe na borda do GAP A. Fica como ingrediente da Camada 3, não como âncora primária.
- *Regerar o report no `Stop` do orchestrator* — conserta o timing mas briga com o handoff, que é emitido antes do `Stop`; trocaria uma corrida por outra.

### Camada 2 — detecção: piso de sanidade sem falso-positivo

No `build_cost_report`, depois de varrer `costs/`: o piso dispara quando o report **manteve 0 subagents mas excluiu N>0** (`subagent_count == 0 and excluded_subagents > 0`). É exatamente o formato do FEAT-001 (manteve 0, excluiu 66).

Escolhido em vez de um percentual porque é **à prova de falso-positivo**: contaminação real do GAP A sempre deixa *alguns* agents legítimos de pé (`subagent_count > 0`), então nunca cai aqui. O piso roda independente de qual caminho excluiu demais — vale tanto pro caminho da allow-list quanto pro fallback de disco.

### Camada 3 — reação: recuperação segura, e falha alto se ambíguo

Quando o piso dispara, o report **não pode apresentar $0 como válido**. Ele tenta recuperar; se não der com segurança, dá alarme.

**Critério de recuperação (opção A — dupla confirmação):**
- **Recupera** se: os agents excluídos vêm de **uma sessão dominante única** (assinatura de um run de orchestrator, não de contaminação heterogênea) **E** o `dispatch-manifest.json` existe com `actual_dispatches` não-vazio (testemunha de que um pipeline real rodou nesta feature). Inclui os custos de volta e registra nota tipo `"recovered N subagents (dominant cluster + manifest witness)"`.
- **Falha alto** se: origens espalhadas sem dominante (contaminação real plausível), ou sem manifesto. Aí: flag dedicada `scoping_suspect: true`, **WARNING** gritante no `render_markdown` (não a nota de rodapé fraca de hoje), `complete: false`, e `implementation_cost_usd` não é apresentado como `0.0`-válido (representado como desconhecido).

**Por que opção A (e não as alternativas):**
- *Nunca apresentar $0 (alarme duro, sem recuperação)*: seguro, mas joga fora custo recuperável que está no disco.
- *Só subir a nota para WARNING*: deixa o humano com um report gritando mas ainda sem número útil.
- A opção A recupera o número quando há **dupla confirmação** de que é deste projeto, e só desiste (alarme) quando recuperar seria chute — coerente com o valor central (não somar custo errado), errando para o lado cauteloso. O alarme é barato: o humano olha.

**Por que o join preciso por id não é possível:** o `dispatch-manifest.json` lista `dispatch_id`/`task_id`/`role`, mas **não** o `agent_id` nem o `session_id` do subagent. Logo a recuperação se ancora em *clustering de parent* + *manifesto como testemunha de contagem*, não num join por id. (Adicionar `agent_id`/`session_id` ao manifesto tornaria a recuperação precisa — candidato a melhoria futura, fora do escopo deste spec.)

## O que NÃO muda (invariantes)

- **GAP A intacto:** a recuperação só inclui o que tem dupla confirmação de ser desta feature; nunca soma contaminação de fora. Na dúvida, alarme. O write-side já escopa a captura ao slug do projeto, então arquivo de outro projeto nem entra em `costs/`.
- **Projeto-agnóstico:** nenhum nome de projeto, convenção local ou skill de outro repo entra no código.
- O fallback de disco e a allow-list autoritativa continuam funcionando como hoje no caminho feliz; a Camada 1 só faz a allow-list existir a tempo.
- `complete` continua exigindo `subagent_count > 0` e nenhum modelo unpriced.

## Casos de borda

1. **Feature antiga sem manifesto** (run anterior a este conserto): a opção A não recupera (falta a testemunha de contagem) → cai no alarme alto. Aceito: é raro, e o alarme ainda protege o usuário de ver um `$0` falso.
2. **Múltiplos clusters comparáveis entre os excluídos:** tratado como ambíguo → alarme. Não tentamos adivinhar qual é "este run".
3. **Refinamento do critério "dominante" / "ambíguo":** o limiar exato (quão dominante um cluster precisa ser; como tratar stragglers de 1 agent) fica como detalhe de implementação no plano. Se aparecer um caso real que o critério não cobre bem, é assunto de uma sessão própria — não bloqueia este spec.

## Superfície de implementação (para o plano)

1. **`squads/sdd/hooks/register-impl-session.py`:** trocar gatilho `Stop` → `PreToolUse(Task)` (frontmatter do orchestrator Skill + `claude-hooks.json`/`cursor-hooks.json`); remover a trava do manifesto; manter idempotência e acúmulo; manter fail-open.
2. **`squads/sdd/hooks/cost_report.py`:** piso de sanidade (`subagent_count == 0 and excluded > 0`); recuperação opção A (clustering de parent + manifesto); flag `scoping_suspect`; `implementation_cost_usd` não-`0.0`-válido quando suspeito; WARNING em `render_markdown`.
3. **`squads/sdd/skills/orchestrator/SKILL.md` (handoff):** não alegar custo quando `scoping_suspect: true`.
4. **Cópia empacotada** (`packages/cli/.claude/hooks/...`): replicar as mudanças de hook e de `cost_report.py`.
5. **Testes:**
   - bug do FEAT-001 não nasce mais (allow-list presente a tempo via `PreToolUse(Task)`);
   - piso dispara e **recupera** com manifesto + cluster dominante único;
   - piso dispara e **falha alto** sem manifesto, ou com origens espalhadas;
   - contaminação minoritária do GAP A continua sendo excluída normalmente (piso não dispara, `subagent_count > 0`);
   - idempotência/acúmulo do registro em resume (duas sessões de orchestrator).
