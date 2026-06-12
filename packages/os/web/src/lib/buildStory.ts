import type { Spec, CostPhaseBreakdown, SpecStatus } from "../../../src/store/types";
import { STATUS_LABEL as BADGE_LABEL } from "../components/StatusBadge";
import { fmtUsd, fmtTokens } from "../format";

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
  needs_attention: "precisa de você",
  abandoned: "abandonado",
  unreadable: "ilegível",
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

  // Sessão observada: frase curta pt-BR sem vocabulário SDD
  if (spec.observed) {
    const obsLabel = BADGE_LABEL[status];
    if (cost.totalCostUsd !== null) {
      return `${obsLabel} · ${fmtUsd(cost.totalCostUsd)}`;
    }
    if (cost.source === "cost_report") {
      return `${obsLabel} · ${fmtTokens(cost.totalTokens)} tokens`;
    }
    // Fallback partial/empty: se já há tokens, mostrar queima; senão, vazio
    if (cost.totalTokens > 0) {
      return `${obsLabel} · ${fmtTokens(cost.totalTokens)} tokens (em coleta)`;
    }
    return `${obsLabel} · sem custo ainda`;
  }

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
