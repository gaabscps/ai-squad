---
name: sessao
description: Abre uma sessão de trabalho de produto/design observada — cria o estado que liga a captura de custo/tempo/atenção e marca work_type=product, para o aiOS gerar um resumo da sessão na linguagem de produto (decidido / em aberto / próximo passo / entregável). Variante de produto do /observe; conduz Phase nenhuma e tem ZERO opinião sobre como o trabalho é feito. Use com /sessao "<intenção>" no início do trabalho.
---

# Sessão (produto/design) — abre o contrato de observação

`/sessao "<intenção>"` instrumenta ESTA conversa para trabalho de produto/design. A
partir daqui, os hooks capturam custo e tempo automaticamente, marcam `needs_attention`
quando a sessão fica esperando por você, e o aiOS gera, sob demanda, um resumo da sessão
na linguagem de produto: o que foi **decidido**, o que ficou **em aberto**, o **próximo
passo** e o **entregável**.

É a variante de produto do `/observe`: mesma captura mecânica, mas grava
`work_type: product` no estado — e por isso o resumo sai com persona de produto, sem
jargão de engenharia (nada de PR, diff, commit ou testes).

**Stone rule: esta Skill tem ZERO opinião sobre COMO você trabalha.** Ela observa e
reporta; nunca diz como fazer o trabalho. Se uma edição futura adicionar um passo de
"como fazer", essa edição está errada — rejeite-a.

## Quando invocar
- `/sessao "explorar o fluxo de onboarding"` — início de um trabalho de produto/design.
- `/sessao` sem intenção — peça à pessoa uma intenção de uma linha, depois prossiga.

## Steps

### 1. Abrir o contrato
Gerar o próximo id livre `OBS-NNN` (scan `.agent-session/OBS-*`). Pegar o timestamp real
via Bash (`date -u +%Y-%m-%dT%H:%M:%SZ`) — nunca chutar o relógio. Escrever
`.agent-session/OBS-NNN/session.yml`:

```yaml
schema_version: 1
session_id: OBS-NNN
mode: observed            # acorda a captura de atenção/custo
work_type: product        # marca o caminho de produto (resumo com persona de produto)
intent: "<a intenção em uma linha>"
status: in_progress
output_locale: <idioma do humano, BCP-47>
created_at: <agora, UTC ISO-8601>
base_sha: <git rev-parse HEAD>   # âncora de diff; se não for repo git, omitir
```

Avise que o contrato está aberto e o que passa a ser capturado automaticamente (custo,
tempo, status de atenção), e siga com o que a pessoa pediu.

### 1.5 Feature (agrupamento — pergunta única na abertura)

Toda sessão observada pertence a uma feature (um card do Jira ou um pedido avulso da
pessoa). Pergunte UMA VEZ, logo após abrir o contrato — nunca no meio do trabalho, e
nunca de novo ao retomar (se o `session.yml` já tem um bloco `feature:`, leia-o e siga
em frente).

1. Escaneie os `session.yml` irmãos em `.agent-session/*/` procurando blocos `feature:`
   já existentes; junte as ~5 features mais recentemente ativas (dedup por `id`).
2. Pergunte via `AskUserQuestion` (widget autossuficiente — preferência de
   instrumentação, igual à do passo 2): opções = cada feature recente como
   "<id> · <name>" (rótulo "continuar"), mais "Nova feature" e
   "Sem feature por ora".
3. Resolva o bloco:
   - **Continuar**: copie `id`/`key`/`name` literalmente do bloco escolhido (divergência
     de string é impossível por construção).
   - **Nova** com issue-key (`^[A-Z][A-Z0-9]*-\d+$`): `key` = a key em maiúsculas,
     `id` = igual à key. Se houver uma ferramenta de Jira (MCP) disponível, busque o
     card e defina `name` = título real, mais um snapshot; se não houver, `name` = a
     própria key (a próxima sessão enriquece).
   - **Nova** com nome livre: sem `key`; `id` = `ft-<slug(name)>` (minúsculo, sem
     acentos, não-alfanuméricos → hífen).
   - **Sem feature**: `id` = `ft-<slug(intenção)>`, `name` = a intenção. Isso é um
     órfão legítimo — escolha explícita da pessoa, não uma falha.
4. Grave o bloco no `session.yml` (na mesma escrita do contrato ou numa edição
   seguinte — o hook `verify-observed-feature`, já implantado, valida o formato e
   corrige VOCÊ, o agente, se estiver malformado):

```yaml
feature:
  key: PAY-1234              # só quando uma issue-key foi informada
  name: "Export de fatura"
  id: PAY-1234               # == key quando presente; ft-<slug(name)> caso contrário
  jira_snapshot:             # só quando há key + Jira MCP disponível
    status: "In Progress"
    fetched_at: <agora, UTC ISO-8601>
    url: "https://<site>/browse/PAY-1234"
```

Isso é instrumentação (como preferir `AskUserQuestion` no passo 2), NÃO uma opinião de
implementação — a stone rule permanece: zero opiniões sobre COMO o trabalho é feito.

### 2. Trabalhar (não é assunto desta Skill)
Sem passos aqui, de propósito. Uma única preferência de instrumentação (não uma opinião
sobre o trabalho): quando precisar de uma decisão bloqueante da pessoa, prefira a
ferramenta `AskUserQuestion` a uma pergunta em texto puro — é a chamada da ferramenta que
marca `needs_attention` mecanicamente para a coluna de atenção do aiOS.

### 3. Fechar
Quando a pessoa declarar o trabalho concluído (ou abandonado), defina `status: done`
(ou `status: abandoned`) E `closed_at: <agora, UTC ISO-8601>` (relógio real via Bash) no
`session.yml`. `closed_at` é a borda final da janela de custo — sem ela, o custo de uma
conversa posterior pode vazar para este contrato.

## Hard rules
- Nunca adicionar opiniões de implementação a esta Skill (stone rule acima).
- Nunca bloquear ou atrasar o trabalho para manter a observabilidade — ela é mecânica nas
  bordas e best-effort durante.
- Uma sessão observada por trabalho; feche um contrato antes de abrir o próximo no mesmo
  repo (cada conversa é adotada por UM contrato aberto).
