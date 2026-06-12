# Design — Redesign de UX do cockpit (packages/os)

**Data:** 2026-06-12 · **Sessão:** OBS-003 · **Status:** aprovado em conversa, aguardando review do doc

## Contexto e diagnóstico

O cockpit (`packages/os`) acabou de ganhar o modo observado (design irmão:
`2026-06-12-os-observed-mode-design.md`). Esta sessão auditou a UX da versão viva
com três reviewers paralelos (semântica do kanban, storytelling de decisões,
honestidade de dados) + validação no browser com dados reais. Achados que
fundamentam este design:

1. **Grid blowout no kanban** (reportado pelo usuário como "colunas quebradas").
   Medido no browser: `grid-template-columns` computado de `103px / 737px / 1053px`
   com `repeat(3, 1fr)` declarado, e scroll horizontal (2022px de conteúdo em
   1710px de janela). Mecanismo: `1fr` equivale a `minmax(auto, 1fr)` — a trilha
   não encolhe abaixo do conteúdo mínimo; `.kcard-title` tem `white-space: nowrap`,
   então o conteúdo mínimo do card é o título inteiro, e a trilha estica.
2. **Decisões "gospem texto"**. O drawer observado já renderiza `decisions[]`,
   mas cada decisão é uma pilha de parágrafos de peso visual idêntico
   (what/why/rejected), as evidências moram numa seção desacoplada, e o parecer
   SDD é um accordion de 11 blobs markdown com a mesma tipografia. Não há
   manchete, hierarquia nem vínculo causal decisão→prova.
3. **Sobras de desonestidade calma**. "Parecer de entrega: sem parecer de
   entrega ainda" renderiza em contratos observados (o "ainda" promete algo que
   pode nunca vir); sessões `running` nunca fechadas poluem "Em andamento" para
   sempre — nada as envelhece.
4. **Estética**: direção "C — Anthropic Studio" (creme escuro + ferrugem)
   escolhida pelo usuário via visual companion, com pedido de refinamento de tom.

Decisão estrutural já tomada (registrada em OBS-003): `packages/os` é a cópia
canônica; o repo separado `~/Developer/ai-squad-os` está morto.

## Escopo — 4 frentes, nesta ordem

Ordem por impacto de UX; estética por último porque as três primeiras mudam o
que a tinta cobre.

### WS1 — Fix do grid blowout

`app.css`: adicionar `min-width: 0` em `.kcol`. Com a trilha autorizada a
encolher, o `text-overflow: ellipsis` do título volta a funcionar e as três
colunas ficam `1fr` reais.

- Verificação: medição JS no browser (gridTemplateColumns ≈ iguais; sem scroll
  horizontal) + screenshot.
- Teste de regressão automatizado não se aplica (CSS computado não existe no
  jsdom); documentar o porquê do `min-width: 0` em comentário no CSS para não
  ser "limpo" no futuro.

### WS2 — Storytelling de decisões

**Drawer observado:**

- **Manchete narrada** no lugar da story seca (`buildStory` ramo observado):
  `Você pediu: "<intent>" · aberto há 2h14 · 3 decisões · 2 verificações · US$ 5.11`.
  Tudo já existe em `ObservedMeta`; é composição de string + layout.
- **Decisão como card de forquilha** (novo componente `DecisionCard`): o caminho
  escolhido (`what`) em destaque; o rejeitado (`rejected`) ao lado/abaixo,
  esmaecido e visualmente "não tomado"; o `why` como legenda da bifurcação;
  `ref` vira botão — quando resolve para arquivo `.md` existente, abre no
  `MarkdownViewer` (infra `onOpenFile` já existe); senão, código inline.
- **Evidências acopladas**: `evidence[]` renderiza como sub-trilha da mesma
  seção ("✓ verificado: `cmd` → resultado"), numerada, logo após as decisões —
  não em seção separada. Sem timestamps não há intercalação cronológica
  confiável; a ordem de append é a aproximação assumida.
