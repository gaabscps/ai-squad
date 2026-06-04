import type { Spec, CostPhaseBreakdown, SpecStatus } from "../../../src/store/types";

const PHASE_PRIORITY: Array<keyof CostPhaseBreakdown> = [
  "planning",
  "orchestration",
  "implementation",
];

const STATUS_LABEL: Record<SpecStatus, string> = {
  running: "em execução",
  paused: "pausada",
  blocked: "bloqueada",
  done: "concluída",
  escalated: "escalada",
};

function dominantPhase(byPhase: CostPhaseBreakdown): string | null {
  let best: keyof CostPhaseBreakdown | null = null;
  let bestValue = -Infinity;

  for (const phase of PHASE_PRIORITY) {
    const v = byPhase[phase] ?? -Infinity;
    // strictly greater preserves priority order on ties (earlier phase wins)
    if (v > bestValue) {
      bestValue = v;
      best = phase;
    }
  }

  return best;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

export function buildStory(spec: Spec): string {
  const { cost, tasks, status } = spec;
  const statusLabel = STATUS_LABEL[status];

  if (cost.source === "empty") {
    return `${statusLabel} · em planejamento`;
  }

  const parts: string[] = [statusLabel];

  parts.push(`${tasks.length} tarefas`);

  const blocked = tasks.filter((t) => t.state === "blocked").length;
  if (blocked > 0) {
    parts.push(`${blocked} bloqueada`);
  }

  if (cost.source === "unreliable") {
    parts.push("custo de baixa confiança");
  } else if (cost.source === "partial") {
    parts.push(
      cost.totalCostUsd !== null
        ? `${formatCost(cost.totalCostUsd)} (parcial)`
        : "(parcial)"
    );
  } else if (cost.totalCostUsd !== null) {
    parts.push(formatCost(cost.totalCostUsd));
  }

  if (cost.byPhase !== null) {
    const dom = dominantPhase(cost.byPhase);
    if (dom !== null) {
      parts.push(`fase dominante: ${dom}`);
    }
  }

  return parts.join(" · ");
}
