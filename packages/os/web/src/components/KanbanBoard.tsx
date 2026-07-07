import type { FeatureWithProject } from "../lib/kanbanFeatures";
import { bucketFeaturesByColumn } from "../lib/kanbanFeatures";
import type { SpecWithProject } from "../lib/kanban";
import { COLUMN_DEFS } from "../lib/kanbanObserved";
import { FeatureCard } from "./FeatureCard";

/**
 * O kanban: agrupa os itens (já filtrados pelo Board) por coluna e renderiza as 3
 * colunas na ordem de COLUMN_DEFS. Não conhece filtro/busca — recebe a lista
 * pronta. onSelectSession sobe pro Board abrir o drawer.
 */
export function KanbanBoard({
  items,
  onSelectSession,
}: {
  items: FeatureWithProject[];
  onSelectSession: (s: SpecWithProject) => void;
}) {
  const buckets = bucketFeaturesByColumn(items);
  return (
    <div className="kboard">
      {COLUMN_DEFS.map((c) => (
        <section className="kcol" data-col={c.key} key={c.key}>
          <header className="kcol-head">
            <span className="kcol-dot" />
            <span className="kcol-label">{c.label}</span>
            <span className="kcol-count">{buckets[c.key].length}</span>
          </header>
          {buckets[c.key].length === 0 ? (
            <p className="kcol-empty">nada aqui</p>
          ) : (
            buckets[c.key].map((it) => (
              <FeatureCard key={`${it.projectId}/${it.feature.id}`} item={it} onSelectSession={onSelectSession} />
            ))
          )}
        </section>
      ))}
    </div>
  );
}
