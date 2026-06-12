import type { SpecWithProject } from "../lib/kanbanObserved";
import type { CostPhaseBreakdown } from "../../../src/store/types";
import { columnForSpec, attentionReason } from "../lib/kanbanObserved";
import { fmtUsd, fmtTokens, fmtRelativeTime } from "../format";
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

  const isObserved = spec.observed != null;
  const tasksDone = spec.tasks.filter((t) => t.state === "done").length;
  const tasksTotal = spec.tasks.length;

  const { source, totalCostUsd, byPhase, totalTokens } = spec.cost;

  /** Rótulo de custo no card: regras diferentes por modo. */
  function renderCostLabel() {
    // Modo observado: tokens são a métrica primária; USD pode ser nulo por design.
    if (isObserved) {
      if (totalCostUsd !== null) {
        // source=partial significa contrato ainda aberto (valores acumulando); indica ao usuário.
        return (
          <>
            {fmtUsd(totalCostUsd)}
            {source === "partial" && <span className="cost-partial"> (em coleta)</span>}
          </>
        );
      }
      if (source === "cost_report") {
        // Report confiável mas sem preço — exibe total de tokens + aviso muted
        return (
          <>
            {fmtTokens(totalTokens)} tokens
            <span className="cost-unpriced"> · $ indisponível</span>
          </>
        );
      }
      // Fallback partial/empty: se já há tokens, mostrar queima; senão, vazio
      if (totalTokens > 0) {
        return <span className="cost-empty">{fmtTokens(totalTokens)} tokens (em coleta)</span>;
      }
      return <span className="cost-empty">sem custo ainda</span>;
    }

    // Modo SDD legado: comportamento original
    if (source === "empty") {
      return <span className="cost-empty">em planejamento</span>;
    }
    if (source === "unreliable") {
      return (
        <>
          {fmtUsd(totalCostUsd)}
          <span className="cost-unreliable"> · baixa confiança</span>
        </>
      );
    }
    if (source === "partial" && totalCostUsd === null) {
      return <span className="cost-partial">(em coleta)</span>;
    }
    return (
      <>
        {fmtUsd(totalCostUsd)}
        {source === "partial" && <span className="cost-partial"> (parcial)</span>}
      </>
    );
  }

  return (
    <article
      className="kcard"
      data-status={spec.status}
      data-squad={spec.squad}
      data-mode={isObserved ? "observed" : undefined}
      onClick={() => onSelect(item)}
    >
      <div className="kcard-row1">
        <span className="kcard-id">{spec.id}</span>
        <span className="kcard-proj">{projectName}</span>
      </div>
      <h3 className="kcard-title" title={spec.title}>{spec.title}</h3>

      <StatusBadge spec={spec} />

      {col === "attention" && reason && (
        <div className={`kcard-why why-${reason.kind}`}>{reason.label}</div>
      )}

      {col === "running" && spec.phase && (
        <div className="kcard-phase">{spec.phase}</div>
      )}

      <SpecJobIndicator projectId={item.projectId} specId={spec.id} />

      <div className="kcard-meta">
        {!isObserved && (
          <span className="kcard-tasks">{tasksDone}/{tasksTotal} concluídas</span>
        )}
        <span className="kcard-cost">{renderCostLabel()}</span>
        <time className="kcard-time">{fmtRelativeTime(spec.lastActivityAt)}</time>
      </div>

      {byPhase && <CostPhaseBar byPhase={byPhase} />}
    </article>
  );
}
