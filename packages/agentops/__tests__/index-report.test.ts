/**
 * Tests for render/index-report.ts — T-013
 * AC-002, AC-003, AC-004, AC-005, AC-025
 * Snapshot tests with various fixture combinations.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { computeTrends } from '../src/insights';
import { measure } from '../src/measure';
import { parse } from '../src/parse';
import { renderIndexReport } from '../src/render/index-report';
import type { Metrics, Role, Session } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');
const FIXTURE_B = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-B');

async function sessionAndMetrics(
  fixturePath: string,
): Promise<{ session: Session; metrics: Metrics }> {
  const raw = await parse(fixturePath);
  const session = enrich(raw);
  const metrics = measure(session);
  return { session, metrics };
}

/** Mask the generated-at line for deterministic snapshots */
function maskTimestamp(md: string): string {
  return md.replace(/^> Generated at: .+$/m, '> Generated at: <MASKED>');
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
// Snapshot: 2 fixtures (A done + B spec-only)
// ---------------------------------------------------------------------------

describe('renderIndexReport — 2 flows (A + B)', () => {
  let output: string;

  beforeAll(async () => {
    const a = await sessionAndMetrics(FIXTURE_A);
    const b = await sessionAndMetrics(FIXTURE_B);
    const allMetrics = [a, b];
    const trendInsights = computeTrends(allMetrics.map((m) => m.metrics));
    output = renderIndexReport(allMetrics, trendInsights, GENERATED_AT);
  });

  it('matches snapshot (timestamp masked)', () => {
    expect(maskTimestamp(output)).toMatchSnapshot();
  });

  it('contains H1 "AgentOps observability — overview"', () => {
    expect(output).toMatch(/^# AgentOps observability — overview$/m);
  });

  it('contains header with Generated at and Total flows: 2', () => {
    expect(output).toContain('> Generated at:');
    expect(output).toContain('Total flows: 2');
  });

  it('contains Cross-flow snapshot section with table', () => {
    expect(output).toMatch(/## Cross-flow snapshot/);
    expect(output).toContain('FEAT-FIXTURE-A');
    expect(output).toContain('FEAT-FIXTURE-B');
  });

  it('marks FEAT-FIXTURE-A with ✓ (done status)', () => {
    expect(output).toContain('✓');
  });

  it('marks FEAT-FIXTURE-B with … (running/specify-only status)', () => {
    // Fixture B is specify-only → running marker
    expect(output).toContain('…');
  });

  it('contains Trends section', () => {
    expect(output).toMatch(/## Trends/);
  });

  it('shows trend analysis note when < 2 completed flows', () => {
    // Only 1 completed flow (A done, B specify-only)
    expect(output).toContain('need ≥ 2 completed flows for trend analysis');
  });
});

// ---------------------------------------------------------------------------
// Snapshot: empty (no flows)
// ---------------------------------------------------------------------------

describe('renderIndexReport — empty (no flows)', () => {
  let output: string;

  beforeAll(() => {
    output = renderIndexReport([], [], GENERATED_AT);
  });

  it('matches snapshot (timestamp masked)', () => {
    expect(maskTimestamp(output)).toMatchSnapshot();
  });

  it('shows "(no flows yet)" message', () => {
    expect(output).toContain('(no flows yet)');
  });

  it('contains H1', () => {
    expect(output).toMatch(/^# AgentOps observability — overview$/m);
  });

  it('contains header with Total flows: 0', () => {
    expect(output).toContain('Total flows: 0');
  });
});

// ---------------------------------------------------------------------------
// Snapshot: 3+ flows → trends populated
// ---------------------------------------------------------------------------

describe('renderIndexReport — 3 flows with 2 completed → trends', () => {
  let output: string;

  beforeAll(async () => {
    const a = await sessionAndMetrics(FIXTURE_A);
    // Build a second "done" flow from FIXTURE_A data with different taskId
    const a2metrics: Metrics = {
      ...a.metrics,
      taskId: 'FEAT-FIXTURE-A2',
      featureName: 'Fixture A2',
      compliance: 'standard',
      status: 'done',
      currentPhase: 'done',
      dispatchesPerAc: 0.6,
      taskSuccessRate: {
        ...a.metrics.taskSuccessRate,
        dev: 0.75,
      },
    };
    const b = await sessionAndMetrics(FIXTURE_B);

    const allMetrics = [a, { session: a.session, metrics: a2metrics }, b];
    const trendInsights = computeTrends(allMetrics.map((m) => m.metrics));
    output = renderIndexReport(allMetrics, trendInsights, GENERATED_AT);
  });

  it('matches snapshot (timestamp masked)', () => {
    expect(maskTimestamp(output)).toMatchSnapshot();
  });

  it('contains dispatches_per_ac_trend in Trends section', () => {
    expect(output).toContain('Dispatches/AC');
  });

  it('does NOT show "need ≥ 2 completed flows" when trends exist', () => {
    expect(output).not.toContain('need ≥ 2 completed flows for trend analysis');
  });

  it('contains Total flows: 3', () => {
    expect(output).toContain('Total flows: 3');
  });
});

// ---------------------------------------------------------------------------
// Status symbols (AC-003)
// ---------------------------------------------------------------------------

describe('renderIndexReport — status symbols', () => {
  function makeMinimalMetrics(
    taskId: string,
    status: Metrics['status'],
    phase: Metrics['currentPhase'],
  ): Metrics {
    return {
      taskId,
      featureName: `Feature ${taskId}`,
      compliance: 'standard',
      currentPhase: phase,
      status,
      startedAt: '2026-01-01T00:00:00Z',
      totalDispatches: 0,
      dispatchesByRole: Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>,
      taskSuccessRate: Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<
        Role,
        number | null
      >,
      loopRate: 0,
      escalationRate: 0,
      phaseDurations: {},
      acClosure: { total: 0, pass: 0, partial: 0, fail: 0, missing: 0 },
      reviewerFindings: null,
      dispatchesPerAc: 0,
      tokenCost: { total: null, perAc: null },
      reworkRate: null,
      insights: [],
    };
  }

  it('uses ✓ for done status', () => {
    const m = makeMinimalMetrics('FEAT-DONE', 'done', 'done');
    const out = renderIndexReport([{ session: {} as Session, metrics: m }], [], GENERATED_AT);
    expect(out).toContain('✓');
  });

  it('uses ⚠ for escalated status', () => {
    const m = makeMinimalMetrics('FEAT-ESC', 'escalated', 'escalated');
    const out = renderIndexReport([{ session: {} as Session, metrics: m }], [], GENERATED_AT);
    expect(out).toContain('⚠');
  });

  it('uses ⏸ for paused status', () => {
    const m = makeMinimalMetrics('FEAT-PAUSED', 'paused', 'paused');
    const out = renderIndexReport([{ session: {} as Session, metrics: m }], [], GENERATED_AT);
    expect(out).toContain('⏸');
  });

  it('uses … for running status', () => {
    const m = makeMinimalMetrics('FEAT-RUN', 'running', 'implementation');
    const out = renderIndexReport([{ session: {} as Session, metrics: m }], [], GENERATED_AT);
    expect(out).toContain('…');
  });
});
