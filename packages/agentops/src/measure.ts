/**
 * AgentOps observability extractor — measure.ts
 * Aggregates all metric sub-functions into a Metrics object.
 * Each sub-function is a named export for direct unit testing.
 *
 * Sub-functions are split into measure/ sub-modules per Plan D4/D13
 * to keep each file < 250 lines.
 */

import { computeTokenCost, computeCostUsd } from './measure/cost';
import {
  computeDispatchesByRole,
  computeDispatchesPerAc,
  computeEscalationRate,
  computeLoopRate,
  computeTaskSuccessRate,
} from './measure/dispatches';
import { computeAcClosureSummary, computeReviewerFindings } from './measure/findings';
import { computePhaseDurations } from './measure/timing';
import type { Metrics, Role, Session } from './types';

// Re-export sub-functions so test files can import them directly from measure.ts
export {
  computeDispatchesByRole,
  computeTaskSuccessRate,
  computeLoopRate,
  computeEscalationRate,
  computeDispatchesPerAc,
} from './measure/dispatches';

export { computePhaseDurations } from './measure/timing';

export { computeAcClosureSummary, computeReviewerFindings } from './measure/findings';

export { computeTokenCost, computeCostUsd } from './measure/cost';

const ALL_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
  'pm-orchestrator',
];

/**
 * Computes all metrics for a session.
 * insights[] is left empty here — it is populated by insights.ts downstream.
 */
export function measure(session: Session): Metrics {
  const dispatchesByRole = computeDispatchesByRole(session);
  const taskSuccessRate = Object.fromEntries(
    ALL_ROLES.map((role) => [role, computeTaskSuccessRate(session, role)]),
  ) as Record<Role, number | null>;

  return {
    taskId: session.taskId,
    featureName: session.featureName,
    compliance: session.compliance,
    currentPhase: session.currentPhase,
    status: session.status,
    startedAt: session.startedAt,
    totalDispatches: session.dispatches.length,
    dispatchesByRole,
    taskSuccessRate,
    loopRate: computeLoopRate(session),
    escalationRate: computeEscalationRate(session),
    phaseDurations: computePhaseDurations(session),
    acClosure: computeAcClosureSummary(session),
    reviewerFindings: computeReviewerFindings(session),
    dispatchesPerAc: computeDispatchesPerAc(session),
    tokenCost: computeTokenCost(session),
    cost: computeCostUsd(session),
    reworkRate: null,
    insights: [], // populated by insights.ts
  };
}
