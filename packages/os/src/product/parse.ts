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

/** Normaliza um objeto já parseado em ProductSummary (descarta decisão sem 'what' e strings vazias). */
export function normalizeProductSummary(obj: unknown): ProductSummary {
  const o = (obj ?? {}) as Record<string, unknown>;
  return {
    tldr: str(o.tldr),
    // descarta decisões sem 'what' (lixo) — alinhado à regra anti-invenção do prompt
    decided: arr(o.decided, asDecision).filter((d) => d.what.trim().length > 0),
    open: strArr(o.open),
    next: strArr(o.next),
    deliverable: str(o.deliverable),
  };
}

/** Extrai o ProductSummary do JSON do LLM (tolera cercas ```json e texto ao redor). null se não houver JSON parseável. */
export function parseProductSummary(raw: string): ProductSummary | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return normalizeProductSummary(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}
