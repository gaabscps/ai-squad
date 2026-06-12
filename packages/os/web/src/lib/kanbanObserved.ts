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

// kind usa string (não union literal fechada) para permitir passthrough de attentionKind
// desconhecidos sem quebrar o TypeScript — kinds conhecidos são os 5 listados, mas
// versões futuras do coletor podem emitir novos valores que o card exibe genericamente.
export interface AttentionReason {
  kind: string; // known: "input" | "unreadable" | "blocked" | "escalated" | "paused"
  label: string;
}

// Rótulos para os kinds de atenção conhecidos; kinds desconhecidos caem no
// genérico "aguardando você" para compatibilidade futura sem quebrar a UI.
const ATTENTION_KIND_LABEL: Record<string, string> = {
  input: "aguardando sua resposta",
};

/**
 * Motivo de a spec estar em "Precisa de você"; null se não estiver.
 * Kinds novos: input → aguarda resposta do usuário; unreadable → session.yml ilegível.
 * Para needs_attention, lê spec.observed.attentionKind (fallback "input") e
 * mapeia para o label correspondente; kinds desconhecidos → "aguardando você".
 */
export function attentionReason(spec: Spec): AttentionReason | null {
  if (spec.status === "needs_attention") {
    const rawKind = spec.observed?.attentionKind ?? "input";
    const label = ATTENTION_KIND_LABEL[rawKind] ?? "aguardando você";
    return { kind: rawKind, label };
  }
  if (spec.status === "unreadable")      return { kind: "unreadable", label: "session.yml ilegível"    };
  // Mantém compatibilidade de STATUS com statuses SDD que também caem em attention (health.auditException não é consultado aqui)
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

// ─── Dormência ────────────────────────────────────────────────────────────────

export const DORMANT_AFTER_DAYS = 3;

/**
 * Sessão dormente = não-terminal, parada há mais que o limite. Sai das colunas
 * ativas por gravidade (ninguém fecha sessão por disciplina); volta sozinha se
 * houver atividade nova. Terminais não dormem — isArchived cuida deles.
 * Sem lastActivityAt → conservador, NÃO dorme. Limite exclusivo, como isArchived.
 */
export function isDormant(spec: Spec, now: number, dormantAfterDays: number = DORMANT_AFTER_DAYS): boolean {
  if (spec.status === "done" || spec.status === "abandoned") return false;
  if (spec.lastActivityAt == null) return false;
  const ageDays = (now - Date.parse(spec.lastActivityAt)) / DAY_MS;
  return ageDays > dormantAfterDays;
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
