# Gerenciar pastas (repos) pela dashboard — design

**Data:** 2026-06-04
**Status:** aprovado (brainstorming)

## Problema

A descoberta de projetos hoje só acha repos que estão **uma camada** abaixo de uma
`root` configurada e que tenham `.agent-session/` na raiz (`discoverProjects`,
scan de 1 nível). Repos **aninhados mais fundo** somem do board sem aviso.

Caso real que disparou a feature: a root é `~/Developer`, mas vários repos rodando
SDD vivem em `~/Developer/valePay/<repo>` — um nível abaixo do que o scan enxerga.
O `valePay/` é só um agrupador (não tem `.agent-session/` próprio), então o scanner
o descarta e não desce até os repos. Resultado: `Admin_companies_payments`,
`admin_payments`, `valepay-design-system` e `Saller-Front` **não aparecem**, mesmo
rodando pipelines normalmente.

Editar `aios.config.json` na mão resolve, mas o usuário quer fazer isso **pela
própria dashboard**: selecionar a pasta do repositório (a que tem `.agent-session/`
na raiz), ver os repos já adicionados e remover os que não quer mais.

## Modelo: cada pasta adicionada é um `include`

A pasta que o usuário seleciona é **o repositório exato** — aquele que já tem
`.agent-session/` na raiz. Isso mapeia direto no campo `include[]` do config
("paths avulsos de projeto, fora das roots"), que o `discoverProjects` já consome
hoje ([discovery.ts:82](../../src/collector/discovery.ts)).

- **Não é pasta-mãe.** O usuário aponta pro repo, não pra pasta que contém vários
  repos. Trade-off aceito: pra registrar os 4 repos do `valePay` ele adiciona 4
  vezes. A alternativa (apontar pra `valePay` como `root` e deixar o scan achar
  todos) pega tudo de uma vez, mas é menos explícita — entraria qualquer repo SDD
  da pasta, inclusive os que ele não quer ver. Escolhido o modelo explícito: só
  entra o que foi selecionado. Dá pra evoluir pro modo pasta-mãe depois.

## Arquitetura: comandos por HTTP, snapshot ao vivo pelo WS

O app já tem **dois canais**: HTTP pra leitura pontual (`GET /api/projects`,
`GET /file`) e WebSocket pro fluxo ao vivo (snapshots, `hide`/`unhide`). Os
endpoints novos entram por **HTTP**:

| Operação | Endpoint | Por quê HTTP |
|----------|----------|--------------|
| Listar subpastas de um caminho | `GET /api/browse?path=` | Pergunta-resposta pontual; precisa devolver erro ("ilegível"/"fora do home") com status code. |
| Adicionar repo | `POST /api/include` `{path}` | Precisa validar e responder ok / "não tem `.agent-session/`". |
| Remover repo | `DELETE /api/include` `{path}` | Idem, resposta de confirmação. |

**O board atualiza sozinho:** adicionar/remover muta o config → `rebuild()` → o
Store emite `changed` → o WS já existente faz broadcast do snapshot pra todos os
clientes. Reaproveita o caminho ao-vivo; só os comandos entram por HTTP.

**Alternativa rejeitada:** fazer tudo por WS (como o `hide`). Rejeitada porque
`browse`/`add` precisam de resposta com erro, e o padrão WS atual é fire-and-forget
(o `hide` não responde nada). HTTP dá status code e corpo de erro de graça; via WS
seria preciso inventar correlação request-id. Trade-off: dois caminhos em vez de
um, cada um no que faz melhor.

## Backend — peças e fronteiras

### 1. `src/collector/browse.ts` (novo) — o "ls" seguro

Função pura `listDirs(path, homeDir)`:

```ts
listDirs("/Users/x/Developer/valePay", "/Users/x") → {
  current: "/Users/x/Developer/valePay",
  parent:  "/Users/x/Developer",            // null se já está no home
  entries: [
    { name: "Admin_companies_payments", path: "...", hasAgentSession: true  },
    { name: "node_modules",             path: "...", hasAgentSession: false },
  ],
}
```

- **Read-only.** Lista só nomes de subpasta (ignora arquivos) e checa, por pasta,
  se existe `.agent-session/` dentro — pra o front marcar "✓ tem SDD".
- **Confinada ao home.** Se o `path` cair fora de `homeDir`, recusa (mesma defesa
  anti-traversal do `/file`, [app.ts:14](../../src/ui/app.ts) `isInside`). Começa
  no home por padrão. Decisão: confinar em vez de liberar o disco todo — custo é
  que um repo fora do `~` não é adicionável pela UI (cai no JSON na mão); ganho é
  não expor `/etc`, `/var` etc. via HTTP. Ampliável se houver repos fora do home.
- Pastas ilegíveis (permissão) não derrubam o scan — entram sem `hasAgentSession`
  ou são puladas, espelhando a tolerância a falha do `discoverProjects`.

### 2. `src/config.ts` — persistir o `include`

Hoje só existe `saveHidden`, que reescreve o config preservando `roots`/`include`
crus. Generalizar pra `saveConfigFields(configPath, patch)` onde `patch` tem
`include?`/`hide?` opcionais; reescreve preservando o que não foi tocado
(`roots`, `archiveAfterDays`). Mesmo princípio: **única escrita do aiOS**, no
próprio repo dele, nunca nos `.agent-session/` alheios. `saveHidden` passa a ser um
caso particular (ou um wrapper fino) pra não quebrar o call-site atual.

- Paths absolutos vindos do navegador são reencurtados pra `~` ao salvar quando
  estiverem sob o home, mantendo o arquivo legível como o usuário escreveria
  (coerente com o comentário de `saveHidden`). Polish, não bloqueante.

