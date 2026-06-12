/**
 * Leitura do dispatch-manifest.json e resolução de cada output_packet_ref.
 *
 * Responsabilidades:
 *   - Ler e parsear dispatch-manifest.json de um specDir.
 *   - Resolver cada output_packet_ref relativo a specDir COM verificação de
 *     contenção de path (path traversal → tratado como ausente).
 *   - Filtrar task_id pelo pattern canônico de output-packet.schema.json
 *     (^T-\d{3,}$; ignora AUDIT, FEAT-XXX, T-001abc, etc.).
 *   - Resiliência total: manifest ausente/corrompido → mapa vazio;
 *     packet ausente/corrompido/parcial → Dispatch manifest-only.
 *
 * NUNCA importa APIs de escrita de fs (NFR-001).
 * Espelha o padrão de cost.ts / session.ts: try/catch que ignora arquivo ruim,
 * retorna vazio em vez de lançar (NFR-002).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Dispatch } from "../store/types.js";
import {
  normalizeFilesChanged,
  normalizeFindings,
  deriveTestEvidence,
} from "./dispatch-normalize.js";
// TASK_ID_RE: pattern canônico de task_id (^T-\d{3,}$) derivado de
// output-packet.schema.json; exclui AUDIT, FEAT-XXX, T-001abc, T-1, etc.
import { TASK_ID_RE } from "./contracts.js";

/** Formato bruto de um item em actual_dispatches[] */
interface RawDispatchItem {
  dispatch_id?: string;
  task_id?: string;
  role?: string;
  loop?: number;
  status?: string;
  output_packet_ref?: string;
  usage?: { total_tokens?: number } | null;
}

/** Formato bruto do dispatch-manifest.json */
interface RawManifest {
  actual_dispatches: RawDispatchItem[];
}

/** Formato bruto de um output packet (campos de interesse para dispatches) */
export interface RawPacket {
  role?: string;
  status?: string;
  summary?: string | null;
  evidence?: unknown;
  files_changed?: unknown;
  findings?: unknown;
  usage?: unknown;
  [key: string]: unknown;
}

/**
 * Lê e parseia o dispatch-manifest.json de um specDir.
 * Retorna null se o arquivo não existir ou tiver JSON inválido.
 */
export function readManifest(specDir: string): RawManifest | null {
  const file = join(specDir, "dispatch-manifest.json");
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    if (!Array.isArray(raw.actual_dispatches)) return null;
    return raw as unknown as RawManifest;
  } catch {
    return null;
  }
}

/**
 * Resolve output_packet_ref relativo a specDir e lê o conteúdo do packet.
 *
 * Verifica contenção: o caminho resolvido deve começar com specDir normalizado.
 * Fora disso → retorna null (path traversal tratado como ausente).
 * Arquivo ausente ou JSON inválido → retorna null.
 */
export function resolvePacketSafe(specDir: string, ref: string): RawPacket | null {
  if (!ref) return null;

  const normalizedSpecDir = resolve(specDir);
  const fullPath = resolve(join(specDir, ref));

  // Contenção: caminho resolvido deve estar dentro de specDir
  if (!fullPath.startsWith(normalizedSpecDir + "/") && fullPath !== normalizedSpecDir) {
    return null;
  }

  if (!existsSync(fullPath)) return null;

  try {
    return JSON.parse(readFileSync(fullPath, "utf-8")) as RawPacket;
  } catch {
    return null;
  }
}

/**
 * Lê o dispatch-manifest.json de specDir e retorna um Map<task_id, Dispatch[]>
 * apenas com os itens cujo task_id casa com o pattern canônico (TASK_ID_RE).
 *
 * Retorna mapa vazio quando manifest ausente/corrompido.
 * Campos ricos (filesChanged, findings, testEvidence) são normalizados via dispatch-normalize.ts.
 */
export function loadDispatchMap(specDir: string): Map<string, Dispatch[]> {
  const manifest = readManifest(specDir);
  if (!manifest) return new Map();

  const result = new Map<string, Dispatch[]>();

  for (const item of manifest.actual_dispatches) {
    const taskId = item.task_id ?? "";
    if (!TASK_ID_RE.test(taskId)) continue;

    const ref = item.output_packet_ref ?? "";
    const packet = ref ? resolvePacketSafe(specDir, ref) : null;

    const dispatch = buildDispatch(item, packet);

    if (!result.has(taskId)) {
      result.set(taskId, []);
    }
    result.get(taskId)!.push(dispatch);
  }

  return result;
}

/**
 * Monta um Dispatch a partir de um item do manifest e do packet bruto (pode ser null).
 * Quando packet é null, produz um Dispatch manifest-only com campos ricos vazios.
 * Tokens vêm exclusivamente de manifest.usage.total_tokens (AC-007/AC-008).
 */
function buildDispatch(item: RawDispatchItem, packet: RawPacket | null): Dispatch {
  const totalTokens = item.usage?.total_tokens;
  return {
    role: item.role ?? "",
    loop: item.loop ?? 0,
    status: item.status ?? "",
    summary: packet && typeof packet.summary === "string" ? packet.summary : null,
    filesChanged: packet ? normalizeFilesChanged(packet as Record<string, unknown>) : [],
    findings: packet ? normalizeFindings(packet as Record<string, unknown>) : [],
    testEvidence: packet ? deriveTestEvidence(packet as Record<string, unknown>) : [],
    tokens: typeof totalTokens === "number" ? totalTokens : null,
  };
}

/**
 * Lê manifest + packets e retorna Map<task_id, Dispatch[]>
 * com dispatches de cada tarefa ordenados por loop ascendente (AC-010).
 */
export function collectDispatches(specDir: string): Map<string, Dispatch[]> {
  const result = loadDispatchMap(specDir);
  for (const [, dispatches] of result) {
    dispatches.sort((a, b) => a.loop - b.loop);
  }
  return result;
}
