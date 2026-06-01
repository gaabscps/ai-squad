import { useState } from "react";
import { useProjects } from "../state/projects";
import { ProjectGroup } from "./ProjectGroup";

/**
 * O board: barra com indicador de conexão (ao vivo/reconectando) + filtro por tag
 * de projeto, e a lista de grupos. Por padrão esconde os projetos hidden (o
 * "ocultar avulso" do §6), com um toggle pra revê-los. O filtro e o toggle são
 * estado de UI puramente local (useState) — não tocam o estado vindo do WS.
 */
export function Board({ onHide }: { onHide: (id: string, hidden: boolean) => void }) {
  const { projects, connected } = useProjects();
  const [filter, setFilter] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const visible = projects
    .filter((p) => showHidden || !p.hidden)
    .filter((p) => filter === null || p.id === filter);

  return (
    <div className="board">
      <header className="board-bar">
        <span className={`conn conn-${connected ? "up" : "down"}`}>
          {connected ? "ao vivo" : "reconectando…"}
        </span>
        <div className="tags">
          <button className={filter === null ? "tag active" : "tag"} onClick={() => setFilter(null)}>
            todos
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              className={filter === p.id ? "tag active" : "tag"}
              onClick={() => setFilter(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <label className="show-hidden">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />{" "}
          mostrar ocultos
        </label>
      </header>
      {visible.map((p) => (
        <ProjectGroup key={p.id} project={p} onHide={onHide} />
      ))}
    </div>
  );
}