### 3. `src/collector/watcher.ts` — observar os includes também

`watchProjects(roots, onChange)` vira `watchProjects(roots, includes, onChange)`.
Os globs das roots têm o `*` do meio (acham o repo); os dos includes **não**,
porque o include já é o repo:

```
root:    ~/Developer/*/.agent-session/**/session.yml      ← o * acha o repo
include: ~/Dev/valePay/Admin/.agent-session/**/session.yml ← já é o repo
```

Conserta de quebra um gap existente: includes nunca eram observados ao vivo.

### 4. `src/server.ts` — ações + re-armar o watcher

O estado do watcher mora aqui. Três ações injetadas no `createServer` (igual o
`toggleHide` já é hoje):

- `addInclude(path)` → valida `.agent-session/` existe e está sob o home →
  adiciona a `config.include` (dedup) → `saveConfigFields` → `rebuild()` →
  `rearmWatcher()`. Retorna `{ ok }` ou `{ error }`.
- `removeInclude(path)` → tira de `config.include` → persiste → `rebuild()` →
  `rearmWatcher()`.
- `rearmWatcher()` → `await watcher.close()` e reabre com `config.roots` +
  `config.include` atuais. O `watcher` deixa de ser `const` e vira reatribuível.

### 5. `src/ui/app.ts` — endpoints + include no snapshot

- `GET /api/browse?path=` → `listDirs`; 400 sem `path`, 403 fora do home, 200 ok.
- `POST /api/include` / `DELETE /api/include` → chamam as ações injetadas; 200 ok,
  4xx no erro de validação.
- O `snapshotMessage()` passa a incluir `include: config.include`, pro front ter a
  lista de repos adicionados sem fetch extra (igual o `archiveAfterDays` já viaja
  lá). `createServer` recebe as novas ações + um getter do `include` atual.

## Front — o modal de pastas

### `web/src/components/FolderManager.tsx` (novo)

Aberto por um botão (ícone de pasta) na `TopBar`, ao lado do toggle de visão.

```
┌─ Pastas ────────────────────────────────── × ┐
│  REPOS ADICIONADOS                            │
│   • Admin_companies_payments        [remover] │
│   • valepay-design-system           [remover] │
│                                               │
│  ADICIONAR NOVO                               │
│   ~/Developer/valePay            [↑ subir]    │
│   ├ 📁 Admin_companies_payments  ✓ tem SDD    │
│   ├ 📁 Saller-Front              ✓ tem SDD    │
│   ├ 📁 node_modules                           │
│              [ Adicionar este repo ]          │
└───────────────────────────────────────────────┘
```

- **Navegar:** clicar numa pasta entra nela (`GET /api/browse`); breadcrumb/"subir"
  volta. Pasta com `.agent-session/` ganha selo "✓ tem SDD".
- **Adicionar:** "Adicionar este repo" só habilita quando a pasta **atual** tem
  `.agent-session/`. Manda `POST /api/include`. Erro do backend aparece inline.
- **Listar/remover:** seção de cima lê o `include[]` que agora vem no snapshot;
  "remover" manda `DELETE /api/include`.
- O board atualiza sozinho — o snapshot novo chega pelo WS existente.

### Estado

- `web/src/state/foldersClient.ts` (novo) — cliente HTTP fino pra browse/add/remove,
  no mesmo espírito de `summaryClient`/`attentionClient`.
- `useLiveProjects` + `projects.tsx` — guardar o `include[]` que passa a vir no
  snapshot (hoje já trata `projects` e `archiveAfterDays`; soma mais um campo).

## Fluxo

```
usuário navega no modal ──GET /api/browse──► listDirs (confinado ao home)
        │ seleciona repo com .agent-session
        ▼
   POST /api/include ──► addInclude: valida → config.include += path
        │                        → saveConfigFields → rebuild → rearmWatcher
        ▼
   Store emite 'changed' ──WS broadcast──► todo cliente recebe snapshot novo
                                            (Project[] + archiveAfterDays + include)
        │
        └──► board mostra o repo na hora; mudanças futuras dele chegam ao vivo
             (watcher re-armado já observa o include)
```

## O que NÃO muda (invariantes)

- **Zero escrita** em `.agent-session/` alheio. A única escrita do aiOS continua
  sendo o próprio `aios.config.json`.
- **Descoberta read-only.** `discoverProjects` segue só-leitura; o include só
  acrescenta paths à lista que ele já varre.
- **Sem novo estado persistido** além de entradas em `include[]` (que já existia no
  schema).

## Segurança

- `GET /api/browse` e `POST /api/include` **confinados ao `~`** (anti-traversal,
  mesma trava `isInside` do `/file`). Servidor ouve em `127.0.0.1` (já é o caso).
- Validação no add: a pasta existe, é diretório, tem `.agent-session/`, está sob o
  home. Recusa com mensagem clara caso contrário.

## Testes (TDD)

| Arquivo | Cobre |
|---------|-------|
| `browse.test.ts` (novo) | lista subpastas; marca `hasAgentSession`; **recusa path fora do home**; tolera pasta ilegível |
| `config.test.ts` (+) | `saveConfigFields` persiste `include` preservando `roots`/`hide`/`archiveAfterDays`; `saveHidden` segue funcionando |
| `watcher.test.ts` (+) | gera globs pros includes **sem o `*` do meio**; roots seguem com o `*` |
| `app.test.ts` (+) | `/api/browse` 200/400/403; `POST`/`DELETE /api/include` 200 e 4xx; snapshot inclui `include` |
| `FolderManager.test.tsx` (novo) | navega entrando/subindo; habilita "adicionar" só com SDD; lista e remove; mostra erro inline |
```
