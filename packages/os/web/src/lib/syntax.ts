// Syntax highlighting (tema Dracula via Shiki) integrado ao realce word-level.
// A parte pura (mergeSyntaxAndDiff) é testável sozinha; o wrapper do Shiki é
// assíncrono e verificado no browser.
import { useEffect, useState } from "react";
import { getSingletonHighlighter, type Highlighter } from "shiki";

export interface SyntaxSeg {
  text: string;
  color: string;
}
export interface DiffSeg {
  text: string;
  changed: boolean;
}
export interface MergedSeg {
  text: string;
  color: string;
  changed: boolean;
}

/**
 * Funde a segmentação de sintaxe (cor de texto) com a de diff (changed) sobre a
 * mesma linha, quebrando na união das fronteiras. Sintaxe define foreground;
 * o word-level fica no background — por isso compõem sem conflito.
 */
export function mergeSyntaxAndDiff(syntax: SyntaxSeg[], diff: DiffSeg[] | null): MergedSeg[] {
  if (!diff) {
    return syntax.map((s) => ({ text: s.text, color: s.color, changed: false }));
  }

  const out: MergedSeg[] = [];
  let i = 0;
  let j = 0;
  let si = 0;
  let dj = 0;
  while (i < syntax.length && j < diff.length) {
    const take = Math.min(syntax[i].text.length - si, diff[j].text.length - dj);
    out.push({
      text: syntax[i].text.slice(si, si + take),
      color: syntax[i].color,
      changed: diff[j].changed,
    });
    si += take;
    dj += take;
    if (si >= syntax[i].text.length) {
      i++;
      si = 0;
    }
    if (dj >= diff[j].text.length) {
      j++;
      dj = 0;
    }
  }
  // sobra de sintaxe (diff mais curto): trata como inalterado
  while (i < syntax.length) {
    out.push({ text: syntax[i].text.slice(si), color: syntax[i].color, changed: false });
    i++;
    si = 0;
  }
  return out;
}

export type HighlightLine = (text: string) => SyntaxSeg[];

export const DRACULA_BG = "#282A36";
export const DRACULA_FG = "#F8F8F2";

const THEME = "dracula";
const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "python",
  "css",
  "scss",
  "html",
  "markdown",
  "bash",
  "yaml",
  "go",
  "rust",
  "java",
  "ruby",
  "php",
  "sql",
];

let highlighterPromise: Promise<Highlighter> | null = null;
function loadHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = getSingletonHighlighter({ themes: [THEME], langs: LANGS });
  }
  return highlighterPromise;
}

/**
 * Devolve uma função síncrona que tokeniza UMA linha no tema Dracula, ou null
 * enquanto o highlighter carrega (async) ou quando a linguagem é desconhecida —
 * nesse caso o DiffView renderiza sem cor (fallback seguro, nunca quebra).
 */
export function useHighlightLine(lang: string): HighlightLine | null {
  const [hl, setHl] = useState<Highlighter | null>(null);

  useEffect(() => {
    let alive = true;
    loadHighlighter()
      .then((h) => {
        if (alive) setHl(h);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!hl || lang === "text") return null;

  return (text: string) => {
    try {
      const { tokens } = hl.codeToTokens(text, { lang, theme: THEME });
      return (tokens[0] ?? []).map((t) => ({ text: t.content, color: t.color ?? DRACULA_FG }));
    } catch {
      return [{ text, color: DRACULA_FG }];
    }
  };
}
