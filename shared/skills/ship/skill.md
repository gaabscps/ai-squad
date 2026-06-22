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

#### 6.1 — (apenas se `work_type: product`) Gravar `product-summary.json`

> **Gate:** rode este sub-passo SÓ se o `session.yml` lido no passo 2 tiver `work_type: product`. Se ausente ou `dev`, **pule** (sessões SDD e `/observe` puro não geram resumo de produto) e vá para o passo 7.

> Fonte canônica das regras: `packages/os/src/product/{prompt.ts,types.ts,parse.ts}`. **Sincronize este bloco ao alterar a receita lá.** O `parse.ts` descarta em silêncio (decisão sem `what` some; sentinela de "exploratória" exige o travessão `—` exato) — **valide o JSON contra o schema antes de selar.**

Você viveu esta sessão. Componha o resumo a partir do **contexto vivido** — não reinterprete um transcript. Monte o envelope e grave-o.

**Schema do envelope (camelCase, lido pelo aiOS):**

```json
{
  "schemaVersion": 1,
  "kind": "product",
  "sealedAt": "<o MESMO timestamp UTC ISO-8601 gravado em closed_at no passo 5>",
  "outputLocale": "<output_locale do session.yml; ausente → \"en\">",
  "summary": {
    "tldr": "uma frase: o que esta sessão produziu ou explorou",
    "decided": [{ "what": "a decisão (obrigatório)", "why": "o critério ou null", "rejected": "a alternativa descartada ou null" }],
    "open": ["pergunta que ficou sem resposta"],
    "next": ["ação que a pessoa assumiu fazer"],
    "deliverable": "1 frase nomeando o artefato; OU a sentinela exploratória literal abaixo"
  }
}
```

**Regras anti-invenção (máx. 7):**
1. **Só o comprometido entra.** Use apenas o que aconteceu. IA sugeriu e a pessoa aceitou = legítimo; sugeriu e a pessoa não assumiu = fora; condicional ("se eu decidir", "talvez") = não é decisão nem `next` (se virou dúvida, vai pra `open`).
2. **`next` só com verbo de compromisso** ("vou fazer X", "preciso de Y"). Sem isso, `next: []`. Não duplique: pergunta fica só em `open`; respondê-la não vira `next`.
3. **Vazio é honesto.** Lista sem conteúdo real fica `[]`. Encher lista vazia com algo cogitado-mas-não-assumido é o pior erro.
4. **Nunca jargão de engenharia** (PR, diff, commit, deploy, teste, pipeline). Descreva pela necessidade de produto/negócio, não pela ótica de quem constrói.
5. **Descritivo, nunca avaliativo.** Não diga se foi boa/ruim, não aconselhe, não corrija a pessoa.
6. **`decided[].what` é obrigatório** (decisão sem `what` é descartada sem aviso). `deliverable` exploratório usa a sentinela **literal** (travessão `—`): `Sessão exploratória — sem decisão/entregável fechado`.
7. **Prosa no `outputLocale`** da sessão; chrome do envelope em inglês. Conciso: cada item ~1 frase; sem redundância, mas mantenha toda decisão verdadeira.

**Gravar (Python inline via Bash — mesmo padrão dos passos 5/7; NÃO use o Write tool):**

```bash
python3 -c "
import json
from pathlib import Path
obj = {
  'schemaVersion': 1,
  'kind': 'product',
  'sealedAt': '<closed_at do passo 5>',
  'outputLocale': '<output_locale ou en>',
  'summary': { 'tldr': '...', 'decided': [], 'open': [], 'next': [], 'deliverable': '...' },
}
p = Path('.agent-session/<spec_id>/product-summary.json')
p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n')
print('wrote', p)
"
```

Acrescente ao report (passo 6) a linha: `Product summary: .agent-session/<spec_id>/product-summary.json`.

### 7. Orientar sobre próximos passos
Baseado no prefixo do `spec_id`:
- `FEAT-` → `"Session <spec_id> sealed. O rastro permanece em .agent-session/<spec_id>/. Para iniciar uma nova feature: /spec-writer."`
- `DISC-` → `"Session <spec_id> sealed. O rastro permanece em .agent-session/<spec_id>/. Para iniciar uma nova oportunidade: /discovery-lead."`

## O que esta Skill nunca faz
- **Nunca apaga** `.agent-session/<spec_id>/` nem qualquer arquivo dentro dele. O rastro (custo, trail, outputs) fica em disco. Limpeza é opcional e manual.
- **Nunca usa `rm -rf`** em hipótese alguma.
- **Nunca falha ruidosamente** por causa do custo — `seal-session.py` é fail-open; um erro de captura não bloqueia o encerramento da sessão.
- **Nunca executa automaticamente** — encerramento é sempre iniciado pelo humano.