- **Esconder o que não se aplica**: "Parecer de entrega" não renderiza em
  contrato observado sem parecer (em vez de "sem parecer ainda").

**Parecer SDD (pirâmide invertida)** em `DeliveryReportBlock`:

- Manter o pill de veredicto (único elemento de pirâmide que já existe).
- Adicionar manchete computada (contagens: tarefas, custo, desvios, riscos —
  derivável dos answers/ACs existentes).
- As 3 respostas vitais (o quê / por quê / riscos) como one-liners expandíveis;
  as outras 8 colapsadas atrás de "ler parecer completo".
- `evidenceRefs` deixam de ser texto morto: viram botões que abrem o arquivo no
  `MarkdownViewer` quando resolvíveis.

**Fora de escopo (mudança no framework, fica para depois):** campo `at`
(timestamp) nos appends de `decisions[]`/`evidence[]` do `/observe` — é a
mudança aditiva e barata que destrava o "flight recorder" cronológico completo.
Série temporal de custo idem (hoje o snapshot é sobrescrito).

### WS3 — Honestidade e dormência

- **Dormência por gravidade** (`kanbanObserved.ts`): sessão não-terminal sem
  atividade há mais de N dias (default 3) sai de "Em andamento" para a vista
  "Arquivadas", com badge próprio "dormindo" (nunca "concluído" — rótulo
  honesto). Critério: a evidência mostra que ninguém fecha sessão; qualquer
  modelo que dependa de disciplina humana repete a falha atual. Sessão que
  acorda (nova atividade) volta sozinha. Alternativa rejeitada: 4ª coluna
  "Dormindo" — polui o board com trabalho que não é ativo nem demanda atenção.
- **Vocabulário por estado**: "(em coleta)" só para sessão ativa; terminal sem
  custo → "custo não capturado" (âmbar, com tooltip do porquê). Distingue
  "ainda vai chegar" de "deveria ter vindo e não veio".
- Auditoria final das seções do drawer observado: nenhuma seção SDD órfã.

### WS4 — Estética "Anthropic Studio" (direção C refinada)

Retematização por troca de tokens em `:root` do `app.css` — sem mexer em
layout (as classes já consomem variáveis):

| Token | Hoje | Direção C (base a calibrar) |
|---|---|---|
| `--bg` | `#f6f7f9` | `#EEEAE3` |
| `--surface` | `#ffffff` | `#F7F5F0` |
| `--border` | `#e7e9ee` | `#D8D2C8` |
| `--text` | `#111827` | `#1F1B15` |
| `--text-dim` | `#6b7280` | `#6E6459` |
| `--accent` | `#2563eb` | `#B85C3C` |

Cores de status mantêm o semáforo (vermelho/âmbar/verde/roxo) com saturação
recalibrada para o fundo quente. O usuário pediu refinamento de tom sobre o
mockup C — a calibração final é feita ao vivo no browser (screenshots +
ajuste com o usuário) antes de fechar os tokens. Brand mark sai do gradiente
azul para a ferrugem.

## Testes

- **Unit (vitest + RTL):** `isDormant` (limites, sem `lastActivityAt`,
  acordar), `DecisionCard` (com/sem rejected, ref arquivo vs texto), manchete
  narrada (aberto/fechado, plurais), pirâmide do parecer (vitais abertas,
  resto colapsado), gates de seção por modo.
- **Visual (Chrome MCP):** medição do grid pós-fix, screenshots das 4 frentes
  com dados reais.

## Fora de escopo

- Mudanças no framework ai-squad (campo `at`, série temporal de custo,
  histórico de flips de atenção). O contrato `session.yml` atual já carrega
  tudo que estas 4 frentes precisam.
- Flight recorder cronológico completo (gated no campo `at`).
- Tabela/vista arquivadas além do necessário para dormência.
