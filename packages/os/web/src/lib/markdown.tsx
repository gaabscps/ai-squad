import { Fragment, type ReactNode } from "react";

/**
 * Renderer de markdown de um SUBCONJUNTO — só o que os resumos do CLI emitem
 * (negrito, código inline, itálico, listas, títulos, parágrafos). Constrói nós
 * React (não innerHTML) → seguro contra injeção. O que não reconhece cai como
 * texto literal (degradação segura), o que também cobre tokens ainda-abertos
 * durante a digitação letra a letra.
 */

const LIST_RE = /^\s*([-*]|\d+\.)\s+/;
const ORDERED_RE = /^\s*\d+\.\s+/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const INLINE_RE = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*?)\*)/g;

/** Converte uma linha em nós React, resolvendo negrito/código/itálico inline. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  let k = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] != null) out.push(<strong key={`${keyBase}-${k}`}>{m[2]}</strong>);
    else if (m[3] != null) out.push(<code className="md-code" key={`${keyBase}-${k}`}>{m[3]}</code>);
    else if (m[4] != null) out.push(<em key={`${keyBase}-${k}`}>{m[4]}</em>);
    last = m.index + m[0].length;
    k++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Inline + quebras de linha simples (\n vira <br/>) dentro de um parágrafo. */
function renderWithBreaks(text: string, keyBase: string): ReactNode[] {
  const lines = text.split("\n");
  return lines.flatMap((ln, i) =>
    i === 0 ? renderInline(ln, `${keyBase}-l${i}`) : [<br key={`${keyBase}-br${i}`} />, ...renderInline(ln, `${keyBase}-l${i}`)],
  );
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }

    const heading = HEADING_RE.exec(line);
    if (heading) { blocks.push({ kind: "h", text: heading[2] }); i++; continue; }

    if (LIST_RE.test(line)) {
      const ordered = ORDERED_RE.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        items.push(lines[i].replace(LIST_RE, ""));
        i++;
      }
      blocks.push(ordered ? { kind: "ol", items } : { kind: "ul", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !LIST_RE.test(lines[i]) && !HEADING_RE.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", text: para.join("\n") });
  }
  return blocks;
}

export function MarkdownText({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "h") return <p className="md-h" key={i}>{renderInline(b.text, `h${i}`)}</p>;
        if (b.kind === "ul" || b.kind === "ol") {
          const items = b.items.map((it, j) => <li key={j}>{renderInline(it, `li${i}-${j}`)}</li>);
          return b.kind === "ol"
            ? <ol className="md-list" key={i}>{items}</ol>
            : <ul className="md-list" key={i}>{items}</ul>;
        }
        return <p className="md-p" key={i}><Fragment>{renderWithBreaks(b.text, `p${i}`)}</Fragment></p>;
      })}
    </>
  );
}
