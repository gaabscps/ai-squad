/**
 * AgentOps observability extractor — insights.ts
 * T-011: deterministic insight rules (AC-024) + cross-flow trends (AC-025).
 *
 * Single-flow rules: applyInsightRules(metrics) → Insight[]
 * Cross-flow trends: computeTrends(allMetrics) → Insight[]
 */

import {
  GALILEO_HEALTHY_ESCALATION_BAND,
  LOOP_RATE_INVESTIGATE_THRESHOLD,
  TRUST_SCORE_HEALTHY_THRESHOLD,
  TRUST_SCORE_INVESTIGATE_THRESHOLD,
} from './constants';
import type { Insight, Metrics } from './types';

// ---------------------------------------------------------------------------
// Internal rule type
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  predicate: (m: Metrics) => boolean;
  emit: (m: Metrics) => Insight;
}

// ---------------------------------------------------------------------------
// Extended metrics type for internal use (audit_blocked_initial rule)
// ---------------------------------------------------------------------------

interface MetricsWithAudit extends Metrics {
  _blockedAuditDispatches?: number;
}

// ---------------------------------------------------------------------------
// Single-flow rules (Plan D15, Tasks T-011)
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  {
    id: 'escalation_above_band',
    predicate: (m) => m.escalationRate > GALILEO_HEALTHY_ESCALATION_BAND.upper,
    emit: (m) => ({
      ruleId: 'escalation_above_band',
      severity: 'warn',
      message: `Escalation rate ${(m.escalationRate * 100).toFixed(1)}% is above the Galileo healthy band (> ${GALILEO_HEALTHY_ESCALATION_BAND.upper * 100}%) — investigate dispatch quality or preflight contract.`,
      source: 'Galileo healthy band',
    }),
  },
  {
    id: 'escalation_below_band',
    predicate: (m) => m.escalationRate < GALILEO_HEALTHY_ESCALATION_BAND.lower,
    emit: (m) => ({
      ruleId: 'escalation_below_band',
      severity: 'info',
      message: `Escalation rate ${(m.escalationRate * 100).toFixed(1)}% is below the Galileo healthy band (< ${GALILEO_HEALTHY_ESCALATION_BAND.lower * 100}%) — low escalation, agents resolving autonomously.`,
      source: 'Galileo healthy band',
    }),
  },
  {
    id: 'dev_trust_low',
    predicate: (m) => {
      const rate = m.taskSuccessRate.dev;
      return rate !== null && rate < TRUST_SCORE_INVESTIGATE_THRESHOLD;
    },
    emit: (m) => ({
      ruleId: 'dev_trust_low',
      severity: 'warn',
      message: `Dev task success rate ${((m.taskSuccessRate.dev ?? 0) * 100).toFixed(1)}% is below ${TRUST_SCORE_INVESTIGATE_THRESHOLD * 100}% — review dev prompt quality or scope clarity.`,
      source: null,
    }),
  },
  {
    id: 'dev_trust_high',
    predicate: (m) => {
      const rate = m.taskSuccessRate.dev;
      return rate !== null && rate >= TRUST_SCORE_HEALTHY_THRESHOLD;
    },
    emit: (m) => ({
      ruleId: 'dev_trust_high',
      severity: 'info',
      message: `Dev task success rate ${((m.taskSuccessRate.dev ?? 0) * 100).toFixed(1)}% is at or above ${TRUST_SCORE_HEALTHY_THRESHOLD * 100}% — healthy first-try rate.`,
      source: null,
    }),
  },
  {
    id: 'loop_rate_high',
    predicate: (m) => m.loopRate > LOOP_RATE_INVESTIGATE_THRESHOLD,
    emit: (m) => ({
      ruleId: 'loop_rate_high',
      severity: 'warn',
      message: `Loop rate ${(m.loopRate * 100).toFixed(1)}% exceeds ${LOOP_RATE_INVESTIGATE_THRESHOLD * 100}% — more than half of dispatches needed loops. Consider strengthening the preflight contract.`,
      source: null,
    }),
  },
  {
    id: 'audit_blocked_initial',
    predicate: (m) => {
      const ext = m as MetricsWithAudit;
      return typeof ext._blockedAuditDispatches === 'number' && ext._blockedAuditDispatches > 0;
    },
    emit: () => ({
      ruleId: 'audit_blocked_initial',
      severity: 'info',
      message:
        'At least one audit-agent dispatch was initially blocked — audit recovered in a subsequent dispatch.',
      source: null,
    }),
  },
];

// ---------------------------------------------------------------------------
// Public: applyInsightRules
// ---------------------------------------------------------------------------

/**
 * Runs all single-flow rules against the provided Metrics and returns
 * the matched Insights in rule-declaration order.
 */
export function applyInsightRules(metrics: Metrics): Insight[] {
  return RULES.filter((rule) => rule.predicate(metrics)).map((rule) => rule.emit(metrics));
}

// ---------------------------------------------------------------------------
// Public: computeTrends
// ---------------------------------------------------------------------------

/**
 * Computes cross-flow trend insights from an ordered array of Metrics.
 * Requires ≥ 2 completed (status === 'done') flows; otherwise returns [].
 * Compares the last two completed flows.
 *
 * Flows com `compliance !== 'standard'` (pré-padrão / pm-bypass) são
 * excluídos para não distorcer a curva de evolução do contrato.
 */
export function computeTrends(allMetrics: Metrics[]): Insight[] {
  const completed = allMetrics.filter((m) => m.status === 'done' && m.compliance === 'standard');
  if (completed.length < 2) return [];

  const prev = completed[completed.length - 2];
  const curr = completed[completed.length - 1];
  if (!prev || !curr) return [];
  const insights: Insight[] = [];

  // dispatches_per_ac_trend
  const prevDpa = prev.dispatchesPerAc;
  const currDpa = curr.dispatchesPerAc;
  const dpaChange = prevDpa !== 0 ? (((currDpa - prevDpa) / prevDpa) * 100).toFixed(1) : '—';
  const dpaSign = currDpa > prevDpa ? '+' : '';
  insights.push({
    ruleId: 'dispatches_per_ac_trend',
    severity: 'info',
    message: `Dispatches/AC: ${prev.taskId}=${prevDpa.toFixed(2)} → ${curr.taskId}=${currDpa.toFixed(2)} (${dpaSign}${dpaChange}%)`,
    source: null,
  });

  // trust_score_trend (only when both flows have dev rate)
  const prevDev = prev.taskSuccessRate.dev;
  const currDev = curr.taskSuccessRate.dev;
  if (prevDev !== null && currDev !== null) {
    const trustChange = prevDev !== 0 ? (((currDev - prevDev) / prevDev) * 100).toFixed(1) : '—';
    const trustSign = currDev > prevDev ? '+' : '';
    insights.push({
      ruleId: 'trust_score_trend',
      severity: 'info',
      message: `Dev task success rate: ${prev.taskId}=${(prevDev * 100).toFixed(1)}% → ${curr.taskId}=${(currDev * 100).toFixed(1)}% (${trustSign}${trustChange}%)`,
      source: null,
    });
  }

  return insights;
}
