import type { SpecWithProject } from "../lib/kanban";
import { attentionReason, columnForSpec } from "../lib/kanban";
import { fmtTokens, fmtUsd } from "../format";
import { PhaseBar } from "./PhaseBar";
import { StatusBadge } from "./StatusBadge";
import { Timeline } from "./Timeline";
import { TaskItem } from "./TaskItem";
import { AttentionPanel } from "./AttentionPanel";
import { SpecJobIndicator } from "./SpecJobIndicator";

export function DetailDrawer({
  item,
  onClose,
}: {
  item: SpecWithProject | null;
  onClose: () => void;
}) {
  if (!item) return null;

  const { spec, projectId, projectName, projectPath } = item;
  const reason = attentionReason(spec);
  const t = spec.cost.tokens;

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`detalhe ${spec.id}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <span className="drawer-id">{spec.id}</span>
          <span className="drawer-proj">
            {projectName} · {spec.squad.toUpperCase()}
          </span>
          <StatusBadge spec={spec} />
          <SpecJobIndicator projectId={projectId} specId={spec.id} />
          <button
            type="button"
            className="drawer-close"
            aria-label="fechar"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <h2 className="drawer-title">{spec.title}</h2>

        {reason && (
          <div className={`drawer-why why-${reason.kind}`}>{reason.label}</div>
        )}

        {columnForSpec(spec) === "attention" && (
          <AttentionPanel projectId={projectId} specId={spec.id} />
        )}

        <h4 className="drawer-section">Fases</h4>
        <PhaseBar spec={spec} />

        <h4 className="drawer-section">Tarefas</h4>
        <ul className="drawer-tasks">
          {spec.tasks.length === 0 && (
            <li className="drawer-tasks-empty">sem tarefas registradas</li>
          )}
          {spec.tasks.map((task) => (
            <TaskItem key={task.id} task={task} projectId={projectId} specId={spec.id} />
          ))}
        </ul>

        <h4 className="drawer-section">Custo</h4>
        <div className="drawer-cost">
          <span className="drawer-cost-usd">{fmtUsd(spec.cost.totalCostUsd)}</span>
          <span className="mono drawer-cost-tok">
            {fmtTokens(spec.cost.totalTokens)} tokens
          </span>
          {spec.cost.partial && <span className="cost-partial">$ parcial</span>}
          {spec.cost.reportPath && (
            <a
              className="drawer-cost-report"
              href={`/file?path=${encodeURIComponent(spec.cost.reportPath)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              report.html →
            </a>
          )}
        </div>
        <dl className="drawer-cost-breakdown mono">
          <div>
            <dt>input</dt>
            <dd>{fmtTokens(t.input)}</dd>
          </div>
          <div>
            <dt>output</dt>
            <dd>{fmtTokens(t.output)}</dd>
          </div>
          <div>
            <dt>cache read</dt>
            <dd>{fmtTokens(t.cacheRead)}</dd>
          </div>
          <div>
            <dt>cache creation</dt>
            <dd>{fmtTokens(t.cacheCreation)}</dd>
          </div>
        </dl>

        <h4 className="drawer-section">Linha do tempo</h4>
        <Timeline spec={spec} projectPath={projectPath} />
      </aside>
    </div>
  );
}
