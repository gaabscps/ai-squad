# Testar o pipeline localmente

Guia para rodar o pipeline do ai-squad num projeto real e confirmar que os
componentes (skills, agents, hooks) estão funcionando — incluindo o
vocabulário canônico (`spec_id`/`task_id`/`dispatch_id`), o audit gate e a
captura de custo.

> Termo rápido: **deploy** aqui significa "instalar os componentes do ai-squad
> no seu ambiente" — as skills e agents vão para `~/.claude/` (valem para todos
> os projetos) e os hooks vão para `<projeto>/.claude/hooks/` (por projeto).

## 1. Instalar/atualizar os componentes

Skills e agents são globais; instale-os uma vez (e re-instale quando atualizar
o ai-squad):

```bash
ai-squad deploy --global-only
```

Em **cada projeto** onde for rodar o pipeline, instale os hooks:

```bash
cd /caminho/do/seu-projeto
ai-squad deploy --hooks-only
```

Confirme que os arquivos de runtime chegaram (sem eles a captura de custo e as
travas de segurança não funcionam):

```bash
ls .claude/hooks/model_prices.json        # tabela de preços (cálculo de custo)
ls .claude/hooks/guard-session-scope.py   # trava que protege outputs/
```

> Se você roda o ai-squad a partir do código-fonte (não da versão publicada no
> npm), rode `npm run --prefix <repo-ai-squad>/packages/cli sync` antes do
> deploy. O deploy distribui a pasta `components/`, que é **gerada** a partir de
> `squads/` por esse comando de sincronização.

## 2. Rodar o pipeline

Numa sessão do Claude Code aberta **dentro do projeto**:

- **Interativo** (você aprova cada fase): `/spec-writer` → aprovar o Spec →
  `/task-builder` → `/orchestrator FEAT-NNN`
- **Autônomo** (o pipeline roda do começo ao fim sozinho): `/pm <descrição da feature>`

> Use uma **feature nova** para o primeiro teste. Retomar uma feature antiga
> (`--resume`) mistura o teste com dados de execuções anteriores e atrapalha a
> leitura do resultado.

## 3. Confirmar que funcionou

Depois da execução, dentro de `.agent-session/<FEAT-NNN>/`:

| O que verificar | Como | Esperado |
|---|---|---|
| Vocabulário canônico | abrir um packet de `dev`/reviewer em `outputs/` | tem `spec_id` (a feature) **e** `task_id` (a task, `T-XXX`) |
| Estado da sessão | `grep -E "spec_id\|task_id" session.yml` | campo `spec_id:` no topo |
| Auditoria | `ls outputs/ \| grep -c audit` | **1** dispatch de audit, com status `done` |
| Custo real | `cat cost-report.json` | `total_cost_usd > 0`, `subagent_count > 0` — não `$0` com `complete:true` |

## 4. Sinais de sucesso e de alerta

- **Sucesso:** packets com `spec_id`+`task_id`, **um** audit `done`, e um
  `cost-report.json` com valor em dólar de verdade.
- **Auditoria bloqueou (`blocked`):** é o comportamento esperado quando algo não
  reconcilia. O veredito é **terminal** — a recuperação é
  `/orchestrator FEAT-NNN --restart` (que limpa `outputs/` e re-dispatcha os
  subagents do zero), **nunca** editar os packets à mão para forçar o `done`.
- **Reportar como bug:** se um subagent gerar um packet **sem** `task_id` e o
  pipeline **não** bloquear — o hook `verify-output-packet.py` deveria barrar na
  origem.
