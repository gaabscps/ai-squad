import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProductSummary } from "./types.js";
import { normalizeProductSummary } from "./parse.js";

// LEITURA read-only do resumo selado pelo /ship em .agent-session/<spec>/product-summary.json.
// Módulo separado de cache.ts de propósito: cache.ts é dono do .aios-cache (território do aiOS);
// aqui lemos o .agent-session do projeto (território do consumidor), nunca escrevendo.

export interface SealedProductSummary {
  summary: ProductSummary;
  sealedAt: string;        // ISO-8601 carimbado pelo /ship
  outputLocale: string | null;
}

/** Lê o resumo selado, ou null se ausente/corrompido/shape inválido. Nunca lança. */
export function readSealedProductSummary(sessionDir: string): SealedProductSummary | null {
  const file = join(sessionDir, "product-summary.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (!parsed?.summary || typeof parsed.sealedAt !== "string") return null;
    return {
      summary: normalizeProductSummary(parsed.summary),
      sealedAt: parsed.sealedAt,
      outputLocale: typeof parsed.outputLocale === "string" && parsed.outputLocale ? parsed.outputLocale : null,
    };
  } catch {
    return null;
  }
}
