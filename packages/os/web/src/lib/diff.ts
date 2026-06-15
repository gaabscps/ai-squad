// Parser puro de unified diff (git diff) para o DiffView do drawer observado.
// Sem React, sem DOM — testável isoladamente.

export type DiffLineKind = "add" | "del" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string; // conteúdo sem o prefixo +/-/espaço
  oldNo: number | null; // linha no arquivo antigo (null em add)
  newNo: number | null; // linha no arquivo novo (null em del)
}

export interface DiffHunk {
  header: string; // contexto após o @@ (ex.: "function foo()")
  lines: DiffLine[];
}

// extensão → id de linguagem do Shiki (TextMate). Não mapeado → "text".
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  py: "python",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  go: "go",
  rs: "rust",
  java: "java",
  rb: "ruby",
  php: "php",
  sql: "sql",
};

/** Infere a linguagem pela extensão do caminho, para o highlighter. */
export function langFromPath(path: string | null): string {
  if (!path) return "text";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "text";
}

export interface TokenSeg {
  text: string;
  changed: boolean;
}

export interface TokenDiff {
  old: TokenSeg[];
  new: TokenSeg[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** Tokeniza em runs de palavra, espaço e pontuação (reconstrói o texto exato). */
function tokenize(text: string): string[] {
  return text.match(/\w+|\s+|[^\w\s]+/gu) ?? [];
}

/** Funde tokens consecutivos de mesma marca em segmentos. */
function coalesce(tokens: string[], changed: boolean[]): TokenSeg[] {
  const segs: TokenSeg[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const last = segs[segs.length - 1];
    if (last && last.changed === changed[i]) last.text += tokens[i];
    else segs.push({ text: tokens[i], changed: changed[i] });
  }
  return segs;
}

/**
 * Realce intra-linha por palavra. Roda um LCS (longest common subsequence)
 * entre os tokens das duas linhas: o que está fora da subsequência comum é o
 * trecho alterado de cada lado.
 */
export function tokenDiff(oldText: string, newText: string): TokenDiff {
  const a = tokenize(oldText);
  const b = tokenize(newText);

  // matriz LCS clássica
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const oldChanged = new Array(a.length).fill(true);
  const newChanged = new Array(b.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      oldChanged[i] = false;
      newChanged[j] = false;
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  return { old: coalesce(a, oldChanged), new: coalesce(b, newChanged) };
}

/**
 * Quão parecidas são duas linhas (0..1), por tokens em comum ignorando espaços.
 * Serve de trava para o word-level: se duas linhas pareadas forem dissimilares,
 * não vale destacar palavra (seria realce coincidente, enganoso) — devolve baixo.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const nonSpace = (s: string) => s.replace(/\s/g, "").length;
  const total = Math.max(nonSpace(a), nonSpace(b));
  if (total === 0) return 1;
  const td = tokenDiff(a, b);
  const common = td.old
    .filter((s) => !s.changed)
    .reduce((n, s) => n + nonSpace(s.text), 0);
  return common / total;
}

/** Quebra um unified diff em hunks com linhas classificadas e numeradas. */
export function parsePatch(patch: string): DiffHunk[] {
  if (!patch) return [];

  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of patch.split("\n")) {
    const m = HUNK_RE.exec(line);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      current = { header: m[3].trim(), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue; // ignora cabeçalhos de arquivo antes do 1º @@
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"

    const sign = line[0];
    if (sign === "+") {
      current.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo });
      newNo++;
    } else if (sign === "-") {
      current.lines.push({ kind: "del", text: line.slice(1), oldNo, newNo: null });
      oldNo++;
    } else {
      current.lines.push({ kind: "context", text: line.slice(1), oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }

  return hunks;
}
