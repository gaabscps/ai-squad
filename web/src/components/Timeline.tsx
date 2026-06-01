import type { Spec } from "../../../src/store/types";

/**
 * Lista os notes[] da Session e oferece links pros .md, servidos pela rota /file.
 * O path do .md deriva de projectPath + spec.id (a Session vive em
 * <projectPath>/.agent-session/<id>/). O squad decide QUAIS docs: SDD tem
 * spec/plan/tasks; Discovery tem memo. O card só linka — não lê o conteúdo (§3 YAGNI).
 */
export function Timeline({ spec, projectPath }: { spec: Spec; projectPath: string }) {
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
          <a
            key={d}
            href={`/file?path=${encodeURIComponent(`${specDir}/${d}`)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {d}
          </a>
        ))}
      </nav>
    </div>
  );
}
