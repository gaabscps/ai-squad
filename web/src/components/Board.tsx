import { useState } from "react";
import { useProjects } from "../state/projects";
import { flattenSpecs, matchesQuery, type SpecWithProject } from "../lib/kanban";
import { TopBar, type ViewMode } from "./TopBar";
import { ProjectFilter } from "./ProjectFilter";
import { KanbanBoard } from "./KanbanBoard";
import { SpecTable } from "./SpecTable";
import { DetailDrawer } from "./DetailDrawer";

/**
 * Orquestrador da UI. O estado vindo do WS (projects + connected) é só leitura;
 * todo o resto é estado de UI local: visão (kanban/tabela), filtro de projeto,
 * busca, "mostrar ocultos" e a spec selecionada (drawer). Achata as specs uma vez
 * e aplica filtro+busca antes de passar pro kanban/tabela. A seleção guarda
 * (projectId, specId) e re-localiza o item a cada render — se a spec sumir num
 * novo snapshot, o drawer fecha sozinho.
 */
export function Board({ onHide }: { onHide: (id: string, hidden: boolean) => void }) {
  const { projects, connected } = useProjects();
  const [view, setView] = useState<ViewMode>("kanban");
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<{ projectId: string; specId: string } | null>(null);

  const all = flattenSpecs(projects, showHidden);
  const visible = all
    .filter((sp) => filter === null || sp.projectId === filter)
    .filter((sp) => matchesQuery(sp, query));

  const selectedItem: SpecWithProject | null =
    selected
      ? all.find((sp) => sp.projectId === selected.projectId && sp.spec.id === selected.specId) ?? null
      : null;

  const handleHide = (id: string, hidden: boolean) => {
    if (hidden && filter === id) setFilter(null);
    onHide(id, hidden);
  };

  const onSelect = (item: SpecWithProject) =>
    setSelected({ projectId: item.projectId, specId: item.spec.id });

  return (
    <div className="app-shell">
      <TopBar connected={connected} query={query} onQuery={setQuery} view={view} onView={setView} />
      <ProjectFilter
        projects={projects}
        filter={filter}
        onFilter={setFilter}
        showHidden={showHidden}
        onShowHidden={setShowHidden}
        onHide={handleHide}
      />
      <main className="board-body">
        {view === "kanban" ? (
          <KanbanBoard items={visible} onSelect={onSelect} />
        ) : (
          <SpecTable items={visible} onSelect={onSelect} />
        )}
      </main>
      <DetailDrawer item={selectedItem} onClose={() => setSelected(null)} />
    </div>
  );
}
