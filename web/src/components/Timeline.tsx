import type { Spec } from "../../../src/store/types";

/**
 * Lista os notes[] da Session e abre os .md no visualizador in-app (via onOpenFile).
 * O path do .md deriva de projectPath + spec.id (a Session vive em
 * <projectPath>/.agent-session/<id>/). O squad decide QUAIS docs: SDD tem
 * spec/plan/tasks; Discovery tem memo.
 */
export function Timeline({
  spec,
  projectPath,
  onOpenFile,
}: {
  spec: Spec;
  projectPath: string;
  onOpenFile: (path: string, title: string) => void;
}) {
  const specDir = `${projectPath}/.agent-session/${spec.id}`;
  const docs = spec.squad === "discovery" ? ["memo.md"] : ["spec.md", "plan.md", "tasks.md"];
  return (
    <div className="timeline">
      <ul className="timeline-notes">
        {spec.timeline.map((e, i) => (
          <li key={i}>
            <time>{e.timestamp}</time> <b>{e.kind}</b> {e.note}
          </li>
        ))}
      </ul>
      <nav className="timeline-docs">
        {docs.map((d) => (
          <button key={d} type="button" onClick={() => onOpenFile(`${specDir}/${d}`, d)}>
            {d}
          </button>
        ))}
      </nav>
    </div>
  );
}
