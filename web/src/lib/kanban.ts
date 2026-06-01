import type { Spec } from "../../../src/store/types";

/**
 * Lógica pura do kanban: a que coluna uma spec pertence e, quando exige atenção,
 * qual o motivo. Tudo derivado de campos que JÁ existem na Spec (status, health,
 * tasks) — nada recalculado nem inventado. Separado dos componentes pra ser
 * testável isolado.
 */
export type ColumnKey = "attention" | "running" | "done";

export const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: "attention", label: "Precisa de você" },
  { key: "running", label: "Em andamento" },
  { key: "done", label: "Pronto" },
];

/**
 * Mapeia o status derivado + flag de auditoria pra coluna. Ordem importa:
 * blocked/escalated/paused e auditException → attention (exigem olho humano)
 * ANTES de done, pra um item em auditoria não se esconder em "Pronto".
 */
export function columnForSpec(spec: Spec): ColumnKey {
  const s = spec.status;
  if (s === "blocked" || s === "escalated" || s === "paused") return "attention";
  if (spec.health.auditException) return "attention";
  if (s === "done") return "done";
  return "running";
}

export interface AttentionReason {
  kind: "blocked" | "escalated" | "paused" | "audit";
  label: string;
}

/** Motivo de a spec estar em "Precisa de você"; null se não estiver. */
export function attentionReason(spec: Spec): AttentionReason | null {
  if (spec.status === "blocked") {
    const blocked = spec.tasks.find((t) => t.state === "blocked");
    return { kind: "blocked", label: blocked ? `${blocked.id} bloqueada` : "bloqueado" };
  }
  if (spec.status === "escalated") return { kind: "escalated", label: "decisão humana" };
  if (spec.status === "paused") return { kind: "paused", label: "pausado" };
  if (spec.health.auditException) return { kind: "audit", label: "exceção de auditoria" };
  return null;
}
