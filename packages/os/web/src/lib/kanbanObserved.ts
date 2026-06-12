import type { Spec } from "../../../src/store/types";
import type { SpecWithProject } from "./kanban";
// Rexporta helpers agnósticos de modo: componentes que precisam só de flattenSpecs
// ou matchesQuery não precisam saber de qual módulo vieram.
export { flattenSpecs, matchesQuery } from "./kanban";
export type { SpecWithProject } from "./kanban";

// ─── Colunas ──────────────────────────────────────────────────────────────────

export type ColumnKey = "attention" | "running" | "done";

/** Definições das 3 colunas do board observado, na ordem de exibição. */
export const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: "attention", label: "Precisa de você" },
  { key: "running",   label: "Em andamento"    },
  { key: "done",      label: "Pronto"           },
];

// ─── Mapeamento spec → coluna ──────────────────────────────────────────────────

/**
 * Coluna de um card observado. Regra de prioridade (primeira condição vence):
 * 1. Qualquer status que exige atenção humana → attention.
 * 2. Terminais (done + abandoned) → done.
 * 3. Qualquer outro → running.
 */
export function columnForSpec(spec: Spec): ColumnKey {
  const s = spec.status;
  if (
    s === "needs_attention" ||
    s === "unreadable"      ||
    s === "blocked"         ||
    s === "escalated"       ||
    s === "paused"
  ) return "attention";
  if (s === "done" || s === "abandoned") return "done";
  return "running";
}

// ─── Motivo de atenção ─────────────────────────────────────────────────────────

/** Shape idêntico ao AttentionReason do legado; consumers (DetailDrawer, KanbanCard) compilam sem mudança. */
export interface AttentionReason {
  kind: string;
  label: string;
}

/**
 * Motivo de a spec estar em "Precisa de você"; null se não estiver.
 * Kinds novos: input → aguarda resposta do usuário; unreadable → session.yml ilegível.
 */
export function attentionReason(spec: Spec): AttentionReason | null {
  if (spec.status === "needs_attention") return { kind: "input",      label: "aguardando sua resposta" };
  if (spec.status === "unreadable")      return { kind: "unreadable", label: "session.yml ilegível"    };
  // Mantém compatibilidade com statuses SDD que também caem em attention
  if (spec.status === "blocked") {
    const blocked = spec.tasks.find((t) => t.state === "blocked");
    return { kind: "blocked", label: blocked ? `${blocked.id} bloqueada` : "bloqueado" };
  }
  if (spec.status === "escalated") return { kind: "escalated", label: "decisão humana" };
  if (spec.status === "paused")    return { kind: "paused",    label: "pausado"        };
  return null;
}

// ─── Arquivamento ──────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sessão arquivada = done OU abandoned, com data conhecida, parada há mais que o limite.
 * `now` entra por parâmetro (testável sem mexer no relógio).
 * Sem lastActivityAt → conservador, NÃO arquiva.
 * Limite é exclusivo: idade == limite ainda aparece.
 */
export function isArchived(spec: Spec, now: number, archiveAfterDays: number): boolean {
  if (spec.status !== "done" && spec.status !== "abandoned") return false;
  if (spec.lastActivityAt == null) return false;
  const ageDays = (now - Date.parse(spec.lastActivityAt)) / DAY_MS;
  return ageDays > archiveAfterDays;
}

// ─── Agrupamento por coluna ───────────────────────────────────────────────────

/**
 * Agrupa os itens em 3 baldes (attention / running / done),
 * preservando a ordem de entrada dentro de cada balde.
 */
export function bucketByColumn(items: SpecWithProject[]): Record<ColumnKey, SpecWithProject[]> {
  const buckets: Record<ColumnKey, SpecWithProject[]> = {
    attention: [],
    running:   [],
    done:      [],
  };
  for (const item of items) buckets[columnForSpec(item.spec)].push(item);
  return buckets;
}
