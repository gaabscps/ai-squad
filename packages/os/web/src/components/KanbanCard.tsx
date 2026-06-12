import type { SpecWithProject } from "../lib/kanban";
import type { CostPhaseBreakdown } from "../../../src/store/types";
import { columnForSpec, attentionReason } from "../lib/kanban";
import { fmtUsd, fmtRelativeTime } from "../format";
import { SpecJobIndicator } from "./SpecJobIndicator";
import { StatusBadge } from "./StatusBadge";

const PHASES: (keyof CostPhaseBreakdown)[] = ["planning", "orchestration", "implementation"];

function CostPhaseBar({ byPhase }: { byPhase: CostPhaseBreakdown }) {
  const phases = PHASES;
  const total = phases.reduce((sum, k) => sum + (byPhase[k] ?? 0), 0);
  if (total === 0) return null;
  return (
    <ol className="cost-phase-bar" aria-label="fases">
      {phases.map((k) => {
        const val = byPhase[k] ?? 0;
        const pct = (val / total) * 100;
        return (
          <li
            key={k}
            data-phase={k}
            className={`cost-phase cost-phase-${k}`}
            style={{ width: `${pct.toFixed(1)}%` }}
            aria-label={`${k}: ${pct.toFixed(0)}%`}
          />
        );
      })}
    </ol>
  );
}

export function KanbanCard({
  item,
  onSelect,
}: {
  item: SpecWithProject;
  onSelect: (item: SpecWithProject) => void;
}) {
  const { spec, projectName } = item;
  const col = columnForSpec(spec);
  const reason = attentionReason(spec);

  const tasksDone = spec.tasks.filter((t) => t.state === "done").length;
  const tasksTotal = spec.tasks.length;

  const { source, totalCostUsd, byPhase } = spec.cost;

  return (
    <article
      className="kcard"
      data-status={spec.status}
      data-squad={spec.squad}
      onClick={() => onSelect(item)}
    >
      <div className="kcard-row1">
        <span className="kcard-id">{spec.id}</span>
        <span className="kcard-proj">{projectName}</span>
      </div>
      <h3 className="kcard-title">{spec.title}</h3>

      <StatusBadge spec={spec} />

      {col === "attention" && reason && (
        <div className={`kcard-why why-${reason.kind}`}>{reason.label}</div>
      )}

      {(col === "planning" || col === "planned" || col === "running") && spec.phase && (
        <div className="kcard-phase">{spec.phase}</div>
      )}

      <SpecJobIndicator projectId={item.projectId} specId={spec.id} />

      <div className="kcard-meta">
        <span className="kcard-tasks">{tasksDone}/{tasksTotal} concluídas</span>
        <span className="kcard-cost">
          {source === "empty" ? (
            <span className="cost-empty">em planejamento</span>
          ) : source === "unreliable" ? (
            <>
              {fmtUsd(totalCostUsd)}
              <span className="cost-unreliable"> · baixa confiança</span>
            </>
          ) : source === "partial" && totalCostUsd === null ? (
            <span className="cost-partial">(em coleta)</span>
          ) : (
            <>
              {fmtUsd(totalCostUsd)}
              {source === "partial" && <span className="cost-partial"> (parcial)</span>}
            </>
          )}
        </span>
        <time className="kcard-time">{fmtRelativeTime(spec.lastActivityAt)}</time>
      </div>

      {byPhase && <CostPhaseBar byPhase={byPhase} />}
    </article>
  );
}
