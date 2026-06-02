import type { Spec, Project } from "../../../src/store/types";

/**
 * Lógica pura do kanban: a que coluna uma spec pertence e, quando exige atenção,
 * qual o motivo. Tudo derivado de campos que JÁ existem na Spec (status, health,
 * tasks) — nada recalculado nem inventado. Separado dos componentes pra ser
 * testável isolado.
 */
export type ColumnKey = "attention" | "planning" | "planned" | "running" | "done";

export const COLUMN_DEFS: { key: ColumnKey; label: string }[] = [
  { key: "attention", label: "Precisa de você" },
  { key: "planning", label: "Em planejamento" },
  { key: "planned", label: "Planejado" },
  { key: "running", label: "Em andamento" },
  { key: "done", label: "Pronto" },
];

/**
 * Mapeia a spec pra coluna numa cascata (primeira condição que casa vence).
 * Ordem importa: atenção (exige humano) ganha de tudo; discovery não tem
 * conceito de "planejado" (é investigação); planned vs running se decide pelo
 * estado das tasks, não pela fase. Tudo derivado de campos que JÁ existem.
 */
export function columnForSpec(spec: Spec): ColumnKey {
  const s = spec.status;
  if (s === "blocked" || s === "escalated" || s === "paused") return "attention";
  if (spec.health.auditException) return "attention";
  if (s === "done") return "done";
  if (spec.squad === "discovery") return "running";
  const hasTasks = spec.tasks.length > 0;
  if (hasTasks && spec.tasks.some((t) => t.state === "running" || t.state === "done")) return "running";
  if (hasTasks) return "planned";
  return "planning";
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

/** Uma spec carregada com os metadados do projeto que o drawer/tabela precisam. */
export interface SpecWithProject {
  spec: Spec;
  projectId: string;
  projectName: string;
  projectPath: string;
}

/**
 * Achata Project[] → SpecWithProject[] (o kanban cruza projetos; o agrupamento por
 * projeto vira só a tag/cor). Esconde specs de projetos hidden a menos que
 * showHidden. Preserva a ordem (projeto, depois spec).
 */
export function flattenSpecs(projects: Project[], showHidden: boolean): SpecWithProject[] {
  const out: SpecWithProject[] = [];
  for (const p of projects) {
    if (p.hidden && !showHidden) continue;
    for (const spec of p.specs) {
      out.push({ spec, projectId: p.id, projectName: p.name, projectPath: p.path });
    }
  }
  return out;
}

/** Agrupa por coluna, preservando a ordem de entrada dentro de cada balde. */
export function bucketByColumn(items: SpecWithProject[]): Record<ColumnKey, SpecWithProject[]> {
  const buckets: Record<ColumnKey, SpecWithProject[]> = {
    attention: [], planning: [], planned: [], running: [], done: [],
  };
  for (const item of items) buckets[columnForSpec(item.spec)].push(item);
  return buckets;
}

/** Busca simples: casa o termo (case-insensitive) em id, título ou nome do projeto. */
export function matchesQuery(item: SpecWithProject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = `${item.spec.id} ${item.spec.title} ${item.projectName}`.toLowerCase();
  return hay.includes(q);
}
