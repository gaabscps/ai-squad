# UX: markdown e leitura do parecer (e dos .md) — design

**Data:** 2026-06-08
**Status:** aprovado (brainstorming)

## Problema

Os dados do delivery-report já aparecem no board (feature anterior), mas estão **ruins
de ler**:

1. **Markdown cru nas 11 respostas.** Cada resposta é renderizada num `<p>` simples com
   `white-space: pre-wrap`, então as marcações aparecem como texto literal. No FEAT-011:
   negrito `**...**` (50×), código inline `` `...` `` (**208×**), listas numeradas (18×) e
   com traço (6×), parágrafos via `\n\n`. O usuário vê `**DEC-001**` e `` `completeness.ts` ``
   como texto, não formatados. (Não há headings, tabelas, code-fences nem links *dentro
   das respostas* — é um subconjunto enxuto.)
2. **Paredão de texto.** As 11 respostas empilhadas abertas + a tabela de 31 ACs fazem
   uma gaveta longuíssima — "tudo jogado ali".
3. **Os `.md` abrem como texto cru.** O `/file` serve `.md` com `Content-Type: text/plain`
   ([app.ts:57](../../src/ui/app.ts)). Quem linka: o `Timeline` (spec.md/plan.md/tasks.md/
   memo.md), o "ver narrativa completa →" (delivery-report.md). Clicar abre uma aba com
   markdown cru. Esses arquivos usam markdown **completo** (headings, tabelas, blockquotes,
   code-fences).
4. **Não há renderizador de markdown** no projeto (o `SpecSummaryBlock` também joga texto
   num `<div>`).

Read-only continua valendo: só **lemos e exibimos**; nada é escrito nos repos observados.

## Decisões (já validadas no brainstorming)

| Decisão | Escolha | Por quê / alternativa rejeitada |
|---|---|---|
| Layout das 11 respostas | **Accordion colapsável** | Mata o paredão; o usuário abre só o que quer. Rejeitado "plano com tipografia melhor": resolve o markdown mas continua um scroll longo. |
| Arquivos `.md` | **Visualizador in-app** | Mantém o usuário no cockpit, estilo consistente. Rejeitado "servidor → HTML" (página fora do app, mistura lib no backend) e "deixar de fora" (o problema do spec/tasks ficaria). |
| Motor de markdown | **react-markdown + remark-gfm** | 1 dep robusta e segura (sem `innerHTML` cru por padrão), cobre o parecer E os `.md` completos (tabelas/headings). Rejeitado renderizador à mão: não dá conta de tabelas/headings dos `.md`. |

## Arquitetura

### 1. `web/src/components/Markdown.tsx` (novo) — a peça única de render

