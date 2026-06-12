// Primeira frase de um markdown, em texto plano — teaser de one-liner na UI.
export function firstSentence(md: string, max = 140): string {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const m = plain.match(/^.*?[.!?](?=\s|$)/);
  const s = (m ? m[0] : plain).trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}
