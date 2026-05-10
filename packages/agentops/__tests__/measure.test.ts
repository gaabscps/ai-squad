/**
 * Unit tests for measure.ts and its sub-functions.
 * T-010: ≥27 tests total (3+ per sub-function).
 * Sub-functions tested directly via named exports.
 */

import path from 'path';

import { ANTHROPIC_PRICING_2026 } from '../src/constants';
import { enrich } from '../src/enrich';
import {
  measure,
  computeDispatchesByRole,
  computeTaskSuccessRate,
  computeLoopRate,
  computeEscalationRate,
  computeDispatchesPerAc,
  computePhaseDurations,
  computeAcClosureSummary,
  computeReviewerFindings,
  computeTokenCost,
  computeCostUsd,
} from '../src/measure';
import { parse } from '../src/parse';
import type { Session } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');
const FIXTURE_B = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-B');

async function sessionA(): Promise<Session> {
  const raw = await parse(FIXTURE_A);
  return enrich(raw);
}

async function sessionB(): Promise<Session> {
  const raw = await parse(FIXTURE_B);
  return enrich(raw);
}

/** Builds a minimal Session for inline test cases */
function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    phases: [],
    dispatches: [],
    acs: [],
    qaResults: [],
    expectedPipeline: [],
    escalationMetrics: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeDispatchesByRole
// ---------------------------------------------------------------------------

