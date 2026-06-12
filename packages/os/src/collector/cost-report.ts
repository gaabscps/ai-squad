import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Objeto já normalizado a partir do cost-report.json (artefato canônico/escopado
 * da pipeline SDD). Campos opcionais do arquivo viram null/defaults aqui — o
 * arquivo real é esparso (alguns sem bloco `tokens`, sem `scoping_suspect`).
 * `tokens` é null quando o arquivo não traz bloco de tokens — o coordenador
 * (cost.ts) resolve esse caso caindo na soma crua dos costs/*.json.
 */
export interface CostReport {
  totalCostUsd: number;
  byPhase: { planning: number | null; orchestration: number | null; implementation: number | null };
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number } | null;
  totalTokens: number | null;
  partial: boolean;
  scopingSuspect: boolean;
  excludedSubagents: number | null;
  recoveredSubagents: number | null;
  complete: boolean | null;
}

interface RawCostReport {
  planning_cost_usd?: number;
  orchestration_cost_usd?: number;
  implementation_cost_usd?: number;
  total_cost_usd?: number;
  subagent_count?: number; // presente no arquivo; não exposto — sem uso no aiOS ainda
  excluded_subagents?: number;
  recovered_subagents?: number;
  scoping_suspect?: boolean;
  unpriced_models?: string[];
  complete?: boolean;
  tokens?: {
    by_type?: { input?: number; output?: number; cache_read?: number; cache_creation?: number };
    total?: number;
  };
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Lê e normaliza o cost-report.json de uma Session. Retorna null quando o arquivo
 * está ausente, é JSON inválido, ou não tem total_cost_usd numérico — nesses casos
 * o coordenador cai na soma crua. NUNCA aplica pricing; só lê números já gravados.
 */
export function readCostReport(specDir: string): CostReport | null {
  const path = join(specDir, "cost-report.json");
  if (!existsSync(path)) return null;

  let raw: RawCostReport;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null; // arquivo corrompido: cai na soma crua, não inventa número
  }
  if (typeof raw.total_cost_usd !== "number") return null;

  const scopingSuspect = raw.scoping_suspect ?? false;

  // sem bloco tokens (ou sem by_type) ⇒ tokens null; o coordenador resolve com soma crua
  const tk = raw.tokens?.by_type;
  const tokens = tk
    ? {
        input: tk.input ?? 0,
        output: tk.output ?? 0,
        cacheRead: tk.cache_read ?? 0,
        cacheCreation: tk.cache_creation ?? 0,
      }
    : null;

  return {
    totalCostUsd: raw.total_cost_usd,
    byPhase: {
      planning: num(raw.planning_cost_usd),
      orchestration: num(raw.orchestration_cost_usd),
      // implementation não confiável quando scoping_suspect: vira null (UI mostra "—")
      implementation: scopingSuspect ? null : num(raw.implementation_cost_usd),
    },
    tokens,
    // total ausente dentro de um bloco tokens presente ⇒ null (desconhecido), não 0
    // (0 afirmaria "zero tokens"; o coordenador cai na soma crua quando null)
    totalTokens: tokens ? num(raw.tokens?.total) : null,
    partial: Array.isArray(raw.unpriced_models) && raw.unpriced_models.length > 0,
    scopingSuspect,
    excludedSubagents: num(raw.excluded_subagents),
    recoveredSubagents: num(raw.recovered_subagents),
    complete: typeof raw.complete === "boolean" ? raw.complete : null,
  };
}
