import { useState } from "react";
import { parsePatch, tokenDiff, similarity, langFromPath, type DiffHunk, type DiffLine } from "../lib/diff";
import { mergeSyntaxAndDiff, useHighlightLine, type HighlightLine, type DiffSeg } from "../lib/syntax";

const COLLAPSE_THRESHOLD = 6; // contexto maior que isto colapsa
const CONTEXT_EDGE = 3; // linhas mantidas em cada borda do bloco colapsado
// abaixo disto o par é tratado como troca inteira (sem word-level). 0.4 admite
// renomeações em linhas curtas (~0.45) e barra pares só coincidentes (~0.1).
const SIMILARITY_MIN = 0.4;

/**
 * Calcula o realce word-level por linha. Para cada bloco −/+, pareia as
 * primeiras min(N, M) linhas por índice e, em cada par, só destaca palavra se
 * as linhas forem parecidas (trava de similaridade) — assim blocos
 * desbalanceados também ganham word-level, sem destaque coincidente errado.
 */
function pairWordDiffs(lines: DiffLine[]): Map<DiffLine, DiffSeg[]> {
  const segs = new Map<DiffLine, DiffSeg[]>();
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "del") {
      i++;
      continue;
    }
    let d = i;
    while (d < lines.length && lines[d].kind === "del") d++;
    let a = d;
    while (a < lines.length && lines[a].kind === "add") a++;
    const dels = lines.slice(i, d);
    const adds = lines.slice(d, a);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      if (similarity(dels[k].text, adds[k].text) < SIMILARITY_MIN) continue;
      const td = tokenDiff(dels[k].text, adds[k].text);
      segs.set(dels[k], td.old);
      segs.set(adds[k], td.new);
    }
    i = a > i ? a : i + 1;
  }
  return segs;
}

type Row =
  | { kind: "line"; line: DiffLine }
  | { kind: "fold"; id: string; lines: DiffLine[] };

/** Achata um hunk em linhas, colapsando o miolo de blocos longos de contexto. */
function buildRows(hunk: DiffHunk, hi: number): Row[] {
  const rows: Row[] = [];
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== "context") {
      rows.push({ kind: "line", line: lines[i] });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j].kind === "context") j++;
    const run = lines.slice(i, j);
    if (run.length > COLLAPSE_THRESHOLD) {
      for (const l of run.slice(0, CONTEXT_EDGE)) rows.push({ kind: "line", line: l });
      rows.push({ kind: "fold", id: `${hi}:${i}`, lines: run.slice(CONTEXT_EDGE, run.length - CONTEXT_EDGE) });
      for (const l of run.slice(run.length - CONTEXT_EDGE)) rows.push({ kind: "line", line: l });
    } else {
      for (const l of run) rows.push({ kind: "line", line: l });
    }
    i = j;
  }
  return rows;
}

/** Conteúdo de uma linha: com highlighter, funde cor de sintaxe + word-level;
 *  sem highlighter, mostra só o word-level (ou texto puro). */
function LineContent({
  line,
  wordSegs,
  highlightLine,
}: {
  line: DiffLine;
  wordSegs?: DiffSeg[];
  highlightLine: HighlightLine | null;
}) {
  if (highlightLine) {
    const merged = mergeSyntaxAndDiff(highlightLine(line.text), wordSegs ?? null);
    return (
      <>
        {merged.map((s, i) => (
          <span key={i} className={s.changed ? "diff-word" : undefined} style={{ color: s.color }}>
            {s.text}
          </span>
        ))}
      </>
    );
  }
  if (wordSegs) {
    return (
      <>
        {wordSegs.map((s, i) =>
          s.changed ? (
            <span key={i} className="diff-word">{s.text}</span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </>
    );
  }
  return <>{line.text}</>;
}

function LineRow({
  line,
  wordSegs,
  highlightLine,
}: {
  line: DiffLine;
  wordSegs?: DiffSeg[];
  highlightLine: HighlightLine | null;
}) {
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const no = line.kind === "del" ? line.oldNo : line.newNo;
  return (
    <div className={`diff-line ${line.kind}`}>
      <span className="diff-gutter">{no ?? ""}</span>
      <span className="diff-sign" aria-hidden="true">{sign}</span>
      <span className="diff-content">
        <LineContent line={line} wordSegs={wordSegs} highlightLine={highlightLine} />
      </span>
    </div>
  );
}

/** Renderiza um unified diff first-class: linhas coloridas, gutter, word-level,
 *  colapso e syntax highlighting (Dracula) quando a linguagem é conhecida. */
export function DiffView({
  patch,
  path,
  highlightLine: hlProp,
}: {
  patch: string;
  path?: string | null;
  highlightLine?: HighlightLine;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const lang = langFromPath(path ?? null);
  const hlHook = useHighlightLine(lang);
  const highlightLine = hlProp ?? hlHook;
  const hunks = parsePatch(patch);
  if (hunks.length === 0) return null;

  const wordSegs = pairWordDiffs(hunks.flatMap((h) => h.lines));
  // painel escuro quando há syntax (ou intenção de syntax: linguagem conhecida)
  const dark = hlProp != null || lang !== "text";

  return (
    <div className={`diff-view mono${dark ? " dracula" : ""}`}>
      {hunks.map((hunk, hi) => (
        <div key={hi} className="diff-hunk-group">
          <div className="diff-hunk">
            <span className="diff-hunk-mark">@@</span>
            {hunk.header && <span className="diff-hunk-ctx">{hunk.header}</span>}
          </div>
          {buildRows(hunk, hi).map((row, ri) => {
            if (row.kind === "fold" && !expanded.has(row.id)) {
              return (
                <button
                  key={ri}
                  type="button"
                  className="diff-fold"
                  onClick={() => setExpanded((prev) => new Set(prev).add(row.id))}
                >
                  ··· {row.lines.length} linhas ···
                </button>
              );
            }
            if (row.kind === "fold") {
              return row.lines.map((l, li) => (
                <LineRow key={`${ri}-${li}`} line={l} wordSegs={wordSegs.get(l)} highlightLine={highlightLine} />
              ));
            }
            return (
              <LineRow key={ri} line={row.line} wordSegs={wordSegs.get(row.line)} highlightLine={highlightLine} />
            );
          })}
        </div>
      ))}
    </div>
  );
}
