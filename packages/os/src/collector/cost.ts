import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CostRollup, CostPhaseBreakdown } from "../store/types.js";
import { parseReport } from "./report.js";

interface RawModelUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}
interface RawCostBlock {
  total_cost_usd?: number;
  by_model?: Record<string, RawModelUsage>;
  unpriced_models?: string[];
}
interface RawCostFile extends RawCostBlock {
  scope?: string;
  // capture-session-cost.py grava scope: "session" com o custo aninhado em
  // planning/orchestration, não em total_cost_usd/by_model na raiz do arquivo.
  planning?: RawCostBlock;
  orchestration?: RawCostBlock;
}

interface RawSum {
  totalCostUsd: number | null;
  partial: boolean;
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number };
  totalTokens: number;
  hasData: boolean;
}

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
      continue;
    }

    // scope: "session" aninha o custo em planning/orchestration em vez de
    // total_cost_usd/by_model na raiz — soma os dois blocos nesse caso.
    const blocks: RawCostBlock[] =
      raw.scope === "session" ? [raw.planning ?? {}, raw.orchestration ?? {}] : [raw];

    for (const block of blocks) {
      if (typeof block.total_cost_usd === "number")
        totalCostUsd = (totalCostUsd ?? 0) + block.total_cost_usd;
      if (Array.isArray(block.unpriced_models) && block.unpriced_models.length > 0) partial = true;
      for (const usage of Object.values(block.by_model ?? {})) {
        tokens.input += usage.input_tokens ?? 0;
        tokens.output += usage.output_tokens ?? 0;
        tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
        tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0;
      }
    }
  }

  const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return { totalCostUsd, partial, tokens, totalTokens, hasData: true };
}

/**
 * Fallback de custo exclusivo para sessões observadas: soma crua costs/*.json,
 * nunca toca report.html — evita que um dir observado stale retorne source="report"
 * ou source="unreliable" com totais parciais tratados como canônicos.
 * Preserva o reportPath para o link do drawer quando report.html existe.
 * Source: "partial" (com dados) | "empty" (sem costs/).
 */
export function readRawCostRollup(specDir: string): CostRollup {
  const reportHtmlPath = join(specDir, "report.html");
  const reportPath = existsSync(reportHtmlPath) ? reportHtmlPath : null;
  const raw = sumRawCosts(join(specDir, "costs"));
  return {
    totalCostUsd: raw.totalCostUsd,
    partial: raw.partial,
    tokens: raw.tokens,
    totalTokens: raw.totalTokens,
    reportPath,
    source: raw.hasData ? "partial" : "empty",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null,
    complete: null,
  };
}

/**
 * Custo de uma Session SDD. Prioridade: report.html parseado (source="report") >
 * report.html não-parseável (source="unreliable") > soma crua costs/*.json
 * (source="partial") > nada (source="empty").
 * Sessões observadas usam readObservedCostRollup (cost-report.ts), que consulta
 * cost-report.json como fonte primária e cai em readRawCostRollup (jamais aqui)
 * como fallback de staleness — garantindo que report.html nunca seja consultado
 * para dirs observados.
 * Read-only.
 */
export function readCostRollup(specDir: string): CostRollup {
  const reportHtmlPath = join(specDir, "report.html");
  const reportExists = existsSync(reportHtmlPath);
  const reportPath = reportExists ? reportHtmlPath : null;

  if (reportExists) {
    let html: string;
    try {
      html = readFileSync(reportHtmlPath, "utf-8");
    } catch {
      // File may be mid-write; treat as unreliable rather than crashing
      const raw = sumRawCosts(join(specDir, "costs"));
      return {
        totalCostUsd: raw.totalCostUsd,
        partial: raw.partial,
        tokens: raw.tokens,
        totalTokens: raw.totalTokens,
        reportPath,
        source: "unreliable",
        scopingSuspect: false,
        excludedSubagents: null,
        recoveredSubagents: null,
        byPhase: null,
        complete: null,
      };
    }

    const reportData = parseReport(html);

    if (reportData !== null) {
      const byPhase: CostPhaseBreakdown = {
        planning: reportData.byPhase.planning?.dollars ?? null,
        orchestration: reportData.byPhase.orchestration?.dollars ?? null,
        implementation: reportData.byPhase.implementation?.dollars ?? null,
      };

      return {
        totalCostUsd: reportData.totalDollars,
        partial: false,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        totalTokens: reportData.totalTokens,
        reportPath,
        source: "report",
        scopingSuspect: false,
        excludedSubagents: null,
        recoveredSubagents: null,
        byPhase,
        complete: null,
      };
    }

    const raw = sumRawCosts(join(specDir, "costs"));
    return {
      totalCostUsd: raw.totalCostUsd,
      partial: raw.partial,
      tokens: raw.tokens,
      totalTokens: raw.totalTokens,
      reportPath,
      source: "unreliable",
      scopingSuspect: false,
      excludedSubagents: null,
      recoveredSubagents: null,
      byPhase: null,
      complete: null,
    };
  }

  const raw = sumRawCosts(join(specDir, "costs"));
  return {
    totalCostUsd: raw.totalCostUsd,
    partial: raw.partial,
    tokens: raw.tokens,
    totalTokens: raw.totalTokens,
    reportPath: null,
    source: raw.hasData ? "partial" : "empty",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null,
    complete: null,
  };
}
