import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CostRollup } from "../store/types.js";
import { readCostReport } from "./cost-report.js";

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

interface RawSum {
  totalCostUsd: number | null;
  partial: boolean;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  totalTokens: number;
  hasData: boolean;
}

/**
 * Soma crua dos costs/*.json — o plano B quando não há cost-report.json (ou
 * quando ele não traz bloco de tokens). NUNCA aplica pricing; só soma números já
 * gravados. Read-only.
 */
function sumRawCosts(costsDir: string): RawSum {
  const empty: RawSum = {
    totalCostUsd: null,
    partial: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    totalTokens: 0,
    hasData: false,
  };
  if (!existsSync(costsDir)) return empty;
  const files = readdirSync(costsDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return empty;

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
    if (Array.isArray(raw.unpriced_models) && raw.unpriced_models.length > 0) partial = true;
    for (const usage of Object.values(raw.by_model ?? {})) {
      tokens.input += usage.input_tokens ?? 0;
      tokens.output += usage.output_tokens ?? 0;
      tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
      tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }
  }

  const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return { totalCostUsd, partial, tokens, totalTokens, hasData: true };
}

/**
 * Custo de uma Session. Se existe cost-report.json válido (artefato canônico/
 * escopado da pipeline), ele é a fonte de verdade (source="authoritative"); senão
 * cai na soma crua dos costs/*.json (source="preliminary") ou vazio. Read-only.
 */
export function readCostRollup(specDir: string): CostRollup {
  const reportPath = existsSync(join(specDir, "report.html"))
    ? join(specDir, "report.html")
    : null;

  const report = readCostReport(specDir);

  if (report) {
    // Usa tokens do report só quando há breakdown E total (caso canônico); se
    // qualquer um faltar, cai TODO na soma crua, pra breakdown e total virem da
    // mesma fonte (D2 + I1). report.tokens null = sem bloco; totalTokens null =
    // bloco presente mas sem `total`.
    const reportHasTokens = report.tokens !== null && report.totalTokens !== null;
    // raw é sempre RawSum quando reportHasTokens=false; por isso os `!` abaixo são seguros
    const raw = reportHasTokens ? null : sumRawCosts(join(specDir, "costs"));
    const tokens = reportHasTokens ? report.tokens! : raw!.tokens;
    const totalTokens = reportHasTokens ? report.totalTokens! : raw!.totalTokens;
    return {
      totalCostUsd: report.totalCostUsd,
      partial: report.partial,
      tokens,
      totalTokens,
      reportPath,
      source: "authoritative",
      scopingSuspect: report.scopingSuspect,
      excludedSubagents: report.excludedSubagents,
      recoveredSubagents: report.recoveredSubagents,
      byPhase: report.byPhase,
      complete: report.complete,
    };
  }

  const raw = sumRawCosts(join(specDir, "costs"));
  return {
    totalCostUsd: raw.totalCostUsd,
    partial: raw.partial,
    tokens: raw.tokens,
    totalTokens: raw.totalTokens,
    reportPath,
    source: raw.hasData ? "preliminary" : "empty",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null,
    complete: null,
  };
}
