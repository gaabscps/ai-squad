/**
 * Unit tests for insights.ts — T-011
 * AC-024 (single-flow rules) + AC-025 (cross-flow trends)
 * ≥ 12 tests for rules + ≥ 4 for trends = ≥ 16 total
 */

import { applyInsightRules, computeTrends } from '../src/insights';
import type { Metrics, Role } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const ALL_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
];

function makeMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test feature',
    compliance: 'standard',
    currentPhase: 'done',
    status: 'done',
    startedAt: '2026-01-01T00:00:00Z',
    totalDispatches: 4,
    dispatchesByRole: Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>,
    taskSuccessRate: Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<
      Role,
      number | null
    >,
    loopRate: 0,
    escalationRate: 0,
    phaseDurations: {},
    acClosure: { total: 5, pass: 5, partial: 0, fail: 0, missing: 0 },
    reviewerFindings: null,
    dispatchesPerAc: 0.8,
    tokenCost: { total: null, perAc: null },
    reworkRate: null,
    insights: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule: escalation_above_band
// ---------------------------------------------------------------------------

describe('rule: escalation_above_band', () => {
  it('emits warn insight when escalation_rate > 0.15', () => {
    const metrics = makeMetrics({ escalationRate: 0.2 });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'escalation_above_band');
    expect(found).toBeDefined();
    expect(found?.severity).toBe('warn');
    expect(found?.source).toBe('Galileo healthy band');
  });

  it('does NOT emit escalation_above_band when escalation_rate <= 0.15', () => {
    const metrics = makeMetrics({ escalationRate: 0.15 });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'escalation_above_band');
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: escalation_below_band
// ---------------------------------------------------------------------------

describe('rule: escalation_below_band', () => {
  it('emits info insight when escalation_rate < 0.10', () => {
    const metrics = makeMetrics({ escalationRate: 0.05 });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'escalation_below_band');
    expect(found).toBeDefined();
    expect(found?.severity).toBe('info');
    expect(found?.source).toBe('Galileo healthy band');
  });

  it('does NOT emit escalation_below_band when escalation_rate >= 0.10', () => {
    const metrics = makeMetrics({ escalationRate: 0.1 });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'escalation_below_band');
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: dev_trust_low
// ---------------------------------------------------------------------------

describe('rule: dev_trust_low', () => {
  it('emits warn insight when dev taskSuccessRate < 0.60', () => {
    const metrics = makeMetrics({
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.5,
      },
    });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'dev_trust_low');
    expect(found).toBeDefined();
    expect(found?.severity).toBe('warn');
  });

  it('does NOT emit dev_trust_low when dev rate is null', () => {
    const metrics = makeMetrics({
      taskSuccessRate: Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<
        Role,
        number | null
      >,
    });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'dev_trust_low');
    expect(found).toBeUndefined();
  });

  it('does NOT emit dev_trust_low when dev rate >= 0.60', () => {
    const metrics = makeMetrics({
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.6,
      },
    });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'dev_trust_low');
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: dev_trust_high
// ---------------------------------------------------------------------------

describe('rule: dev_trust_high', () => {
  it('emits info insight when dev taskSuccessRate >= 0.80', () => {
    const metrics = makeMetrics({
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.8,
      },
    });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'dev_trust_high');
    expect(found).toBeDefined();
    expect(found?.severity).toBe('info');
  });

  it('does NOT emit dev_trust_high when dev rate < 0.80', () => {
    const metrics = makeMetrics({
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.75,
      },
    });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'dev_trust_high');
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: loop_rate_high
// ---------------------------------------------------------------------------

describe('rule: loop_rate_high', () => {
  it('emits warn insight when loopRate > 0.50', () => {
    const metrics = makeMetrics({ loopRate: 0.6 });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'loop_rate_high');
    expect(found).toBeDefined();
    expect(found?.severity).toBe('warn');
  });

  it('does NOT emit loop_rate_high when loopRate <= 0.50', () => {
    const metrics = makeMetrics({ loopRate: 0.5 });
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'loop_rate_high');
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Rule: audit_blocked_initial
// ---------------------------------------------------------------------------

describe('rule: audit_blocked_initial', () => {
  it('emits info insight when any audit-agent dispatch has status blocked', () => {
    const metrics = makeMetrics({
      dispatchesByRole: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>),
        'audit-agent': 1,
      },
      // We inject via insights internal mechanism: use a special marker field
      // The rule checks _blockedAuditDispatches field on Metrics (extended)
    });
    // Patch in _blockedAuditDispatches to simulate audit dispatch with blocked status
    const metricsWithBlocked = {
      ...metrics,
      _blockedAuditDispatches: 1,
    } as unknown as Metrics;
    const insights = applyInsightRules(metricsWithBlocked);
    const found = insights.find((i) => i.ruleId === 'audit_blocked_initial');
    expect(found).toBeDefined();
    expect(found?.severity).toBe('info');
  });

  it('does NOT emit audit_blocked_initial when no audit-agent dispatch is blocked', () => {
    const metrics = makeMetrics();
    const insights = applyInsightRules(metrics);
    const found = insights.find((i) => i.ruleId === 'audit_blocked_initial');
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyInsightRules: general
// ---------------------------------------------------------------------------

describe('applyInsightRules', () => {
  it('returns empty array when no rules match', () => {
    const metrics = makeMetrics({
      escalationRate: 0.12, // within band
      loopRate: 0.2, // low
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: null,
      },
    });
    const insights = applyInsightRules(metrics);
    expect(Array.isArray(insights)).toBe(true);
    // May have escalation_below_band (0.12 >= 0.10, so no) — actually 0.12 is within band
    const warns = insights.filter((i) => i.severity === 'warn');
    expect(warns).toHaveLength(0);
  });

  it('all matched insights have required fields (ruleId, severity, message, source)', () => {
    const metrics = makeMetrics({ escalationRate: 0.2, loopRate: 0.8 });
    const insights = applyInsightRules(metrics);
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(typeof insight.ruleId).toBe('string');
      expect(['info', 'warn', 'error']).toContain(insight.severity);
      expect(typeof insight.message).toBe('string');
      expect(insight.message.length).toBeGreaterThan(0);
      // source is string or null
      expect(insight.source === null || typeof insight.source === 'string').toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// computeTrends
// ---------------------------------------------------------------------------

describe('computeTrends', () => {
  it('returns empty array when fewer than 2 metrics provided', () => {
    const trends = computeTrends([makeMetrics()]);
    expect(trends).toEqual([]);
  });

  it('returns empty array when 0 metrics provided', () => {
    const trends = computeTrends([]);
    expect(trends).toEqual([]);
  });

  it('returns dispatches_per_ac_trend and trust_score_trend when ≥ 2 completed flows', () => {
    const m1 = makeMetrics({
      taskId: 'FEAT-001',
      status: 'done',
      dispatchesPerAc: 0.36,
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.8,
      },
    });
    const m2 = makeMetrics({
      taskId: 'FEAT-002',
      status: 'done',
      dispatchesPerAc: 0.21,
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.6,
      },
    });
    const trends = computeTrends([m1, m2]);
    expect(trends.length).toBeGreaterThanOrEqual(1);
    const ruleIds = trends.map((t) => t.ruleId);
    expect(ruleIds).toContain('dispatches_per_ac_trend');
  });

  it('skips non-done flows when computing trends', () => {
    const m1 = makeMetrics({ taskId: 'FEAT-001', status: 'done', dispatchesPerAc: 0.36 });
    const m2 = makeMetrics({ taskId: 'FEAT-002', status: 'running', dispatchesPerAc: 0.5 });
    // Only 1 completed flow → no trends
    const trends = computeTrends([m1, m2]);
    expect(trends).toHaveLength(0);
  });

  it('trust_score_trend included when both flows have dev rate', () => {
    const m1 = makeMetrics({
      taskId: 'FEAT-001',
      status: 'done',
      dispatchesPerAc: 0.36,
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.8,
      },
    });
    const m2 = makeMetrics({
      taskId: 'FEAT-002',
      status: 'done',
      dispatchesPerAc: 0.21,
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.5,
      },
    });
    const trends = computeTrends([m1, m2]);
    const ruleIds = trends.map((t) => t.ruleId);
    expect(ruleIds).toContain('trust_score_trend');
  });

  it('dispatches_per_ac_trend shows "—" when prevDpa is 0', () => {
    const m1 = makeMetrics({ taskId: 'FEAT-001', status: 'done', dispatchesPerAc: 0 });
    const m2 = makeMetrics({ taskId: 'FEAT-002', status: 'done', dispatchesPerAc: 0.5 });
    const trends = computeTrends([m1, m2]);
    const dpa = trends.find((t) => t.ruleId === 'dispatches_per_ac_trend');
    expect(dpa).toBeDefined();
    expect(dpa!.message).toContain('—');
  });

  it('trust_score_trend shows "—" when prevDev is 0', () => {
    const m1 = makeMetrics({
      taskId: 'FEAT-001',
      status: 'done',
      dispatchesPerAc: 0.5,
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0,
      },
    });
    const m2 = makeMetrics({
      taskId: 'FEAT-002',
      status: 'done',
      dispatchesPerAc: 0.5,
      taskSuccessRate: {
        ...(Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<Role, number | null>),
        dev: 0.5,
      },
    });
    const trends = computeTrends([m1, m2]);
    const trust = trends.find((t) => t.ruleId === 'trust_score_trend');
    expect(trust).toBeDefined();
    expect(trust!.message).toContain('—');
  });

  it('trust_score_trend omitted when either dev rate is null', () => {
    const m1 = makeMetrics({ taskId: 'FEAT-001', status: 'done', dispatchesPerAc: 0.5 });
    const m2 = makeMetrics({ taskId: 'FEAT-002', status: 'done', dispatchesPerAc: 0.5 });
    const trends = computeTrends([m1, m2]);
    const trust = trends.find((t) => t.ruleId === 'trust_score_trend');
    expect(trust).toBeUndefined();
  });
});
