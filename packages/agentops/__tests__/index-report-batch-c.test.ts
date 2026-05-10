/**
 * Tests for render/index-report.ts — BATCH-C additions (T-021)
 * AC-031 (cost cols), AC-032 (repo health), AC-033 (cost/mutation trends), AC-034 (graceful).
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { measure } from '../src/measure';
import { parse } from '../src/parse';
import { renderIndexReport } from '../src/render/index-report';
import type { Metrics, RepoHealth, Role, Session } from '../src/types';

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');

async function sessionAndMetrics(
  fixturePath: string,
): Promise<{ session: Session; metrics: Metrics }> {
  const raw = await parse(fixturePath);
  const session = enrich(raw);
  const metrics = measure(session);
  return { session, metrics };
}

const GENERATED_AT = '2026-05-08T12:00:00Z';
const ALL_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
];

// ---------------------------------------------------------------------------
// AC-031: $ USD and $/AC columns
// ---------------------------------------------------------------------------

describe('renderIndexReport — cost columns (AC-031)', () => {
  it('shows $ USD and $/AC columns in table header', async () => {
    const a = await sessionAndMetrics(FIXTURE_A);
    const output = renderIndexReport([a], [], GENERATED_AT);
    expect(output).toContain('$ USD');
    expect(output).toContain('$/AC');
  });

  it('shows — for $ USD and $/AC when no cost data', async () => {
    const a = await sessionAndMetrics(FIXTURE_A);
    const output = renderIndexReport([a], [], GENERATED_AT);
    expect(output).toContain('— | — |');
  });

  it('shows formatted USD when cost metric present', async () => {
    const a = await sessionAndMetrics(FIXTURE_A);
    const metricsWithCost: Metrics = {
      ...a.metrics,
      cost: {
        total_usd: 6.6,
        per_ac_usd: 1.32,
        per_dispatch_avg_usd: 1.65,
        coverage: { included: 4, total: 4 },
        assumption_note: 'test',
      },
    };
    const output = renderIndexReport(
      [{ session: a.session, metrics: metricsWithCost }],
      [],
      GENERATED_AT,
    );
    expect(output).toContain('$6.6000');
    expect(output).toContain('$1.3200');
  });
});

// ---------------------------------------------------------------------------
// AC-032, AC-034: Repo health section
// ---------------------------------------------------------------------------

describe('renderIndexReport — repo health section (AC-032, AC-034)', () => {
  const mockRepoHealth: RepoHealth = {
    mutation: { score: 75.5, killed: 4, total: 6 },
    typeCoverage: { percent: 97.66, anyCount: 23 },
    depViolations: { error: 0, warn: 1 },
    measuredAt: '2026-05-08T12:00:00Z',
  };

  it('shows Repo health snapshot section when repoHealth provided (AC-032)', () => {
    const output = renderIndexReport([], [], GENERATED_AT, mockRepoHealth);
    expect(output).toContain('## Repo health snapshot');
  });

  it('shows mutation score in repo health section', () => {
    const output = renderIndexReport([], [], GENERATED_AT, mockRepoHealth);
    expect(output).toContain('75.5%');
  });

  it('graceful degradation: shows "not measured" when repoHealth=null (AC-034)', () => {
    const output = renderIndexReport([], [], GENERATED_AT, null);
    expect(output).toContain('not measured');
  });

  it('no repo health section when repoHealth not provided (back-compat)', () => {
    const output = renderIndexReport([], [], GENERATED_AT);
    expect(output).not.toContain('## Repo health snapshot');
  });
});

// ---------------------------------------------------------------------------
// AC-033: cost and mutation trends
// ---------------------------------------------------------------------------

describe('renderIndexReport — cost and mutation trends (AC-033)', () => {
  function makeMetricsWithCost(taskId: string, perAcUsd: number, mutationScore: number): Metrics {
    return {
      taskId,
      featureName: `Feature ${taskId}`,
      compliance: 'standard',
      currentPhase: 'done',
      status: 'done',
      startedAt: '2026-01-01T00:00:00Z',
      totalDispatches: 2,
      dispatchesByRole: Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>,
      taskSuccessRate: Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<
        Role,
        number | null
      >,
      loopRate: 0,
      escalationRate: 0,
      phaseDurations: {},
      acClosure: { total: 2, pass: 2, partial: 0, fail: 0, missing: 0 },
      reviewerFindings: null,
      dispatchesPerAc: 1,
      tokenCost: { total: null, perAc: null },
      reworkRate: null,
      insights: [],
      cost: {
        total_usd: perAcUsd * 2,
        per_ac_usd: perAcUsd,
        per_dispatch_avg_usd: perAcUsd,
        coverage: { included: 2, total: 2 },
        assumption_note: 'test',
      },
      repoHealth: {
        mutation: { score: mutationScore, killed: 7, total: 10 },
        typeCoverage: { percent: 97, anyCount: 10 },
        depViolations: { error: 0, warn: 0 },
        measuredAt: '2026-05-08T12:00:00Z',
      },
    };
  }

  it('shows cost trend when ≥ 2 flows have cost data', () => {
    const m1 = makeMetricsWithCost('FEAT-001', 1.0, 70);
    const m2 = makeMetricsWithCost('FEAT-002', 0.8, 75);
    const output = renderIndexReport(
      [
        { session: {} as Session, metrics: m1 },
        { session: {} as Session, metrics: m2 },
      ],
      [],
      GENERATED_AT,
    );
    expect(output).toContain('Cost per AC:');
    expect(output).toContain('FEAT-001');
    expect(output).toContain('FEAT-002');
  });

  it('shows mutation score trend when ≥ 2 flows have repoHealth', () => {
    const m1 = makeMetricsWithCost('FEAT-001', 1.0, 70);
    const m2 = makeMetricsWithCost('FEAT-002', 0.8, 75);
    const output = renderIndexReport(
      [
        { session: {} as Session, metrics: m1 },
        { session: {} as Session, metrics: m2 },
      ],
      [],
      GENERATED_AT,
    );
    expect(output).toContain('Mutation score:');
    expect(output).toContain('70.0%');
    expect(output).toContain('75.0%');
  });

  it('does not show cost trend when < 2 flows have cost data', async () => {
    const a = await sessionAndMetrics(FIXTURE_A);
    const output = renderIndexReport([a], [], GENERATED_AT);
    expect(output).not.toContain('Cost per AC:');
  });
});
