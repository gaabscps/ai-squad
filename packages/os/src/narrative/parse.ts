import type {
  SessionNarrative, NarrativeChange, NarrativeDecision,
  NarrativeVerification, NarrativePrGroup,
} from "./types.js";

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function strOrNull(v: unknown): string | null { return typeof v === "string" && v.length ? v : null; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; }

function asChange(v: unknown): NarrativeChange {
  const o = (v ?? {}) as Record<string, unknown>;
  return { title: str(o.title), prose: str(o.prose), files: strArr(o.files), primaryFile: strOrNull(o.primaryFile) };
}
function asDecision(v: unknown): NarrativeDecision {
  const o = (v ?? {}) as Record<string, unknown>;
  return { what: str(o.what), why: strOrNull(o.why), tradeoff: strOrNull(o.tradeoff) };
}
function asVerification(v: unknown): NarrativeVerification {
  const o = (v ?? {}) as Record<string, unknown>;
  return { cmd: str(o.cmd), passed: typeof o.passed === "boolean" ? o.passed : null };
}
function asGroup(v: unknown): NarrativePrGroup {
  const o = (v ?? {}) as Record<string, unknown>;
  return { label: str(o.label), files: strArr(o.files), lookFirst: o.lookFirst === true };
}
function arr<T>(v: unknown, f: (x: unknown) => T): T[] { return Array.isArray(v) ? v.map(f) : []; }

/** Extrai o objeto JSON da saída do LLM (tolera cercas ```json e texto ao redor). null se não houver JSON parseável. */
export function parseNarrative(raw: string): SessionNarrative | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const pr = (obj.prReview ?? {}) as Record<string, unknown>;
  return {
    tldr: str(obj.tldr),
    why: str(obj.why),
    changes: arr(obj.changes, asChange),
    decisions: arr(obj.decisions, asDecision),
    verifications: arr(obj.verifications, asVerification),
    prReview: { groups: arr(pr.groups, asGroup), risk: strOrNull(pr.risk) },
  };
}