describe('computeDispatchesByRole', () => {
  it('counts dispatches per role for fixture A (4 dispatches, 4 roles)', async () => {
    const session = await sessionA();
    const counts = computeDispatchesByRole(session);
    expect(counts['dev']).toBe(1);
    expect(counts['code-reviewer']).toBe(1);
    expect(counts['qa']).toBe(1);
    expect(counts['audit-agent']).toBe(1);
    expect(counts['logic-reviewer']).toBe(0);
    expect(counts['blocker-specialist']).toBe(0);
  });

  it('returns all roles with 0 when no dispatches', () => {
    const session = makeSession();
    const counts = computeDispatchesByRole(session);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(0);
    expect(Object.keys(counts)).toHaveLength(7);
  });

  it('counts correctly with multiple dispatches of the same role', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'dev-1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
        {
          dispatchId: 'dev-2',
          role: 'dev',
          status: 'needs_review',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: 1,
          pmNote: null,
        },
        {
          dispatchId: 'qa-1',
          role: 'qa',
          status: 'done',
          startedAt: '2026-01-01T02:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
      ],
    });
    const counts = computeDispatchesByRole(session);
    expect(counts['dev']).toBe(2);
    expect(counts['qa']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeTaskSuccessRate
// ---------------------------------------------------------------------------

describe('computeTaskSuccessRate', () => {
  it('returns 1.0 when all dev dispatches are done (fixture A)', async () => {
    const session = await sessionA();
    const rate = computeTaskSuccessRate(session, 'dev');
    expect(rate).toBe(1);
  });

  it('returns null for a role with no dispatches', async () => {
    const session = await sessionA();
    const rate = computeTaskSuccessRate(session, 'logic-reviewer');
    expect(rate).toBeNull();
  });

  it('returns correct fractional rate with mixed statuses', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
        {
          dispatchId: 'd2',
          role: 'dev',
          status: 'needs_review',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: 1,
          pmNote: null,
        },
        {
          dispatchId: 'd3',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T02:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
      ],
    });
    const rate = computeTaskSuccessRate(session, 'dev');
    expect(rate).toBeCloseTo(2 / 3);
  });

  it('returns 0 when none of the dispatches are done', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'qa',
          status: 'blocked',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
      ],
    });
    const rate = computeTaskSuccessRate(session, 'qa');
    expect(rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeLoopRate
// ---------------------------------------------------------------------------

describe('computeLoopRate', () => {
  it('returns 0 for fixture A (no loops)', async () => {
    const session = await sessionA();
    const rate = computeLoopRate(session);
    expect(rate).toBe(0);
  });

  it('returns 0 when there are no dispatches', () => {
    const session = makeSession();
    expect(computeLoopRate(session)).toBe(0);
  });

  it('returns 0.5 when half dispatches have loop > 0', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: 1,
          pmNote: null,
        },
        {
          dispatchId: 'd2',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: 0,
          pmNote: null,
        },
      ],
    });
    expect(computeLoopRate(session)).toBe(0.5);
  });

  it('returns 1 when all dispatches have loop > 0', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: 2,
          pmNote: null,
        },
        {
          dispatchId: 'd2',
          role: 'qa',
          status: 'done',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: 1,
          pmNote: null,
        },
      ],
    });
    expect(computeLoopRate(session)).toBe(1);
  });

  it('ignores dispatches with null loop (treats as no loop)', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
      ],
    });
    expect(computeLoopRate(session)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeEscalationRate
// ---------------------------------------------------------------------------

describe('computeEscalationRate', () => {
  it('returns 0 for fixture A', async () => {
    const session = await sessionA();
    expect(computeEscalationRate(session)).toBe(0);
  });

  it('returns 0 when escalationMetrics is null', () => {
    const session = makeSession({ escalationMetrics: null });
    expect(computeEscalationRate(session)).toBe(0);
  });

  it('returns the escalation rate from escalationMetrics', () => {
    const session = makeSession({
      escalationMetrics: { escalationRate: 0.5 },
    });
    expect(computeEscalationRate(session)).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// computePhaseDurations
// ---------------------------------------------------------------------------

describe('computePhaseDurations', () => {
  it('returns correct minutes for each completed phase (fixture A)', async () => {
    const session = await sessionA();
    const durations = computePhaseDurations(session);
    // specify: 9:00 → 9:15 = 15 min
    expect(durations['specify']).toBe(15);
    // plan: 9:15 → 9:25 = 10 min
    expect(durations['plan']).toBe(10);
    // tasks: 9:25 → 9:30 = 5 min
    expect(durations['tasks']).toBe(5);
    // implementation: 9:30 → 11:30 = 120 min
    expect(durations['implementation']).toBe(120);
  });

  it('returns "not_started" for phases not in session.phases', () => {
    const session = makeSession({ phases: [] });
    const durations = computePhaseDurations(session);
    expect(durations['specify']).toBe('not_started');
    expect(durations['plan']).toBe('not_started');
    expect(durations['tasks']).toBe('not_started');
    expect(durations['implementation']).toBe('not_started');
  });

  it('returns "running" for a phase with startedAt but no completedAt', () => {
    const session = makeSession({
      phases: [
        {
          name: 'implementation',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          status: 'in_progress',
        },
      ],
    });
    const durations = computePhaseDurations(session);
    expect(durations['implementation']).toBe('running');
  });

  it('returns 0 for a phase with identical start and end times', () => {
    const session = makeSession({
      phases: [
        {
          name: 'specify',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:00:00Z',
          status: 'approved',
        },
      ],
    });
    const durations = computePhaseDurations(session);
    expect(durations['specify']).toBe(0);
  });

  it('marks phase as not_started when phase entry has null startedAt', () => {
    const session = makeSession({
      phases: [
        {
          name: 'plan',
          startedAt: null,
          completedAt: null,
          status: 'skipped',
        },
      ],
    });
    const durations = computePhaseDurations(session);
    expect(durations['plan']).toBe('not_started');
  });

  it('ignores phases with names not in the known PhaseName list', () => {
    const session = makeSession({
      phases: [
        {
          name: 'unknown-phase',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T01:00:00Z',
          status: 'done',
        },
        {
          name: 'specify',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:30:00Z',
          status: 'approved',
        },
      ],
    });
    const durations = computePhaseDurations(session);
    // unknown-phase is ignored
    expect(durations['specify']).toBe(30);
    expect(durations['plan']).toBe('not_started');
  });
});

// ---------------------------------------------------------------------------
// computeAcClosureSummary
// ---------------------------------------------------------------------------

describe('computeAcClosureSummary', () => {
  it('returns correct summary for fixture A (5 ACs, all pass)', async () => {
    const session = await sessionA();
    const summary = computeAcClosureSummary(session);
    expect(summary.total).toBe(5);
    expect(summary.pass).toBe(5);
    expect(summary.partial).toBe(0);
    expect(summary.fail).toBe(0);
    expect(summary.missing).toBe(0);
  });

  it('returns all missing when no qaResults', () => {
    const session = makeSession({
      acs: ['AC-001', 'AC-002', 'AC-003'],
      qaResults: [],
    });
    const summary = computeAcClosureSummary(session);
    expect(summary.total).toBe(3);
    expect(summary.missing).toBe(3);
    expect(summary.pass).toBe(0);
  });

  it('returns total=0 and missing=0 when no ACs and no qaResults', () => {
    const session = makeSession({ acs: [], qaResults: [] });
    const summary = computeAcClosureSummary(session);
    expect(summary.total).toBe(0);
    expect(summary.missing).toBe(0);
  });

  it('correctly counts partial and fail statuses', () => {
    const session = makeSession({
      acs: ['AC-001', 'AC-002', 'AC-003', 'AC-004'],
      qaResults: [
        { ac: 'AC-001', status: 'pass' },
        { ac: 'AC-002', status: 'partial' },
        { ac: 'AC-003', status: 'fail' },
      ],
    });
    const summary = computeAcClosureSummary(session);
    expect(summary.total).toBe(4);
    expect(summary.pass).toBe(1);
    expect(summary.partial).toBe(1);
    expect(summary.fail).toBe(1);
    expect(summary.missing).toBe(1); // AC-004 not covered
  });
});

// ---------------------------------------------------------------------------
// computeReviewerFindings
// ---------------------------------------------------------------------------

describe('computeReviewerFindings', () => {
  it('returns findings for fixture A (1 minor from code-reviewer)', async () => {
    const session = await sessionA();
    const findings = computeReviewerFindings(session);
    expect(findings).not.toBeNull();
    expect(findings!.minor).toBe(1);
    expect(findings!.critical).toBe(0);
    expect(findings!.major).toBe(0);
  });

  it('returns null when there are no reviewer dispatches', () => {
    const session = makeSession();
    expect(computeReviewerFindings(session)).toBeNull();
  });

  it('returns null for session B (no dispatches)', async () => {
    const session = await sessionB();
    expect(computeReviewerFindings(session)).toBeNull();
  });

  it('returns zero findings when reviewer has no findings array', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'cr-1',
          role: 'code-reviewer',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: { role: 'code-reviewer', status: 'done' }, // no findings key
          loop: null,
          pmNote: null,
        },
      ],
    });
    const findings = computeReviewerFindings(session);
    expect(findings).not.toBeNull();
    expect(findings!.critical).toBe(0);
    expect(findings!.major).toBe(0);
    expect(findings!.minor).toBe(0);
  });

  it('aggregates findings from multiple reviewer dispatches', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'cr-1',
          role: 'code-reviewer',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: {
            findings: [{ severity: 'critical' }, { severity: 'minor' }],
          },
          loop: null,
          pmNote: null,
        },
        {
          dispatchId: 'lr-1',
          role: 'logic-reviewer',
          status: 'done',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: {
            findings: [{ severity: 'major' }, { severity: 'major' }],
          },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const findings = computeReviewerFindings(session);
    expect(findings!.critical).toBe(1);
    expect(findings!.major).toBe(2);
    expect(findings!.minor).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeDispatchesPerAc
// ---------------------------------------------------------------------------

describe('computeDispatchesPerAc', () => {
  it('returns dispatches/ACs ratio for fixture A (4 dispatches / 5 ACs = 0.8)', async () => {
    const session = await sessionA();
    expect(computeDispatchesPerAc(session)).toBeCloseTo(0.8);
  });

  it('returns 0 when acs=[]', () => {
    const session = makeSession({ acs: [] });
    expect(computeDispatchesPerAc(session)).toBe(0);
  });

  it('returns 0 when dispatches=[] but acs are defined', () => {
    const session = makeSession({ acs: ['AC-001', 'AC-002'] });
    expect(computeDispatchesPerAc(session)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeTokenCost
// ---------------------------------------------------------------------------

describe('computeTokenCost', () => {
  it('sums usage.total_tokens from output packets (fixture A, dev has 1000)', async () => {
    const session = await sessionA();
    const cost = computeTokenCost(session);
    // dev-1 has total_tokens:1000; other packets have no token data
    expect(cost.total).toBe(1000);
    expect(cost.perAc).toBeCloseTo(1000 / 5);
  });

  it('returns {total: null, perAc: null} when no output packets have tokens', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: { status: 'done' }, // no token fields
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBeNull();
    expect(cost.perAc).toBeNull();
  });

  it('returns {total: null, perAc: null} when there are no dispatches', () => {
    const session = makeSession({ acs: ['AC-001'] });
    const cost = computeTokenCost(session);
    expect(cost.total).toBeNull();
    expect(cost.perAc).toBeNull();
  });

  it('sums input_tokens + output_tokens when total_tokens absent', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: {
            usage: { input_tokens: 300, output_tokens: 200 }, // no total_tokens
          },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBe(500);
    expect(cost.perAc).toBe(500);
  });

  it('picks up gen_ai.usage.total_tokens (OTel semconv path)', () => {
    const session = makeSession({
      acs: ['AC-001', 'AC-002'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: {
            gen_ai: { usage: { total_tokens: 800 } },
          },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBe(800);
    expect(cost.perAc).toBe(400);
  });

  it('picks up metadata.tokens (legacy path)', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'qa',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: {
            metadata: { tokens: 250 },
          },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBe(250);
  });

  it('perAc is null when ACs list is empty (avoid division by zero)', () => {
    const session = makeSession({
      acs: [],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: { usage: { total_tokens: 500 } },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBe(500);
    expect(cost.perAc).toBeNull();
  });

  it('skips dispatches with null outputPacket for token extraction', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null, // no output packet
          loop: null,
          pmNote: null,
        },
        {
          dispatchId: 'd2',
          role: 'qa',
          status: 'done',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: { usage: { total_tokens: 400 } },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBe(400);
    expect(cost.perAc).toBe(400);
  });

  it('returns null when only one of input/output tokens present (not both)', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: { usage: { input_tokens: 300 } }, // only input, no output
          loop: null,
          pmNote: null,
        },
      ],
    });
    const cost = computeTokenCost(session);
    expect(cost.total).toBeNull();
    expect(cost.perAc).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeCostUsd (FEAT-003 AC-020..AC-023)
// ---------------------------------------------------------------------------

describe('computeCostUsd', () => {
  /** Helper: dispatch with usage */
  function makeDispatchWithUsage(
    id: string,
    model: 'opus-4-7' | 'sonnet-4-6' | 'haiku-4-5' | 'unknown',
    total_tokens: number,
  ): Session['dispatches'][0] {
    return {
      dispatchId: id,
      role: 'dev',
      status: 'done',
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      outputPacket: null,
      loop: null,
      pmNote: null,
      usage: { total_tokens, tool_uses: 5, duration_ms: 10000, model },
    };
  }

  it('AC-023: returns total_usd=null when no dispatches have usage', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
          // no usage field
        },
      ],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.total_usd).toBeNull();
    expect(result.per_ac_usd).toBeNull();
    expect(result.per_dispatch_avg_usd).toBeNull();
    expect(result.coverage).toEqual({ included: 0, total: 1 });
    expect(result.assumption_note).toContain('no usage data available');
    expect(result.assumption_note).toContain('1 dispatches');
  });

  it('AC-023: returns total_usd=null with correct fallback count when session has zero dispatches', () => {
    const session = makeSession({ acs: ['AC-001'], dispatches: [] });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.total_usd).toBeNull();
    expect(result.coverage).toEqual({ included: 0, total: 0 });
    expect(result.assumption_note).toContain('0 dispatches');
  });

  it('AC-020 + AC-021: computes USD for all sonnet-4-6 dispatches with 70/30 split', () => {
    // sonnet-4-6: input=$3/Mtok, output=$15/Mtok
    // 1,000,000 tokens → 700k input + 300k output
    // cost = (0.7 × 3) + (0.3 × 15) = 2.1 + 4.5 = $6.60
    const session = makeSession({
      acs: ['AC-001', 'AC-002'],
      dispatches: [makeDispatchWithUsage('d1', 'sonnet-4-6', 1_000_000)],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.total_usd).toBeCloseTo(6.6, 5);
    expect(result.per_ac_usd).toBeCloseTo(6.6 / 2, 5);
    expect(result.per_dispatch_avg_usd).toBeCloseTo(6.6, 5);
    expect(result.coverage).toEqual({ included: 1, total: 1 });
    expect(result.assumption_note).toContain('70/30 input/output split assumed');
  });

  it('AC-022: excludes dispatches with model=unknown from cost calculation', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        makeDispatchWithUsage('d1', 'sonnet-4-6', 1_000_000),
        makeDispatchWithUsage('d2', 'unknown', 999_999), // should be excluded
      ],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    // only d1 included: cost = $6.60
    expect(result.total_usd).toBeCloseTo(6.6, 5);
    expect(result.coverage).toEqual({ included: 1, total: 2 });
    expect(result.assumption_note).toContain('1 of 2 dispatches included in cost');
  });

  it('AC-022: all dispatches have unknown model → total_usd=null', () => {
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [
        makeDispatchWithUsage('d1', 'unknown', 500_000),
        makeDispatchWithUsage('d2', 'unknown', 300_000),
      ],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.total_usd).toBeNull();
    expect(result.coverage).toEqual({ included: 0, total: 2 });
    expect(result.assumption_note).toContain('no usage data available');
  });

  it('AC-021: uses haiku-4-5 pricing correctly ($1/$5 per Mtok)', () => {
    // haiku-4-5: input=$1/Mtok, output=$5/Mtok
    // 1,000,000 tokens → 700k input + 300k output
    // cost = (0.7 × 1) + (0.3 × 5) = 0.7 + 1.5 = $2.20
    const session = makeSession({
      acs: ['AC-001'],
      dispatches: [makeDispatchWithUsage('d1', 'haiku-4-5', 1_000_000)],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.total_usd).toBeCloseTo(2.2, 5);
  });

  it('AC-020: per_ac_usd is null when acs list is empty (avoid division by zero)', () => {
    const session = makeSession({
      acs: [],
      dispatches: [makeDispatchWithUsage('d1', 'sonnet-4-6', 100_000)],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.per_ac_usd).toBeNull();
    expect(result.total_usd).not.toBeNull();
  });

  it('sums costs across multiple dispatches with different models', () => {
    // opus-4-7: $5/$25 → 1Mtok = (0.7×5) + (0.3×25) = 3.5 + 7.5 = $11.00
    // haiku-4-5: $1/$5 → 1Mtok = (0.7×1) + (0.3×5) = 0.7 + 1.5 = $2.20
    const session = makeSession({
      acs: ['AC-001', 'AC-002'],
      dispatches: [
        makeDispatchWithUsage('d1', 'opus-4-7', 1_000_000),
        makeDispatchWithUsage('d2', 'haiku-4-5', 1_000_000),
      ],
    });
    const result = computeCostUsd(session, ANTHROPIC_PRICING_2026);
    expect(result.total_usd).toBeCloseTo(13.2, 5);
    expect(result.coverage).toEqual({ included: 2, total: 2 });
    expect(result.per_dispatch_avg_usd).toBeCloseTo(6.6, 5);
  });
});

// ---------------------------------------------------------------------------
// measure (integration: aggregates sub-functions)
// ---------------------------------------------------------------------------

describe('measure', () => {
  it('returns Metrics with correct totalDispatches for fixture A', async () => {
    const session = await sessionA();
    const metrics = measure(session);
    expect(metrics.totalDispatches).toBe(4);
    expect(metrics.taskId).toBe('FEAT-FIXTURE-A');
  });

  it('returns Metrics with empty insights array (populated by insights.ts)', async () => {
    const session = await sessionA();
    const metrics = measure(session);
    expect(metrics.insights).toEqual([]);
  });

  it('returns reworkRate as null (MVP hook)', async () => {
    const session = await sessionA();
    const metrics = measure(session);
    expect(metrics.reworkRate).toBeNull();
  });

  it('returns correct acClosure and tokenCost for fixture A', async () => {
    const session = await sessionA();
    const metrics = measure(session);
    expect(metrics.acClosure.total).toBe(5);
    expect(metrics.acClosure.pass).toBe(5);
    expect(metrics.tokenCost.total).toBe(1000);
  });
});
