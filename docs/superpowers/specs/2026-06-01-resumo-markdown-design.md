# Design — renderização de markdown no resumo (negrito, listas, etc.)

Data: 2026-06-01
Escopo: só a apresentação do texto do resumo no `SummaryBlock`. Renderer próprio, zero dependência.
Fora de escopo: parser markdown completo; qualquer coisa fora do aside.

## Problema

O resumo do CLI vem em markdown (`**negrito**`, `` `código` ``, listas, títulos), mas é renderizado como texto puro com `white-space: pre-wrap` — então os `**` e `` ` `` aparecem literais. Fica feio.

## Decisão: renderer próprio (não lib)

Escolhido sobre `react-markdown`: o projeto inteiro evita libs (WS e estado hand-rolled), o resumo usa um subconjunto previsível, e um parser focado evita +40kb de deps. Constrói **nós React** (não `innerHTML`) → seguro contra injeção.

## `web/src/lib/markdown.tsx` — `<MarkdownText source={string} />`

Parser em duas camadas:

**Blocos** (split por `\n`, agrupando):
- Linha `#{1,6} texto` → título (`<p class="md-h">`, negrito; não usa `<h*>` pra não brigar com a hierarquia do drawer).
- Run de linhas `-`/`*`/`N.` → lista (`<ul>`/`<ol>` com `<li>`).
- Demais linhas consecutivas (até linha em branco / lista / título) → parágrafo (`<p class="md-p">`); `\n` interno vira `<br>`.
- Linha em branco separa blocos.

**Inline** (dentro de cada bloco), via regex com alternação na ordem:
- `**negrito**` → `<strong>`
- `` `código` `` → `<code class="md-code">`
- `*itálico*` → `<em>`
- Token aberto/sem fechamento (ex.: `**tipos` no meio do stream) não casa → cai como texto literal (degradação segura, é o que dá o artefato mínimo durante a digitação).

## Interação com o typewriter

`source` = o `display` parcial do typewriter (prefixo do markdown cru). Parseado a cada render. Bloco/token incompleto renderiza parcial/literal por uma fração de segundo até completar — aceitável durante o ~1s de revelação. Cursor `▋` segue após o conteúdo enquanto `typing`.

## Encaixe no `SummaryBlock`

Troca `<p className="task-summary-text">{display}</p>` por:
```tsx
<div className="task-summary-text">
  <MarkdownText source={display} />
  {typing && <span className="task-summary-cursor" aria-hidden="true">▋</span>}
</div>
```
`.task-summary-text` perde o `pre-wrap` (o markdown estrutura agora); estiliza descendentes `.md-p`/`.md-h`/`ul`/`ol`/`.md-code`.

## Testes (parser puro)

`render(<MarkdownText source={...}/>)` e checa o DOM:
- `**x**` → `<strong>`; `` `x` `` → `code`; `*x*` → `<em>`.
- lista `-`/`*` → `ul>li`; `1.` → `ol>li`.
- `## t` → elemento de título com o texto.
- dois parágrafos separados por linha em branco → dois `<p>`.
- markdown malformado (`**sem fechar`) → texto literal, sem quebrar.
- texto sem markdown → um `<p>` com o texto.

Sem teste visual novo; verifico no preview.
