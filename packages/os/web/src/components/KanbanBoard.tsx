import type { SpecWithProject } from "../lib/kanbanObserved";
import { COLUMN_DEFS, bucketByColumn } from "../lib/kanbanObserved";
import { KanbanColumn } from "./KanbanColumn";

/**
 * O kanban: agrupa os itens (já filtrados pelo Board) por coluna e renderiza as 3
 * colunas na ordem de COLUMN_DEFS. Não conhece filtro/busca — recebe a lista
 * pronta. onSelect sobe pro Board abrir o drawer.
 */
export function KanbanBoard({
  items,
  onSelect,
}: {
  items: SpecWithProject[];
  onSelect: (item: SpecWithProject) => void;
}) {
  const buckets = bucketByColumn(items);
  return (
    <div className="kboard">
      {COLUMN_DEFS.map((c) => (
        <KanbanColumn
          key={c.key}
          columnKey={c.key}
          label={c.label}
          items={buckets[c.key]}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
