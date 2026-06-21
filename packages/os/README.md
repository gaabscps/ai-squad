# ai-squad OS (aiOS) — cockpit local

Cockpit web local (single-user) que **observa** suas sessões de trabalho com IA (Claude Code)
e gera, por sessão, um resumo do que foi feito — com **custo e tempo capturados
automaticamente**. Dois modos:

- **dev** (padrão, via `/observe`): resumo no estilo dev→tech lead (mudanças, decisões, revisão de PR).
- **produto/design** (via `/sessao`): resumo na linguagem de produto — *decidido / em aberto /
  próximo passo / entregável* — sem nenhum jargão de engenharia.

O aiOS é **read-only** sobre os projetos: lê os artefatos em `.agent-session/<id>/` e nunca
escreve neles.

---

## Instalação local (passo a passo)

**Pré-requisitos:** Node ≥ 18, Python 3.8+ no `PATH`, e o **Claude Code** instalado.

### 1. Pegue o código

O pacote publicado (`@ai-squad/cli`) ainda **não** inclui o modo produto — instale a partir
deste repositório:

```bash
git clone -b feat/observe-product-mvp https://github.com/gaabscps/ai-squad.git
cd ai-squad
```

> Depois que o PR do modo produto for mergeado, troque por `git clone` da branch `main`.

### 2. Instale as skills e os ganchos (a partir do repo local)

```bash
# na raiz do repo:
node packages/cli/bin/cli.js deploy
```

Isso copia as skills (incluindo a nova `/sessao`) para `~/.claude/skills/` e instala os ganchos
de captura de custo/tempo/atenção em `.claude/hooks/` do projeto. Rode o `deploy` **também dentro
de cada projeto** onde a pessoa vai usar o `/sessao`:

```bash
cd <projeto-da-pessoa>
node <caminho-do-repo>/packages/cli/bin/cli.js deploy
```

> Use o CLI **do repo local** (`node packages/cli/bin/cli.js`), e não o `@ai-squad/cli` global —
> o global ainda não tem o modo produto.

### 3. Suba o cockpit

```bash
cd packages/os
npm install
npm run dev
```

Em desenvolvimento o front sobe no Vite em `http://127.0.0.1:5173` (com proxy para o servidor na
porta 4717). Para servir o build de produção: `npm run build` e depois `npm run serve` (abre em
`http://127.0.0.1:4717`).

### 4. Aponte o cockpit para os projetos

Crie/edite `packages/os/aios.config.json`:

```json
{
  "roots": ["~/Developer"],
  "include": [],
  "hide": [],
  "archiveAfterDays": 7
}
```

`roots` são as pastas varridas em busca de `.agent-session/`. Ajuste para onde ficam os projetos
da pessoa. Este arquivo é local (gitignored) — o código versionado continua projeto-agnóstico.

---

## Usar o modo produto/design

1. No Claude Code, dentro de um projeto com `deploy` feito, abra a sessão:
   ```
   /sessao "explorar o fluxo de onboarding"
   ```
2. Trabalhe normalmente com a IA (conversa, pesquisa, escrita, exploração — o que for).
3. Ao terminar, diga que o trabalho acabou — o modelo fecha a sessão (`status: done`).
4. No cockpit, abra a sessão e clique em **"gerar resumo da sessão"**. Sai o resumo:
   *decidido / em aberto / próximo passo / entregável*, em português, com o selo
   *"inferido da conversa — confira"*.

O resumo é gerado **sob demanda** e fica em cache; custo e tempo da sessão são capturados
automaticamente, sem você fazer nada.

---

## Desenvolvimento

```bash
cd packages/os
npm test         # suíte completa (Vitest)
npm run dev      # servidor + front com hot-reload
```

Arquitetura: **Coletor** (lê o disco, read-only) → **Store** (estado normalizado em memória) →
**UI** (Express + WebSocket; front Vite + React). O modo produto vive em `src/product/`
(contrato, prompt, parser, cache, handler) e reusa o pipeline de geração do modo observado
(`src/narrative/`) sem alterá-lo.
