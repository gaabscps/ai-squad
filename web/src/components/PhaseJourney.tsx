import type { CostRollup, CostPhaseBreakdown } from "../../../src/store/types";
import { fmtUsd } from "../format";

const PHASES: (keyof CostPhaseBreakdown)[] = [
  "planning",
  "orchestration",
  "implementation",
];

function PhaseRow({
  name,
  value,
  isPartial,
}: {
  name: string;
  value: number | null | undefined;
  isPartial: boolean;
}) {
  let costLabel: string;
  if (value != null) {
    costLabel = fmtUsd(value);
  } else if (isPartial) {
    costLabel = "não rodada ainda";
  } else {
    costLabel = fmtUsd(null);
  }

  return (
    <li className="phase-journey-row">
      <span className="phase-journey-name">{name}</span>
      <span className="phase-journey-cost">{costLabel}</span>
    </li>
  );
}

export function PhaseJourney({ cost }: { cost: CostRollup }) {
  if (cost.source === "empty") {
    return (
      <div className="phase-journey phase-journey-empty">
        <span className="phase-journey-empty-label">sem dados de custo</span>
      </div>
    );
  }

  const isPartial = cost.source === "partial";
  const isUnreliable = cost.source === "unreliable";
  const isReportWithoutPhases = cost.source === "report" && cost.byPhase === null;

  return (
    <div className="phase-journey">
      {isPartial && (
        <span className="phase-journey-badge phase-journey-partial">parcial</span>
      )}
      {isUnreliable && (
        <span className="phase-journey-badge phase-journey-unreliable">não confiável</span>
      )}
      {isReportWithoutPhases && (
        <span className="phase-journey-badge phase-journey-no-phases">dados de fase indisponíveis</span>
      )}
      <ol className="phase-journey-list">
        {PHASES.map((phase) => (
          <PhaseRow
            key={phase}
            name={phase}
            value={cost.byPhase?.[phase]}
            isPartial={isPartial}
          />
        ))}
      </ol>
      <div className="phase-journey-total">
        <span className="phase-journey-total-label">total</span>
        <span
          className="phase-journey-total-value"
          data-testid="phase-journey-total"
        >
          {fmtUsd(cost.totalCostUsd)}
        </span>
      </div>
    </div>
  );
}
