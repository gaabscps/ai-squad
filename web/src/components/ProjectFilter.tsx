import type { Project } from "../../../src/store/types";

/**
 * Filtro por projeto em chips + ocultar/mostrar (substitui o cabeçalho do antigo
 * ProjectGroup, já que o kanban não agrupa por projeto). Projetos hidden só
 * aparecem quando "mostrar ocultos" está ligado, aí com ação de "mostrar". O id
 * usado em onFilter/onHide é o estável (project.id); o name é só exibição.
 */
export function ProjectFilter({
  projects,
  filter,
  onFilter,
  showHidden,
  onShowHidden,
  onHide,
}: {
  projects: Project[];
  filter: string | null;
  onFilter: (id: string | null) => void;
  showHidden: boolean;
  onShowHidden: (v: boolean) => void;
  onHide: (id: string, hidden: boolean) => void;
}) {
  const visible = projects.filter((p) => showHidden || !p.hidden);
  return (
    <div className="pfilter">
      <button className={filter === null ? "chip on" : "chip"} onClick={() => onFilter(null)}>
        todos
      </button>
      {visible.map((p) => (
        <span key={p.id} className="chip-wrap" data-hidden={p.hidden || undefined}>
          <button className={filter === p.id ? "chip on" : "chip"} onClick={() => onFilter(p.id)}>
            {p.name}
          </button>
          <button
            className="chip-hide"
            aria-label={`${p.hidden ? "mostrar" : "ocultar"} ${p.name}`}
            title={p.hidden ? "mostrar" : "ocultar"}
            onClick={() => onHide(p.id, !p.hidden)}
          >
            {p.hidden ? "👁" : "✕"}
          </button>
        </span>
      ))}
      <label className="show-hidden">
        <input type="checkbox" checked={showHidden} onChange={(e) => onShowHidden(e.target.checked)} />
        mostrar ocultos
      </label>
    </div>
  );
}
