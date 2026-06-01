import type { Spec } from "../../../src/store/types";

/**
 * Barra de fases: plannedPhases na ordem, cada uma feita/atual/futura conforme a
 * posição de `phase`. status done marca todas feitas. Os rótulos vêm de
 * plannedPhases, então Discovery (frame/investigate/decide) e SDD
 * (specify/plan/tasks/implementation) usam o MESMO componente — só os rótulos mudam.
 */
export function PhaseBar({ spec }: { spec: Spec }) {
  const current = spec.plannedPhases.indexOf(spec.phase);
  return (
    <ol className="phase-bar">
      {spec.plannedPhases.map((p, i) => {
        const state =
          spec.status === "done" || i < current
            ? "done"
            : i === current
              ? "current"
              : "future";
        return (
          <li
            key={p}
            className={`phase phase-${state}`}
            aria-current={state === "current" ? "step" : undefined}
          >
            {p}
          </li>
        );
      })}
    </ol>
  );
}
