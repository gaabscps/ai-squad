/**
 * Leitor de sessões no modo observado (mode: observed).
 *
 * Função principal: readSessionDir — despacha pelo campo `mode` do session.yml:
 *   - mode: observed → constrói um Spec observado com ciclo de vida tolerante
 *   - ausente / outro valor → null (sessão SDD legada, filtrada do board)
 *   - YAML ilegível em dir OBS-* → card degradado (nunca some do board)
 *
 * Tolerâncias de ciclo de vida (nunca card mentiroso):
 *   - closed_at presente com status não-terminal → status vira done + driftFlag
 *   - status fora do enum canônico → status inferido + driftFlag unknown_status
 *   - YAML ilegível → status unreadable + driftFlag unreadable_yaml
 *
 * parseSession (session.ts) permanece intocado e dormente — strangler em curso.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  Spec,
  SpecStatus,
  ObservedMeta,
  ObservedDriftFlag,
  ObservedDecision,
  ObservedEvidence,
} from "../store/types.js";
import { readDeliveryReport } from "./delivery-report.js";
import { readCostRollup } from "./cost.js"; // Task 3 substituirá pela fonte cost-report.json

// Padrão de nome de diretório OBS-NNN (3 ou mais dígitos)
const OBS_DIR_RE = /^OBS-\d{3,}$/i;

// Status terminais — presença de closed_at só é drift quando o status NÃO está aqui
const TERMINAL = new Set<string>(["done", "abandoned"]);

// Enum canônico de status do session.yml (lido do schema via contracts.ts, copiado aqui
// para não criar acoplamento circular; contracts.ts não é importado em produção)
const KNOWN_STATUSES = new Set<string>(["in_progress", "needs_attention", "done", "abandoned"]);

// Mapeamento do enum do session.yml para o SpecStatus do store
const STATUS_MAP: Record<string, SpecStatus> = {
  in_progress: "running",
  needs_attention: "needs_attention",
  done: "done",
  abandoned: "abandoned",
};

/**
 * Lê <dir>/session.yml e decide o destino do diretório no board:
 *   - mode: observed → Spec observado
 *   - modo ausente / SDD → null (filtrado; legado fora do board)
 *   - OBS-* com YAML ilegível → card degradado (nunca some do board)
 *   - non-OBS com YAML ilegível → null (comportamento legado)
 */
export function readSessionDir(specDir: string, _projectRoot?: string): Spec | null {
  const file = join(specDir, "session.yml");
  if (!existsSync(file)) return null;

  let raw: Record<string, any>;
  try {
    raw = (parseYaml(readFileSync(file, "utf-8")) as Record<string, any>) ?? {};
  } catch {
    // YAML ilegível: card degradado somente para dirs OBS-*, null para o resto
    return OBS_DIR_RE.test(basename(specDir)) ? degradedSpec(specDir) : null;
  }

  if (raw.mode !== "observed") return null;

  return observedSpec(specDir, raw);
}

/**
 * Constrói um Spec completo a partir de um session.yml de modo observado válido.
 */
function observedSpec(specDir: string, raw: Record<string, any>): Spec {
  const { status, drift } = deriveObservedStatus(raw);

  const observed: ObservedMeta = {
    intent: typeof raw.intent === "string" ? raw.intent : "",
    createdAt: typeof raw.created_at === "string" ? raw.created_at : null,
    closedAt: typeof raw.closed_at === "string" ? raw.closed_at : null,
    attentionKind: raw.attention?.kind != null ? String(raw.attention.kind) : null,
    decisions: normalizeDecisions(raw.decisions),
    evidence: normalizeEvidence(raw.evidence),
    driftFlags: drift,
  };

  return {
    id: typeof raw.session_id === "string" ? raw.session_id : basename(specDir),
    // squad: campo dormante para sessões observadas — a UI roteia pelo campo `observed`,
    // não pelo squad. Mantido neutro ("sdd") para compatibilidade com a estrutura Spec.
    squad: "sdd",
    title: typeof raw.intent === "string" && raw.intent !== "" ? raw.intent : "(sem intent)",
    phase: "",
    plannedPhases: [],
    status,
    tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: lastActivity(specDir, raw),
    timeline: [],
    cost: readCostRollup(specDir),
    deliveryReport: readDeliveryReport(specDir),
    specPath: null,
    observed,
  };
}

/**
 * Deriva o status canônico do enum + registra flags de inconsistência de ciclo de vida.
 * Nunca produz um card mentiroso: closed_at presente vence status não-terminal.
 */
