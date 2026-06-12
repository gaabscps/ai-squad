import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CostRollup } from "../store/types.js";
import { readCostRollup } from "./cost.js";

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
  generated_at?: string;
  tokens?: {
    by_type?: { input?: number; output?: number; cache_read?: number; cache_creation?: number };
    total?: number;
  };
}

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Normaliza o bloco tokens de um RawCostReport para o shape usado em CostRollup.
 * Retorna zeros quando o bloco está ausente (seguro para o caminho observado,
 * que expõe tokens como métrica primária mesmo sem custo).
 */
function normalizeTokens(
  raw: RawCostReport,
): { tokens: { input: number; output: number; cacheRead: number; cacheCreation: number }; totalTokens: number } {
  const tk = raw.tokens?.by_type;
  if (!tk) {
    return {
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      totalTokens: 0,
    };
  }
  const tokens = {
    input: tk.input ?? 0,
    output: tk.output ?? 0,
    cacheRead: tk.cache_read ?? 0,
    cacheCreation: tk.cache_creation ?? 0,
  };
  const totalTokens =
    typeof raw.tokens?.total === "number"
      ? raw.tokens.total
      : tokens.input + tokens.output + tokens.cacheRead + tokens.cacheCreation;
  return { tokens, totalTokens };
}

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

/**
 * Lê o cost-report.json de forma tolerante: aceita todo campo como opcional,
 * nunca lança exceção. Retorna null apenas quando o arquivo está ausente ou
 * é JSON totalmente inválido (unparseable). Campos ausentes recebem defaults seguros.
 */
function readCostReportTolerant(
  specDir: string,
): (RawCostReport & { generatedAt: string | null; unpricedModels: string[] }) | null {
  const path = join(specDir, "cost-report.json");
  if (!existsSync(path)) return null;

  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    // JSON válido mas não-objeto (null, array, escalar) → trata como sem campos
    raw = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return null; // arquivo unparseable → não dá para confiar em nada; fallback à soma crua
  }

  return {
    total_cost_usd: typeof raw.total_cost_usd === "number" ? raw.total_cost_usd : undefined,
    complete: typeof raw.complete === "boolean" ? raw.complete : undefined,
    unpriced_models: Array.isArray(raw.unpriced_models) ? (raw.unpriced_models as string[]) : undefined,
    tokens:
      raw.tokens !== null && typeof raw.tokens === "object" && !Array.isArray(raw.tokens)
        ? (raw.tokens as RawCostReport["tokens"])
        : undefined,
    generated_at: typeof raw.generated_at === "string" ? raw.generated_at : undefined,
    // Aliases normalizados para uso interno
    generatedAt: typeof raw.generated_at === "string" ? raw.generated_at : null,
    unpricedModels: Array.isArray(raw.unpriced_models) ? (raw.unpriced_models as string[]) : [],
  };
}

/**
 * Verifica se o cost-report.json está desatualizado em relação a costs/*.json.
 * generated_at null → não dá para julgar → retorna false (confia no report).
 * costs/ inexistente ou vazia → false (nada mais recente).
 * Tolerância de 2000ms para evitar falsos positivos de escrita concorrente.
 */
function isStale(specDir: string, generatedAt: string | null): boolean {
  if (generatedAt === null) return false;

  const reportTime = new Date(generatedAt).getTime();
  if (isNaN(reportTime)) return false; // timestamp inválido → não dá para comparar

  const costsDir = join(specDir, "costs");
  try {
    const files = readdirSync(costsDir).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      try {
        const mtime = statSync(join(costsDir, f)).mtime.getTime();
        if (mtime > reportTime + 2000) return true; // costs/*.json mais novo → stale
      } catch {
        // arquivo sumiu durante a leitura; ignora
      }
    }
  } catch {
    // costs/ não existe ou inacessível → nada mais novo
  }

  return false;
}

/**
 * Custo de um dir observado a partir do cost-report.json contratado.
 * Regras: USD null (nunca 0) sem complete===true ou com unpriced_models;
 * report mais velho que costs/*.json ⇒ fallback à soma crua; todo campo opcional.
 */
export function readObservedCostRollup(specDir: string): CostRollup {
  const report = readCostReportTolerant(specDir); // não exige campos: deploy-lag é a norma
  if (!report || isStale(specDir, report.generatedAt)) return readCostRollup(specDir);

  const trustUsd = report.complete === true && report.unpricedModels.length === 0;
  const { tokens, totalTokens } = normalizeTokens(report);

  return {
    totalCostUsd: trustUsd ? (report.total_cost_usd ?? null) : null,
    partial: !trustUsd,
    tokens,
    totalTokens,
    reportPath: existsSync(join(specDir, "report.html")) ? join(specDir, "report.html") : null,
    source: "cost_report",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null, // breakdown por fase SDD seria falso: o gasto observado cai todo em planning
    complete: report.complete ?? null,
  };
}
