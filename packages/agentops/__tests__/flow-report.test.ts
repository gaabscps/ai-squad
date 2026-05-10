/**
 * Tests for render/flow-report.ts — T-012
 * AC-006..AC-013, AC-024
 * Snapshot tests with Fixture A + Fixture B metrics.
 * Timestamp line is masked via regex before snapshot comparison.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { applyInsightRules } from '../src/insights';
import { measure } from '../src/measure';
import { parse } from '../src/parse';
import { renderFlowReport } from '../src/render/flow-report';
import type { Insight, Metrics, Role } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');
const FIXTURE_B = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-B');

async function metricsForFixture(fixturePath: string): Promise<Metrics> {
  const raw = await parse(fixturePath);
  const session = enrich(raw);
  return measure(session);
}

/** Mask the generated-at line for deterministic snapshots */
function maskTimestamp(md: string): string {
  return md.replace(/^> Generated at: .+$/m, '> Generated at: <MASKED>');
}

const GENERATED_AT = '2026-05-08T12:00:00Z';
const FEATURE_NAME = 'Test feature';
const CURRENT_PHASE = 'implementation';

// ---------------------------------------------------------------------------
// Snapshot: Fixture A (happy path)
// ---------------------------------------------------------------------------

describe('renderFlowReport — Fixture A (happy path)', () => {
  let output: string;

  beforeAll(async () => {
    const metrics = await metricsForFixture(FIXTURE_A);
    const insights = applyInsightRules(metrics);
    output = renderFlowReport(metrics, insights, GENERATED_AT, FEATURE_NAME, CURRENT_PHASE);
  });

  it('matches snapshot (timestamp masked)', () => {
    expect(maskTimestamp(output)).toMatchSnapshot();
  });

  it('contains H1 with task ID', () => {
    expect(output).toMatch(/^# /m);
    expect(output).toContain('FEAT-FIXTURE-A');
  });

  it('contains status block with Generated at line', () => {
    expect(output).toContain('> Generated at:');
    expect(output).toContain(GENERATED_AT);
  });

  it('contains Insights section', () => {
    expect(output).toMatch(/## Insights/);
  });

  it('contains Phase durations section with table', () => {
    expect(output).toMatch(/## Phase durations/);
    expect(output).toContain('specify');
    expect(output).toContain('implementation');
  });

  it('contains Dispatches section with role breakdown', () => {
    expect(output).toMatch(/## Dispatches/);
    expect(output).toContain('dev');
    expect(output).toContain('code-reviewer');
    expect(output).toContain('qa');
  });

  it('contains Task success rate section', () => {
    expect(output).toMatch(/## Task success rate/);
  });

  it('contains Loop rate section', () => {
    expect(output).toMatch(/## Loop rate/);
  });

  it('contains Escalation rate section with Galileo classification', () => {
    expect(output).toMatch(/## Escalation rate/);
    // 0% escalation → below healthy band
    expect(output).toContain('below healthy band');
  });

  it('contains AC closure section', () => {
    expect(output).toMatch(/## AC closure/);
    expect(output).toContain('5'); // 5 ACs total
  });

  it('contains Reviewer findings section (fixture A has code-reviewer)', () => {
    expect(output).toMatch(/## Reviewer findings/);
    expect(output).toContain('minor');
  });

  it('contains Token cost section (fixture A has usage.total_tokens)', () => {
    expect(output).toMatch(/## Token cost/);
    // dev-1.json has usage.total_tokens: 1000
    expect(output).toContain('1000');
  });
});

// ---------------------------------------------------------------------------
// Snapshot: Fixture B (spec-only, no dispatches)
// ---------------------------------------------------------------------------

describe('renderFlowReport — Fixture B (spec-only)', () => {
  let output: string;

  beforeAll(async () => {
    const metrics = await metricsForFixture(FIXTURE_B);
    const insights: Insight[] = []; // no rules match for spec-only
    output = renderFlowReport(metrics, insights, GENERATED_AT, FEATURE_NAME, CURRENT_PHASE);
  });

  it('matches snapshot (timestamp masked)', () => {
    expect(maskTimestamp(output)).toMatchSnapshot();
  });

  it('shows "No insights triggered" when insights empty', () => {
    expect(output).toContain('No insights triggered');
  });

  it('shows n/a for task success rate with no dispatches', () => {
    expect(output).toContain('n/a');
  });

  it('shows token cost fallback message', () => {
    // spec-only has no token data
    expect(output).toContain('Token cost not available');
  });
});

// ---------------------------------------------------------------------------
// Structural: no reviewer findings section when reviewerFindings === null
// ---------------------------------------------------------------------------

describe('renderFlowReport — no reviewer findings', () => {
  it('omits Reviewer findings section when reviewerFindings is null', () => {
    const ALL_ROLES: Role[] = [
      'dev',
      'code-reviewer',
      'logic-reviewer',
      'qa',
      'blocker-specialist',
      'audit-agent',
    ];
    const metrics: Metrics = {
      taskId: 'FEAT-TEST',
      featureName: 'Test',
      compliance: 'standard',
      currentPhase: 'done',
      status: 'done',
      startedAt: '2026-01-01T00:00:00Z',
      totalDispatches: 1,
      dispatchesByRole: Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>,
      taskSuccessRate: Object.fromEntries(ALL_ROLES.map((r) => [r, null])) as Record<
        Role,
        number | null
      >,
      loopRate: 0,
      escalationRate: 0,
      phaseDurations: { specify: 10, plan: 5, tasks: 5, implementation: 30 },
      acClosure: { total: 0, pass: 0, partial: 0, fail: 0, missing: 0 },
      reviewerFindings: null,
      dispatchesPerAc: 0,
      tokenCost: { total: null, perAc: null },
      reworkRate: null,
      insights: [],
    };
    const output = renderFlowReport(metrics, [], GENERATED_AT, 'Test feature', 'done');
    expect(output).not.toMatch(/## Reviewer findings/);
  });
});
