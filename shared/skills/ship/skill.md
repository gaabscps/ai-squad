---
name: ship
description: Encerramento de sessão (cross-squad): sela custo, grava estado terminal e gera o report. NÃO apaga o `.agent-session/`.
---

# Ship — Encerramento de Sessão (selador)

`/ship <spec_id>` sela uma Sessão concluída: registra a conversa como proprietária, reconstrói o custo, grava o estado terminal em `session.yml` e gera o `cost-report.json`. **Nunca apaga** o `.agent-session/<spec_id>/` — o rastro fica em disco e a limpeza é manual se o humano quiser.

É **cross-squad**: funciona tanto em Sessões SDD (`FEAT-NNN`) quanto em Sessões Discovery (`DISC-NNN`).

## Quando invocar
- `/ship FEAT-NNN` — encerrar uma Sessão SDD.
- `/ship DISC-NNN` — encerrar uma Sessão Discovery.
- `/ship` — sem argumento: listar Sessões existentes e perguntar qual encerrar.

## Refuse when
- `<spec_id>` fornecido mas nenhuma Sessão existe em `.agent-session/<spec_id>/` → mensagem: `"No Session at .agent-session/<spec_id>/. Nothing to seal."`
- `.agent-session/<spec_id>/session.yml` ilegível ou malformado → mensagem: `"Cannot read .agent-session/<spec_id>/session.yml. Inspect it manually."`

## Inputs (pré-condições)
- `.agent-session/<spec_id>/session.yml` existente (qualquer estado — selar é o ato que TORNA o estado terminal).

## Steps

### 1. Resolver `spec_id`
- Invocado com `FEAT-NNN` / `DISC-NNN`: usar diretamente.
- Invocado sem argumento: escanear `.agent-session/*/`, ler `current_phase` e `last_activity_at` de cada `session.yml`, apresentar a lista (id, fase, última atividade). Perguntar qual encerrar. Se nenhuma existir → `"No Sessions in .agent-session/. Nothing to seal."`

### 2. Ler `session.yml`
- Ler `.agent-session/<spec_id>/session.yml`.
- Se ilegível ou malformado → recusar conforme a matriz acima. **Não prosseguir.**

### 3. Descobrir o `session_id` atual
- O agente que executa `/ship` conhece o ID da conversa atual (disponível no contexto do Claude Code como o identificador da sessão ativa).
- Se o ID não estiver disponível, pular o passo 4 (não executar `seal-session.py`) e prosseguir diretamente para o passo 5 (gravar estado terminal).

### 4. Rodar `seal-session.py` (registra + backfill + cost-report)
```bash
python3 .claude/hooks/seal-session.py <spec_id> <session_id>
```
Este script (fail-open):
- Registra `session_id` em `observed_sessions:` no `session.yml`.
- Reconstrói `costs/session-<session_id>.json` via backfill na janela da sessão.
- Regenera `cost-report.json`.

### 5. Gravar estado terminal em `session.yml`
Usando Bash, acrescentar (ou atualizar) dois escalares no `session.yml`:
```bash
# status
python3 -c "
import re, sys
from pathlib import Path
p = Path('.agent-session/<spec_id>/session.yml')
t = p.read_text()
t = re.sub(r'^status:.*$', 'status: done', t, flags=re.MULTILINE)
if 'status:' not in t:
    t = t.rstrip() + '\nstatus: done\n'
p.write_text(t)
"
# closed_at (UTC ISO-8601)
python3 -c "
from datetime import datetime, timezone; print(datetime.now(timezone.utc).isoformat())
" | xargs -I{} python3 -c "
import re, sys
from pathlib import Path
ts = sys.argv[1]
p = Path('.agent-session/<spec_id>/session.yml')
t = p.read_text()
t = re.sub(r'^closed_at:.*$', f'closed_at: {ts}', t, flags=re.MULTILINE)
if 'closed_at:' not in t:
    t = t.rstrip() + f'\nclosed_at: {ts}\n'
p.write_text(t)
" {}
```
Ou escrever os dois de uma vez usando Python inline — o importante é que `status` e `closed_at` fiquem gravados antes de reportar.

Para Sessões abandonadas (o humano solicitou abandono): usar `status: abandoned` em vez de `done`.

### 6. Gerar o report
Apresentar ao humano um resumo do que foi selado:
```
Sealed .agent-session/<spec_id>/
  Status:     done
  Closed at:  <closed_at>
  Session:    <session_id>
  Cost:       <total_cost_usd> USD  (<link to cost-report.json if meaningful>)
```
Incluir contexto vivido: o que foi feito nesta sessão, decisões relevantes, entregáveis produzidos — narrativa resumida para registro.

### 7. Orientar sobre próximos passos
Baseado no prefixo do `spec_id`:
- `FEAT-` → `"Session <spec_id> sealed. O rastro permanece em .agent-session/<spec_id>/. Para iniciar uma nova feature: /spec-writer."`
- `DISC-` → `"Session <spec_id> sealed. O rastro permanece em .agent-session/<spec_id>/. Para iniciar uma nova oportunidade: /discovery-lead."`

## O que esta Skill nunca faz
- **Nunca apaga** `.agent-session/<spec_id>/` nem qualquer arquivo dentro dele. O rastro (custo, trail, outputs) fica em disco. Limpeza é opcional e manual.
- **Nunca usa `rm -rf`** em hipótese alguma.
- **Nunca falha ruidosamente** por causa do custo — `seal-session.py` é fail-open; um erro de captura não bloqueia o encerramento da sessão.
- **Nunca executa automaticamente** — encerramento é sempre iniciado pelo humano.
