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
import { readObservedCostRollup } from "./cost-report.js";
import { buildMarkers } from "./observedTimeline.js";
import type { EditEvent, DiffFile, BlockEvent } from "./observedTimeline.js";

// Padrão de nome de diretório OBS-NNN (3 ou mais dígitos) — case-sensitive conforme o schema
const OBS_DIR_RE = /^OBS-\d{3,}$/;

// Status terminais — presença de closed_at só é drift quando o status NÃO está aqui
const TERMINAL = new Set<string>(["done", "abandoned"]);

// Enum canônico de status do session.yml (copiado aqui para não puxar imports do schema
// JSON em produção — contracts.ts é exclusivo do caminho de validação/teste)
const KNOWN_STATUSES = new Set<string>(["in_progress", "needs_attention", "done", "abandoned"]);

/** Retorna a string quando é não-vazia; null caso contrário. */
function nonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

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
    const parsed = parseYaml(readFileSync(file, "utf-8"));
    // YAML raiz não-objeto (null, escalar, array) em dir OBS-* → card degradado
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return OBS_DIR_RE.test(basename(specDir)) ? degradedSpec(specDir) : null;
    }
    raw = parsed as Record<string, any>;
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

  const decisions = normalizeDecisions(raw.decisions);
  const evidence = normalizeEvidence(raw.evidence);
  const markers = buildMarkers({
    createdAt: nonEmptyString(raw.created_at),
    closedAt: nonEmptyString(raw.closed_at),
    decisions: withAt(raw.decisions, decisions),
    evidence: withAt(raw.evidence, evidence),
    edits: readEdits(specDir),
    diffFiles: readDiffFiles(specDir),
    blocks: readBlocks(specDir),
    attentionKind: typeof raw.attention?.kind === "string" ? raw.attention.kind : null,
  });

  const observed: ObservedMeta = {
    intent: typeof raw.intent === "string" ? raw.intent : "",
    createdAt: nonEmptyString(raw.created_at),
    closedAt: nonEmptyString(raw.closed_at),
    attentionKind: typeof raw.attention?.kind === "string" ? raw.attention.kind : null,
    decisions,
    evidence,
    driftFlags: drift,
    baseSha: nonEmptyString(raw.base_sha),
    outputLocale: nonEmptyString(raw.output_locale),
    markers,
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
    cost: readObservedCostRollup(specDir),
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
  const hasClosed = nonEmptyString(raw.closed_at) !== null;
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
  const closed = nonEmptyString(raw.closed_at);
  if (closed !== null) return closed;

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
    baseSha: null,
    outputLocale: null,
    markers: [],
  };

  return {
    id: basename(specDir),
    squad: "sdd",
    title: "(session.yml ilegível)",
    phase: "",
    plannedPhases: [],
    status: "unreadable",
    tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: lastActivity(specDir, {}),
    timeline: [],
    cost: readObservedCostRollup(specDir),
    deliveryReport: null,
    specPath: null,
    observed,
  };
}

/** Lê edits.jsonl com tolerância: arquivo ausente → []; linha corrompida → ignorada. */
function readEdits(specDir: string): EditEvent[] {
  const file = join(specDir, "edits.jsonl");
  if (!existsSync(file)) return [];
  const out: EditEvent[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (typeof o?.at === "string" && typeof o?.file === "string") {
        out.push({ at: o.at, file: o.file });
      }
    } catch { /* linha corrompida: ignora */ }
  }
  return out;
}

/** Lê diff.json com tolerância: arquivo ausente/corrompido → []; campo files não-array → []. */
function readDiffFiles(specDir: string): DiffFile[] {
  const file = join(specDir, "diff.json");
  if (!existsSync(file)) return [];
  try {
    const o = JSON.parse(readFileSync(file, "utf-8"));
    if (!Array.isArray(o?.files)) return [];
    return o.files
      .filter((f: any) => f && typeof f.path === "string")
      .map((f: any) => ({
        path: f.path,
        added: typeof f.added === "number" ? f.added : null,
        removed: typeof f.removed === "number" ? f.removed : null,
        patch: typeof f.patch === "string" ? f.patch : null,
      }));
  } catch { return []; }
}

/** Lê blocks.jsonl com tolerância: arquivo ausente → []; linha corrompida → ignorada. */
function readBlocks(specDir: string): BlockEvent[] {
  const file = join(specDir, "blocks.jsonl");
  if (!existsSync(file)) return [];
  const out: BlockEvent[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (typeof o?.at === "string" && typeof o?.event === "string") {
        out.push({ at: o.at, event: o.event, kind: typeof o.kind === "string" ? o.kind : null });
      }
    } catch { /* linha corrompida: ignora */ }
  }
  return out;
}

/**
 * Recupera o campo `at` cru de cada item antes de normalizar (normalize descarta `at`).
 * Junta o `at` ao objeto normalizado pelo índice de posição.
 */
function withAt<T>(rawArr: unknown, normalized: T[]): (T & { at: string | null })[] {
  const arr = Array.isArray(rawArr) ? rawArr : [];
  return normalized.map((n, i) => {
    const item = arr[i];
    const at =
      item && typeof item === "object" && typeof (item as any).at === "string"
        ? (item as any).at
        : null;
    return { ...n, at };
  });
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
