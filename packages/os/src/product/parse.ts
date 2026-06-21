import type { ProductSummary, ProductDecision } from "./types.js";

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function strOrNull(v: unknown): string | null { return typeof v === "string" && v.length ? v : null; }
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

function asDecision(v: unknown): ProductDecision {
  const o = (v ?? {}) as Record<string, unknown>;
  return { what: str(o.what), why: strOrNull(o.why), rejected: strOrNull(o.rejected) };
}
function arr<T>(v: unknown, f: (x: unknown) => T): T[] { return Array.isArray(v) ? v.map(f) : []; }

/** Extrai o ProductSummary do JSON do LLM (tolera cercas ```json e texto ao redor). null se não houver JSON parseável. */
export function parseProductSummary(raw: string): ProductSummary | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    tldr: str(obj.tldr),
    // descarta decisões sem 'what' (lixo) — alinhado à regra anti-invenção do prompt
    decided: arr(obj.decided, asDecision).filter((d) => d.what.trim().length > 0),
    open: strArr(obj.open),
    next: strArr(obj.next),
    deliverable: str(obj.deliverable),
  };
}
