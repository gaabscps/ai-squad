import type { Spec, CostPhaseBreakdown, SpecStatus } from "../../../src/store/types";
// BADGE_LABEL = masculino curto (badge); STATUS_LABEL local = feminino narrativo (story).
// Dualidade intencional — badge diz "bloqueado", prosa diz "bloqueada".
import { STATUS_LABEL as BADGE_LABEL } from "./statusLabels";
import { fmtUsd, fmtTokens, fmtRelativeTime } from "../format";
import { visibleDecisions, visibleEvidence } from "./observedTrail";

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

export function buildStory(spec: Spec, now: number = Date.now()): string {
  const { cost, tasks, status } = spec;
  const statusLabel = STATUS_LABEL[status];

  // Sessão observada: manchete narrada — janela + contagens da trilha + custo.
  // O intent NÃO entra (o título do drawer/card já é o intent).
  if (spec.observed) {
    const obs = spec.observed;
    const terminal = status === "done" || status === "abandoned";
    const parts: string[] = [BADGE_LABEL[status]];

    if (!terminal && obs.createdAt) {
      parts.push(`aberto ${fmtRelativeTime(obs.createdAt, now)}`);
    }
    const nd = visibleDecisions(obs).length;
    if (nd > 0) parts.push(nd === 1 ? "1 decisão" : `${nd} decisões`);
    const ne = visibleEvidence(obs).length;
    if (ne > 0) parts.push(ne === 1 ? "1 verificação" : `${ne} verificações`);

    if (cost.totalCostUsd !== null) {
      parts.push(fmtUsd(cost.totalCostUsd));
    } else if (cost.source === "cost_report") {
      parts.push(`${fmtTokens(cost.totalTokens)} tokens`);
    } else if (cost.totalTokens > 0) {
      parts.push(`${fmtTokens(cost.totalTokens)} tokens (em coleta)`);
    } else {
      parts.push("sem custo ainda");
    }
    return parts.join(" · ");
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
