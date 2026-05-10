/**
 * Tests for render/flow-report/cost-breakdown.ts — T-014
 * AC-025: Cost breakdown section (full data, partial data, no data).
 */

import { ANTHROPIC_PRICING_2026 } from '../src/constants';
import { renderCostBreakdown, renderCostBreakdownFull } from '../src/render/flow-report/cost-breakdown';
import type { CostMetric, Metrics, Role } from '../src/types';

const ALL_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
];

function makeMinimalMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test',
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
    ...overrides,
  };
}

function makeCostMetric(overrides: Partial<CostMetric> = {}): CostMetric {
  return {
    total_usd: 6.6,
    per_ac_usd: 3.3,
    per_dispatch_avg_usd: 6.6,
    coverage: { included: 1, total: 2 },
    assumption_note:
      '70/30 input/output split assumed; harness reports only total_tokens; 1 of 2 dispatches included in cost',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// renderCostBreakdown (metrics-only variant)
// ---------------------------------------------------------------------------

describe('renderCostBreakdown — no data', () => {
  it('matches snapshot for no usage data', () => {
    const metrics = makeMinimalMetrics();
    const output = renderCostBreakdown(metrics);
    expect(output).toMatchSnapshot();
  });

  it('contains ## Cost breakdown header', () => {
    const output = renderCostBreakdown(makeMinimalMetrics());
    expect(output).toContain('## Cost breakdown');
  });

  it('shows n/a for all USD fields when no cost', () => {
    const output = renderCostBreakdown(makeMinimalMetrics());
    expect(output).toContain('n/a');
  });
});

describe('renderCostBreakdown — full data', () => {
  it('matches snapshot for full cost data', () => {
    const metrics = makeMinimalMetrics({ cost: makeCostMetric() });
    const output = renderCostBreakdown(metrics);
    expect(output).toMatchSnapshot();
  });

  it('shows USD total formatted to 4 decimal places', () => {
    const metrics = makeMinimalMetrics({ cost: makeCostMetric({ total_usd: 6.6 }) });
    const output = renderCostBreakdown(metrics);
    expect(output).toContain('$6.6000');
  });

  it('shows coverage note', () => {
    const metrics = makeMinimalMetrics({ cost: makeCostMetric() });
    const output = renderCostBreakdown(metrics);
    expect(output).toContain('1 of 2 dispatches included');
  });
});

// ---------------------------------------------------------------------------
// renderCostBreakdownFull (with dispatches)
// ---------------------------------------------------------------------------

describe('renderCostBreakdownFull — full data', () => {
  const dispatches = [
    {
      usage: {
        total_tokens: 1_000_000,
        tool_uses: 15,
        duration_ms: 60_000,
        model: 'sonnet-4-6' as const,
      },
    },
    {
      // no usage (partial)
    },
  ];

  it('matches snapshot for full data with dispatches', () => {
    const pricing = ANTHROPIC_PRICING_2026;
    const cost: CostMetric = {
      total_usd: 6.6,
      per_ac_usd: 3.3,
      per_dispatch_avg_usd: 6.6,
      coverage: { included: 1, total: 2 },
      assumption_note:
        '70/30 input/output split assumed; harness reports only total_tokens; 1 of 2 dispatches included in cost',
    };
    void pricing;
    const metrics = makeMinimalMetrics({ cost });
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).toMatchSnapshot();
  });

  it('shows token totals', () => {
    const metrics = makeMinimalMetrics({
      cost: makeCostMetric({ total_usd: 6.6 }),
    });
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).toContain('1000000');
  });

  it('shows wall-clock duration formatted', () => {
    const metrics = makeMinimalMetrics({
      cost: makeCostMetric({ total_usd: 6.6 }),
    });
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).toContain('1m'); // 60s = 1m
  });

  it('shows tool uses total', () => {
    const metrics = makeMinimalMetrics({
      cost: makeCostMetric({ total_usd: 6.6 }),
    });
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).toContain('15');
  });
});

describe('renderCostBreakdown — cost with null total_usd', () => {
  it('shows coverage line when cost object present but total_usd is null', () => {
    const metrics = makeMinimalMetrics({
      cost: makeCostMetric({ total_usd: null }),
    });
    const output = renderCostBreakdown(metrics);
    expect(output).toContain('Coverage:');
    expect(output).toContain('dispatches included');
  });

  it('shows per_ac_usd as n/a when null', () => {
    const metrics = makeMinimalMetrics({
      cost: makeCostMetric({ per_ac_usd: null }),
    });
    const output = renderCostBreakdown(metrics);
    expect(output).toContain('n/a (no ACs defined)');
  });

  it('shows per_dispatch_avg_usd as n/a when null', () => {
    const metrics = makeMinimalMetrics({
      cost: makeCostMetric({ per_dispatch_avg_usd: null }),
    });
    const output = renderCostBreakdown(metrics);
    expect(output).toContain('n/a');
  });
});

