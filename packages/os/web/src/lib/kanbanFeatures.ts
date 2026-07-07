import type { Feature, Project } from "../../../src/store/types";
import type { ColumnKey } from "./kanbanObserved";
import type { SpecWithProject } from "./kanban";
import { matchesQuery } from "./kanban";

// Uma feature com o contexto de projeto e as sessões-membro já resolvidas (join
// sessionIds → Spec feito aqui, uma vez, pra UI não repetir).
export interface FeatureWithProject {
  feature: Feature;
  projectId: string;
  projectName: string;
  sessions: SpecWithProject[];
}

/** Coluna de uma feature: mesma semântica do board (atenção vence; idle segue em andamento). */
export function featureColumn(f: Feature): ColumnKey {
  if (f.status === "needs_attention") return "attention";
  if (f.status === "done") return "done";
  return "running"; // running e idle
}

/** Junta Project.features com as Specs-membro; projetos hidden respeitam showHidden. */
export function flattenFeatures(projects: readonly Project[], showHidden: boolean): FeatureWithProject[] {
  const out: FeatureWithProject[] = [];
  for (const p of projects) {
    if (p.hidden && !showHidden) continue;
    const byId = new Map(p.specs.map((s) => [s.id, s]));
    for (const f of p.features ?? []) {
      const sessions: SpecWithProject[] = f.sessionIds
        .map((id) => byId.get(id))
        .filter((s): s is NonNullable<typeof s> => s !== undefined)
        .map((spec) => ({ spec, projectId: p.id, projectName: p.name, projectPath: p.path }));
      out.push({ feature: f, projectId: p.id, projectName: p.name, sessions });
    }
  }
  return out;
}

/** Uma feature casa a busca se o nome/key casarem, ou se QUALQUER sessão-membro casar. */
export function featureMatchesQuery(item: FeatureWithProject, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (item.feature.name.toLowerCase().includes(q)) return true;
  if (item.feature.key?.toLowerCase().includes(q)) return true;
  return item.sessions.some((s) => matchesQuery(s, query));
}

/** Agrupa em 3 baldes preservando a ordem de entrada. */
export function bucketFeaturesByColumn(items: FeatureWithProject[]): Record<ColumnKey, FeatureWithProject[]> {
  const buckets: Record<ColumnKey, FeatureWithProject[]> = { attention: [], running: [], done: [] };
  for (const it of items) buckets[featureColumn(it.feature)].push(it);
  return buckets;
}
