import type { Spec } from "../../../src/store/types";
import { PhaseBar } from "./PhaseBar";
import { StatusBadge } from "./StatusBadge";
import { CostTag } from "./CostTag";
import { Timeline } from "./Timeline";

/**
 * O card de uma spec: compõe status + fases + custo + timeline. data-squad deixa
 * o CSS distinguir SDD de Discovery sem mudar a estrutura (o discriminador do §3).
 * projectPath desce pro Timeline montar os links dos .md.
 */
export function SpecCard({ spec, projectPath }: { spec: Spec; projectPath: string }) {
  return (
    <article className="spec-card" data-squad={spec.squad}>
      <header className="spec-head">
        <span className="spec-id">{spec.id}</span>
        <h3 className="spec-title">{spec.title}</h3>
        <StatusBadge spec={spec} />
      </header>
      <PhaseBar spec={spec} />
      <CostTag cost={spec.cost} />
      <Timeline spec={spec} projectPath={projectPath} />
    </article>
  );
}
