import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ProductSummary } from "./types.js";

// Espelha narrative/cache.ts, mas tipado para ProductSummary e em outro subdiretório
// (product-summaries) — caminhos isolados do cache da narrativa dev. Grava em cacheRoot
// (.aios-cache no cwd do aiOS), NUNCA no .agent-session do projeto (fronteira read-only).

export interface CachedProductSummary {
  summary: ProductSummary;
  generatedAt: string;
  fingerprint: string;
  costUsd: number | null;
}

function fileFor(cacheRoot: string, projectId: string, specId: string): string {
  return join(cacheRoot, "product-summaries", projectId, `${specId}.json`);
}

/** Lê o resumo cacheado, ou null se ausente/corrompido. Nunca lança. */
export function readProductSummary(cacheRoot: string, projectId: string, specId: string): CachedProductSummary | null {
  const file = fileFor(cacheRoot, projectId, specId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedProductSummary;
    if (parsed?.summary && typeof parsed.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava o resumo e devolve o registro salvo (com generatedAt carimbado pelo `now`). */
export function writeProductSummary(
  cacheRoot: string, projectId: string, specId: string,
  data: { summary: ProductSummary; fingerprint: string; costUsd: number | null },
  now: () => string,
): CachedProductSummary {
  const file = fileFor(cacheRoot, projectId, specId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedProductSummary = { summary: data.summary, fingerprint: data.fingerprint, costUsd: data.costUsd, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