function deriveObservedStatus(raw: Record<string, any>): {
  status: SpecStatus;
  drift: ObservedDriftFlag[];
} {
  const drift: ObservedDriftFlag[] = [];
  const hasClosed = typeof raw.closed_at === "string" && raw.closed_at !== "";
  const rawStatus = typeof raw.status === "string" ? raw.status : "";

  let resolved = rawStatus;

  if (!KNOWN_STATUSES.has(rawStatus)) {
    // Status fora do enum: inferir pelo estado do arquivo
    drift.push("unknown_status");
    resolved = hasClosed ? "done" : "in_progress";
  } else if (hasClosed && !TERMINAL.has(rawStatus)) {
    // closed_at presente mas status não é terminal — closed_at vence
    drift.push("closed_with_open_status");
    resolved = "done";
  }

  return { status: STATUS_MAP[resolved] ?? "running", drift };
}

/** Retorna o mais recente entre dois Date, ou o não-nulo quando um é null. */
function pickLatest(a: Date | null, b: Date): Date {
  return a === null || b.getTime() > a.getTime() ? b : a;
}

/**
 * Determina a data de última atividade da sessão.
 * Quando a sessão está fechada usa closed_at (preciso e canônico).
 * Quando aberta usa o mtime mais recente entre session.yml e costs/*.json.
 */
function lastActivity(specDir: string, raw: Record<string, any>): string | null {
  if (typeof raw.closed_at === "string" && raw.closed_at !== "") return raw.closed_at;

  let latest: Date | null = null;

  // mtime do session.yml
  try {
    const mt = statSync(join(specDir, "session.yml")).mtime;
    latest = pickLatest(latest, mt);
  } catch {
    // arquivo pode ter sumido; ignora
  }

  // mtime dos costs/*.json (quando existem)
  try {
    const costsDir = join(specDir, "costs");
    if (existsSync(costsDir)) {
      for (const f of readdirSync(costsDir)) {
        if (!f.endsWith(".json")) continue;
        try {
          const mt = statSync(join(costsDir, f)).mtime;
          latest = pickLatest(latest, mt);
        } catch {
          // arquivo pode sumir durante a leitura; ignora
        }
      }
    }
  } catch {
    // costs/ pode não existir ou ser inacessível; ignora
  }

  return latest ? latest.toISOString() : null;
}

/**
 * Constrói um card degradado para dirs OBS-* com YAML ilegível.
 * O card aparece no board (coluna atenção) com motivo "session.yml ilegível".
 */
function degradedSpec(specDir: string): Spec {
  const observed: ObservedMeta = {
    intent: "",
    createdAt: null,
    closedAt: null,
    attentionKind: null,
    decisions: [],
    evidence: [],
    driftFlags: ["unreadable_yaml"],
  };

  let lastActivityAt: string | null = null;
  try {
    lastActivityAt = statSync(join(specDir, "session.yml")).mtime.toISOString();
  } catch {
    // sem acesso ao mtime; permanece null
  }

  return {
    id: basename(specDir),
    squad: "sdd",
    title: "(session.yml ilegível)",
    phase: "",
    plannedPhases: [],
    status: "unreadable",
    tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt,
    timeline: [],
    cost: readCostRollup(specDir),
    deliveryReport: null,
    specPath: null,
    observed,
  };
}

/**
 * Normaliza o array decisions do YAML: cada item de objeto vira ObservedDecision
 * com campos ausentes ou não-string convertidos para null. Itens não-objeto são descartados.
 */
function normalizeDecisions(raw: unknown): ObservedDecision[] {
  if (!Array.isArray(raw)) return [];
  const result: ObservedDecision[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    result.push({
      what: typeof d.what === "string" ? d.what : "",
      why: typeof d.why === "string" ? d.why : null,
      rejected: typeof d.rejected === "string" ? d.rejected : null,
      ref: typeof d.ref === "string" ? d.ref : null,
    });
  }
  return result;
}

/**
 * Normaliza o array evidence do YAML: cada item de objeto vira ObservedEvidence
 * com campos ausentes ou não-string convertidos para null. Itens não-objeto são descartados.
 */
function normalizeEvidence(raw: unknown): ObservedEvidence[] {
  if (!Array.isArray(raw)) return [];
  const result: ObservedEvidence[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const e = item as Record<string, unknown>;
    result.push({
      cmd: typeof e.cmd === "string" ? e.cmd : null,
      result: typeof e.result === "string" ? e.result : null,
      kind: typeof e.kind === "string" ? e.kind : null,
    });
  }
  return result;
}