Envelopa `react-markdown` + `remark-gfm` num componente com `className` escopada `.md-body`.

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ? `md-body ${className}` : "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
```

- Segurança: react-markdown **não** renderiza HTML cru por padrão (sem `rehype-raw`), então
  conteúdo entre tags HTML é escapado — seguro, e suficiente porque a fonte é markdown.
- O estilo de cada elemento (h1-h4, p, ul/ol, code inline/bloco, table, blockquote, a, hr)
  vem do CSS escopado em `.md-body` (não precisa de `components={}` override por enquanto —
  YAGNI; se um elemento precisar de comportamento, adiciona-se depois).
- Reusado em: respostas do parecer, rationale do veredicto, descrições de AC, o
  visualizador de `.md`, e o `SpecSummaryBlock`.

### 2. `DeliveryReportBlock.tsx` — redesenho em accordion

- **Veredicto**: banner sempre visível no topo; `rationale` renderizado via `<Markdown>`.
- **As 11 respostas**: cada uma vira `<details className="delivery-answer">` com
  `<summary>` = título (pt-BR) + badge de confidence; corpo = `<Markdown>{answer}` + chips
  de `evidence_refs`. A **primeira** (`what_was_done`) recebe `open` por padrão; as demais
  fechadas. Usar `<details>/<summary>` nativo: acessível, navegável por teclado, sem estado
  React.
- **Critérios de aceite**: vira `<details className="delivery-acs-wrap">` **fechado por
  padrão**, com `<summary>` resumindo a contagem por classificação (ex.: "Critérios de
  aceite — 25 atendidos · 6 parciais"). Dentro, a tabela atual (colorida por
  `classification`); a coluna de descrição passa a renderizar markdown inline (tem código
  tipo `landingStep`).
  - O resumo de contagem é derivado de `acceptanceCriteria` agrupando por
    `classificationLabel(c).label`, na ordem met → partial → not_met → not_validated →
    unknown, omitindo zeros. Ex.: `25 atendidos · 6 parcialmente atendidos`.
- **"ver narrativa completa →"**: deixa de ser `<a href>` e vira `<button>` que chama
  `onOpenFile(report.mdPath, "delivery-report.md")` (nova prop).
- Placeholder ("sem parecer de entrega ainda") inalterado.

Nova prop do componente: `onOpenFile?: (path: string, title: string) => void`.

### 3. `web/src/components/MarkdownViewer.tsx` (novo) — modal de `.md`

```tsx
export function MarkdownViewer({
  path, title, onClose,
}: { path: string | null; title: string; onClose: () => void });
```

- Quando `path` != null, renderiza um overlay (mesmo padrão visual do `drawer-overlay`).
- Faz `fetch("/file?path=" + encodeURIComponent(path))`, lê `.text()` (o `/file` já serve
  texto cru — **reaproveitado sem mexer no backend**), e renderiza com `<Markdown>`.
- Estados: carregando ("carregando…"), erro (mensagem do fetch falho), pronto.
- Fecha por: botão ✕, clique no overlay, tecla `Esc`.
- Cancelamento: usa `AbortController` no `useEffect` pra abortar o fetch se `path` mudar
  ou o componente desmontar (evita setState após unmount).

### 4. `DetailDrawer.tsx` — dono do estado do viewer

- `const [viewer, setViewer] = useState<{ path: string; title: string } | null>(null)`.
- Passa `onOpenFile={(path, title) => setViewer({ path, title })}` para `DeliveryReportBlock`
  e `Timeline`.
- Renderiza `<MarkdownViewer path={viewer?.path ?? null} title={viewer?.title ?? ""}
  onClose={() => setViewer(null)} />` no fim da gaveta.
- `report.html` (custo) continua `<a href target=_blank>` — é HTML, não entra no viewer.

### 5. `Timeline.tsx` — links viram aberturas in-app

- Hoje cada doc é um `<a href="/file?path=...">`. Passa a `<button>` que chama
  `onOpenFile(`${specDir}/${d}`, d)`. Nova prop `onOpenFile` (mesma assinatura).
- A lista de docs (`["spec.md","plan.md","tasks.md"]` / `["memo.md"]`) e a derivação do
  `specDir` ficam iguais — só o elemento clicável muda de `<a>` para `<button>`.

### 6. `SpecSummaryBlock.tsx` — bônus de consistência

- Troca `<div className="spec-summary-text">{s.text}</div>` por
  `<Markdown className="spec-summary-text">{s.text}</Markdown>`. O texto da IA costuma ter
  markdown; renderiza incremental sem quebrar (react-markdown tolera markdown parcial
  durante o streaming).

### 7. Dependências

- `npm install react-markdown remark-gfm` (deps de produção). Compatíveis com React 18.3.

### 8. Estilo (`web/src/app.css`)

- **`.md-body`**: tipografia do markdown renderizado — `h1-h4` (tamanhos decrescentes,
  peso), `p` (line-height ~1.55, espaçamento), `ul/ol` (indent + gap), `code` inline (fundo
  cinza claro, mono, padding), `pre code` (bloco com fundo, scroll-x), `table` (borda,
  zebra leve, `th` em negrito), `blockquote` (borda-esquerda + itálico/cor), `a` (azul,
  underline no hover), `hr`. Tudo light.
- **Accordion** (`details.delivery-answer`, `summary`): cursor pointer, marcador custom
  (▸/▾ via `summary::-webkit-details-marker { display:none }` + um `::before`), espaçamento,
  o badge de confidence alinhado à direita no summary.
- **Viewer modal** (`.md-viewer-overlay`, `.md-viewer`, header com título + ✕, corpo com
  scroll). Reusa tokens visuais do `.drawer`.

### 9. Garantia READ-ONLY

Nada novo escreve em disco. O viewer só faz `GET /file` (leitura, já validado pra paths
dentro de projetos conhecidos). Backend **não muda**.

## Testes

- **`Markdown.test.tsx`** (novo): `**x**` → `<strong>`; `` `x` `` → `<code>`; `- a\n- b` →
  `<li>` ×2; uma tabela gfm `| a | b |` → `<table>`. Confirma que as marcações viram tags,
  não texto.
- **`MarkdownViewer.test.tsx`** (novo): com `path` mockando `fetch` → renderiza o markdown;
  estado de erro quando `fetch` rejeita; não renderiza nada quando `path` é null; `Esc`/✕
  chamam `onClose`.
- **`DeliveryReportBlock.test.tsx`** (atualizar): respostas agora em `<details>` (a primeira
  `open`); o corpo renderiza markdown (ex.: um `**` vira `<strong>`); badge de confidence no
  `<summary>`; a seção de ACs colapsável com o resumo de contagem; "ver narrativa completa"
  é `<button>` e chama `onOpenFile` com o path certo; placeholder quando `report` null.
- **`Timeline.test.tsx`** (atualizar): os docs viram `<button>` que chamam `onOpenFile` com
  `${specDir}/${doc}` (não mais `<a href>`).
- **`SpecSummaryBlock.test.tsx`** (atualizar se quebrar): o texto continua aparecendo
  (agora dentro de `.md-body`); ajustar queries se necessário.

## Fora de escopo (YAGNI)

- Override de `components={}` por elemento no react-markdown (só CSS por enquanto).
- Realce de sintaxe (syntax highlighting) em code-fences — só `<pre><code>` estilizado.
- Renderizar `report.html` no viewer (é HTML; continua link externo).
- Mudar o `/file` no backend (o text/plain cru é exatamente o que o viewer consome).
- Busca/índice dentro do viewer; navegação entre `.md`.
