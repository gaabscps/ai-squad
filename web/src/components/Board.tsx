import { useState } from "react";
import { useProjects } from "../state/projects";
import { flattenSpecs, matchesQuery, isArchived, type SpecWithProject } from "../lib/kanban";
import { TopBar, type ViewMode } from "./TopBar";
import { ProjectFilter } from "./ProjectFilter";
import { KanbanBoard } from "./KanbanBoard";
import { SpecTable } from "./SpecTable";
import { DetailDrawer } from "./DetailDrawer";

/**
 * A seleção guarda (projectId, specId) e re-localiza o item a cada render — se
 * a spec sumir num novo snapshot, o drawer fecha sozinho.
 */
export interface SelectedSpec {
  projectId: string;
  specId: string;
}

export function Board({
  onHide,
  selected: selectedProp,
  onSelect: onSelectProp,
  onClose: onCloseProp,
  onOpenFolderManager,
}: {
  onHide: (id: string, hidden: boolean) => void;
  selected?: SelectedSpec | null;
  onSelect?: (spec: SelectedSpec) => void;
  onClose?: () => void;
  onOpenFolderManager?: () => void;
}) {
  const { projects, connected, archiveAfterDays } = useProjects();
  const [view, setView] = useState<ViewMode>("kanban");
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [internalSelected, setInternalSelected] = useState<SelectedSpec | null>(null);

  const isControlled = selectedProp !== undefined;
  const activeSelected = isControlled ? selectedProp : internalSelected;

  const all = flattenSpecs(projects, showHidden);
  const visible = all
    .filter((sp) => filter === null || sp.projectId === filter)
    .filter((sp) => matchesQuery(sp, query));

  // Separação arquivo × ativo em render-time: depende do relógio, não do disco.
  // 'shown' é o que o componente de listagem recebe; 'selectedItem' ainda usa
  // 'all' pra o drawer poder abrir qualquer spec (inclusive arquivadas).
  // Sem timer de propósito: o próximo render (snapshot do WS ou interação) já
  // reavalia a idade; como o limiar é em dias, não vale um setInterval só pra
  // mover um card no instante exato em que ele cruza o limite.
  const now = Date.now();
  const shown = visible.filter((sp) =>
    view === "archived"
      ? isArchived(sp.spec, now, archiveAfterDays)
      : !isArchived(sp.spec, now, archiveAfterDays),
  );

  const selectedItem: SpecWithProject | null =
    activeSelected
      ? all.find((sp) => sp.projectId === activeSelected.projectId && sp.spec.id === activeSelected.specId) ?? null
      : null;

  const handleHide = (id: string, hidden: boolean) => {
    if (hidden && filter === id) setFilter(null);
    onHide(id, hidden);
  };

  // Ao desligar "mostrar ocultos", um filtro apontando pra um projeto oculto
  // deixaria o board vazio (o projeto some de flattenSpecs e dos chips). Reseta o
  // filtro nesse caso pra não exibir uma tela em branco sem explicação.
  const handleShowHidden = (v: boolean) => {
    if (!v) setFilter(null);
    setShowHidden(v);
  };

  const handleSelect = (item: SpecWithProject) => {
    const spec: SelectedSpec = { projectId: item.projectId, specId: item.spec.id };
    if (isControlled && onSelectProp) {
      onSelectProp(spec);
    } else {
      setInternalSelected(spec);
    }
  };

  const handleClose = () => {
    if (isControlled && onCloseProp) {
      onCloseProp();
    } else {
      setInternalSelected(null);
    }
  };

  return (
    <div className="app-shell">
      <TopBar connected={connected} query={query} onQuery={setQuery} view={view} onView={setView} onOpenFolderManager={onOpenFolderManager} />
      <ProjectFilter
        projects={projects}
        filter={filter}
        onFilter={setFilter}
        showHidden={showHidden}
        onShowHidden={handleShowHidden}
        onHide={handleHide}
      />
      <main className="board-body">
        {view === "kanban" ? (
          <KanbanBoard items={shown} onSelect={handleSelect} />
        ) : view === "archived" && shown.length === 0 ? (
          <p className="empty-archived">Nenhuma feature arquivada.</p>
        ) : (
          <SpecTable items={shown} onSelect={handleSelect} />
        )}
      </main>
      <DetailDrawer item={selectedItem} onClose={handleClose} />
    </div>
  );
}
