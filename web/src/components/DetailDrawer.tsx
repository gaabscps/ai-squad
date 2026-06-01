import type { SpecWithProject } from "../lib/kanban";
import { attentionReason } from "../lib/kanban";
import { fmtTokens, fmtUsd } from "../format";
import { PhaseBar } from "./PhaseBar";
import { StatusBadge } from "./StatusBadge";
import { Timeline } from "./Timeline";

/**
 * Painel lateral que abre ao clicar num card/linha — onde mora a "investigação".
 * Reúne motivo (quando em atenção), fases, tarefas (lista plana; a versão rica
 * colapsável é a Fase 2), custo destrinchado por tipo de token, e a timeline +
 * links dos .md (reusa <Timeline>). item null = fechado. Tudo leitura.
 */
const STATE_LABEL: Record<string, string> = {
  pending: "pendente",
  running: "rodando",
  done: "concluída",
  blocked: "bloqueada",
};

export function DetailDrawer({
  item,
  onClose,
}: {
  item: SpecWithProject | null;
  onClose: () => void;
}) {
  if (!item) return null;

  const { spec, projectName, projectPath } = item;
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

        <h4 className="drawer-section">Fases</h4>
        <PhaseBar spec={spec} />

        <h4 className="drawer-section">Tarefas</h4>
        <ul className="drawer-tasks">
          {spec.tasks.length === 0 && (
            <li className="drawer-tasks-empty">sem tarefas registradas</li>
          )}
          {spec.tasks.map((task) => (
            <li key={task.id} data-state={task.state}>
              <span className="mono">{task.id}</span>
              <span className="task-state">
                {STATE_LABEL[task.state] ?? task.state}
              </span>
              {task.loops > 1 && (
                <span className="task-loops">↻ {task.loops} loops</span>
              )}
            </li>
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
