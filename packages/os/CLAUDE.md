# ai-squad-os

Cockpit local (web, single-user) que **observa** os pipelines do framework [ai-squad](https://github.com/gaabscps/ai-squad) rodando em todos os seus projetos: board de specs com tags por projeto, status de fase em tempo real e **contagem de tokens agregada** por feature.

Este package (`packages/os/` do monorepo ai-squad) é o **consumidor read-only** do framework: lê os artefatos que ele produz (`.agent-session/<spec_id>/session.yml`, manifests, `costs/agent-*.json`) e **nunca escreve** neles. A fronteira read-only é arquitetural e continua valendo dentro do monorepo. O que é específico dos projetos do usuário fica no `aios.config.json` local (gitignored) — o código versionado permanece projeto-agnóstico, como todo o resto do repo.

**Custo:** o aiOS **não calcula $** — soma os tokens que cada feature já registra em `costs/agent-*.json` e **encaminha pro report do ai-squad** (`.agent-session/<spec>/report.html`) pra revisão humana do custo em $. O report é a fonte da verdade de custo, complementar e não substituído.

## Regras de comunicação (inegociável)

O usuário é **dev front-end (~3 anos)** — domina o front, mas não conhece todos os termos de backend, infraestrutura e protocolos de rede. Estas sessões são a principal forma de estudo dele. Portanto, em TODA resposta:

1. **Definir todo termo técnico fora do domínio front na primeira aparição** — uma frase curta com analogia do cotidiano (ex.: "WebSocket = um cano de mão dupla sempre aberto entre servidor e navegador"). Termos triviais (função, arquivo, JSON, componente, estado) não precisam.
2. **Explicar o PORQUÊ e o mecanismo, não só o QUÊ** — dar a razão e como funciona por baixo, pra construir o modelo mental.
3. **Output visual** — tabelas, diagramas ASCII, blocos curtos; evitar parágrafos densos e estilo telegráfico.
4. **Toda decisão explicada** — ao incluir/excluir/priorizar/escolher A sobre B, dizer o critério, a alternativa rejeitada e a trade-off. Omissão silenciosa é falha de comunicação.
5. **Começar pelo concreto, depois abstrair** — ancorar numa cena real antes de empilhar termos.

Estas regras reforçam (não substituem) o `~/.claude/CLAUDE.md` global do usuário.

## Arquitetura (resumo)

Três peças com fronteiras limpas: **Coletor** (lê disco + file-watching, só leitura) → **Store** (estado normalizado em memória: Project → Spec → Task → Custo) → **UI** (servidor Express local + WebSocket; front Vite + React).

Stack: Node + TypeScript / Express (backend), Vite + React (front). Detalhes em `docs/specs/`.
