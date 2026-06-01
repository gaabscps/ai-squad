import type { Project } from "../../../src/store/types";
import { SpecCard } from "./SpecCard";

/**
 * Um projeto: a tag (name), o botão ocultar/mostrar (manda hide/unhide pelo WS via
 * onHide), e os cards das suas specs. A identidade usada no comando é o id estável
 * (project.id); o name é só exibição.
 */
export function ProjectGroup({
  project,
  onHide,
}: {
  project: Project;
  onHide: (id: string, hidden: boolean) => void;
}) {
  return (
    <section className="project-group">
      <header className="project-head">
        <span className="project-tag">{project.name}</span>
        <button className="project-hide" onClick={() => onHide(project.id, !project.hidden)}>
          {project.hidden ? "mostrar" : "ocultar"}
        </button>
      </header>
      <div className="cards">
        {project.specs.map((s) => (
          <SpecCard key={s.id} spec={s} projectPath={project.path} />
        ))}
      </div>
    </section>
  );
}