describe('renderCostBreakdownFull — formatMs branches', () => {
  it('formats exactly 60s as "1m" (no remainder)', () => {
    const metrics = makeMinimalMetrics({ cost: makeCostMetric() });
    const dispatches = [
      {
        usage: {
          total_tokens: 100,
          tool_uses: 1,
          duration_ms: 60_000,
          model: 'sonnet-4-6' as const,
        },
      },
    ];
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).toContain('1m');
    expect(output).not.toContain('1m 0s');
  });

  it('formats sub-1000ms duration', () => {
    const metrics = makeMinimalMetrics({ cost: makeCostMetric() });
    const dispatches = [
      {
        usage: {
          total_tokens: 100,
          tool_uses: 1,
          duration_ms: 500,
          model: 'sonnet-4-6' as const,
        },
      },
    ];
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).toContain('500ms');
  });
});

describe('renderCostBreakdownFull — no data', () => {
  it('matches snapshot for no usage data with dispatches (no usage field)', () => {
    const metrics = makeMinimalMetrics();
    const output = renderCostBreakdownFull(metrics, [{}, {}]);
    expect(output).toMatchSnapshot();
  });

  it('shows n/a for all fields when no usage', () => {
    const output = renderCostBreakdownFull(makeMinimalMetrics(), [{}]);
    expect(output).toContain('n/a');
  });
});

// ---------------------------------------------------------------------------
// renderCostBreakdownFull — "By phase" subsection (agentops-cost-tracking-patch)
// ---------------------------------------------------------------------------

describe('renderCostBreakdownFull — by phase subsection', () => {
  const dispatchesWithPhase = [
    {
      usage: {
        total_tokens: 500_000,
        tool_uses: 5,
        duration_ms: 30_000,
        model: 'sonnet-4-6' as const,
        cost_usd: 2.1,
        phase_coverage: 'specify' as const,
      },
    },
    {
      usage: {
        total_tokens: 500_000,
        tool_uses: 10,
        duration_ms: 30_000,
        model: 'sonnet-4-6' as const,
        cost_usd: 4.5,
        phase_coverage: 'implementation' as const,
      },
    },
  ];

  it('renders "### Cost by phase" subsection when phase_coverage data is present', () => {
    const cost: CostMetric = {
      total_usd: 6.6,
      per_ac_usd: 3.3,
      per_dispatch_avg_usd: 3.3,
      coverage: { included: 2, total: 2 },
      assumption_note: 'test note',
    };
    const metrics = makeMinimalMetrics({ cost });
    const output = renderCostBreakdownFull(metrics, dispatchesWithPhase);
    expect(output).toContain('### Cost by phase');
  });

  it('lists all phases present in dispatches in "By phase" section', () => {
    const cost: CostMetric = {
      total_usd: 6.6,
      per_ac_usd: 3.3,
      per_dispatch_avg_usd: 3.3,
      coverage: { included: 2, total: 2 },
      assumption_note: 'test note',
    };
    const metrics = makeMinimalMetrics({ cost });
    const output = renderCostBreakdownFull(metrics, dispatchesWithPhase);
    expect(output).toContain('specify');
    expect(output).toContain('implementation');
  });

  it('matches snapshot for "By phase" section', () => {
    const cost: CostMetric = {
      total_usd: 6.6,
      per_ac_usd: 3.3,
      per_dispatch_avg_usd: 3.3,
      coverage: { included: 2, total: 2 },
      assumption_note: 'test note',
    };
    const metrics = makeMinimalMetrics({ cost });
    const output = renderCostBreakdownFull(metrics, dispatchesWithPhase);
    expect(output).toMatchSnapshot();
  });

  it('handles "mixed" phase_coverage with phase_split', () => {
    const cost: CostMetric = {
      total_usd: 6.6,
      per_ac_usd: 3.3,
      per_dispatch_avg_usd: 3.3,
      coverage: { included: 1, total: 1 },
      assumption_note: 'test note',
    };
    const dispatchesMixed = [
      {
        usage: {
          total_tokens: 500_000,
          tool_uses: 5,
          duration_ms: 30_000,
          model: 'sonnet-4-6' as const,
          cost_usd: 4.0,
          phase_coverage: 'mixed' as const,
          phase_split: { specify: 0.5, implementation: 0.5 },
        },
      },
    ];
    const metrics = makeMinimalMetrics({ cost });
    const output = renderCostBreakdownFull(metrics, dispatchesMixed);
    expect(output).toContain('### Cost by phase');
    expect(output).toContain('specify');
    expect(output).toContain('implementation');
  });

  it('omits "By phase" section when no dispatch has phase_coverage', () => {
    const cost: CostMetric = {
      total_usd: 6.6,
      per_ac_usd: 3.3,
      per_dispatch_avg_usd: 3.3,
      coverage: { included: 1, total: 1 },
      assumption_note: 'test note',
    };
    const dispatches = [
      {
        usage: {
          total_tokens: 1_000_000,
          tool_uses: 15,
          duration_ms: 60_000,
          model: 'sonnet-4-6' as const,
        },
      },
    ];
    const metrics = makeMinimalMetrics({ cost });
    const output = renderCostBreakdownFull(metrics, dispatches);
    expect(output).not.toContain('### Cost by phase');
  });
});
