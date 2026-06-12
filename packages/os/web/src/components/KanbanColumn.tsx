import type { ColumnKey, SpecWithProject } from "../lib/kanban";
import { KanbanCard } from "./KanbanCard";

/**
 * Uma coluna do kanban: cabeçalho com ponto de cor (data-col no CSS), rótulo e
 * contagem; depois os cards. Vazia mostra um placeholder discreto pra deixar
 * claro que está vazia de propósito (não quebrada).
 */
export function KanbanColumn({
  columnKey,
  label,
  items,
  onSelect,
}: {
  columnKey: ColumnKey;
  label: string;
  items: SpecWithProject[];
  onSelect: (item: SpecWithProject) => void;
}) {
  return (
    <section className="kcol" data-col={columnKey}>
      <header className="kcol-head">
        <span className="kcol-dot" />
        <span className="kcol-label">{label}</span>
        <span className="kcol-count">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="kcol-empty">nada aqui</p>
      ) : (
        items.map((it) => (
          <KanbanCard key={`${it.projectId}/${it.spec.id}`} item={it} onSelect={onSelect} />
        ))
      )}
    </section>
  );
}
