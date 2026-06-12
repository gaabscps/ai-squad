import type { ObservedMeta, ObservedDecision, ObservedEvidence } from "../../../src/store/types";

// Higiene de trilha: item 100% vazio (todos os campos falsy) não é exibido nem contado.
export function visibleDecisions(obs: ObservedMeta): ObservedDecision[] {
  return obs.decisions.filter((d) => d.what || d.why || d.rejected || d.ref);
}

export function visibleEvidence(obs: ObservedMeta): ObservedEvidence[] {
  return obs.evidence.filter((e) => e.cmd || e.result || e.kind);
}
