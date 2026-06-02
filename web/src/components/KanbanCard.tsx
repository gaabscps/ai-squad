import type { SpecWithProject } from "../lib/kanban";
import { columnForSpec, attentionReason } from "../lib/kanban";
import { fmtTokens, fmtUsd, fmtRelativeTime } from "../format";
import { SpecJobIndicator } from "./SpecJobIndicator";

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

      {col === "attention" && reason && (
        <div className={`kcard-why why-${reason.kind}`}>{reason.label}</div>
      )}

      {(col === "planning" || col === "planned" || col === "running") && spec.phase && (
        <div className="kcard-phase">{spec.phase}</div>
      )}

      <SpecJobIndicator projectId={item.projectId} specId={spec.id} />

      <div className="kcard-meta">
        <span className="kcard-cost">
          {fmtTokens(spec.cost.totalTokens)} tok · {fmtUsd(spec.cost.totalCostUsd)}
        </span>
        <time className="kcard-time">{fmtRelativeTime(spec.lastActivityAt)}</time>
      </div>
    </article>
  );
}
