import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CostRollup } from "../store/types.js";

interface RawModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface RawCostFile {
  total_cost_usd?: number;
  by_model?: Record<string, RawModelUsage>;
  unpriced_models?: string[];
}

function emptyRollup(reportPath: string | null): CostRollup {
  return {
    totalCostUsd: null,
    partial: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    totalTokens: 0,
    reportPath,
  };
}

/**
 * Soma os custos JÁ GRAVADOS nos costs/*.json de uma Session.
 * NUNCA aplica pricing — apenas soma total_cost_usd e tokens já persistidos,
 * exatamente como o report do ai-squad faz. Read-only.
 */
export function readCostRollup(specDir: string): CostRollup {
  const reportPath = existsSync(join(specDir, "report.html"))
    ? join(specDir, "report.html")
    : null;
  const costsDir = join(specDir, "costs");
  if (!existsSync(costsDir)) return emptyRollup(reportPath);

  const files = readdirSync(costsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return emptyRollup(reportPath);

  let totalCostUsd: number | null = null;
  let partial = false;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

  for (const f of files) {
    let raw: RawCostFile;
    try {
      raw = JSON.parse(readFileSync(join(costsDir, f), "utf-8"));
    } catch {
      continue; // arquivo corrompido: ignora, não inventa número
    }
    if (typeof raw.total_cost_usd === "number") totalCostUsd = (totalCostUsd ?? 0) + raw.total_cost_usd;
    if (Array.isArray(raw.unpriced_models) && raw.unpriced_models.length > 0)
      partial = true;
    for (const usage of Object.values(raw.by_model ?? {})) {
      tokens.input += usage.input_tokens ?? 0;
      tokens.output += usage.output_tokens ?? 0;
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
      tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }
  }

  const totalTokens =
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return { totalCostUsd, partial, tokens, totalTokens, reportPath };
}
