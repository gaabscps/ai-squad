import type { CostMetric, RepoHealth, Session } from '../../../types';
import { kpiHeader } from '../components/kpi-header';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-001',
    featureName: 'Foundation',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'done',
    startedAt: '2026-01-01T10:00:00Z',
    completedAt: '2026-01-01T15:45:00Z',
    phases: [],
    dispatches: [
      {
        dispatchId: 'feat-001-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T10:00:00Z',
        completedAt: '2026-01-01T11:00:00Z',
        outputPacket: null,
        loop: 0,
        pmNote: null,
      },
    ],
    acs: ['AC-001', 'AC-002', 'AC-003'],
    qaResults: [
      { ac: 'AC-001', status: 'pass' },
      { ac: 'AC-002', status: 'pass' },
      { ac: 'AC-003', status: 'pass' },
    ],
    expectedPipeline: [],
    escalationMetrics: null,
    ...overrides,
  };
}

function makeRepoHealth(): RepoHealth {
  return {
    mutation: { score: 72.5, killed: 145, total: 200 },
    typeCoverage: { percent: 97.8, anyCount: 5 },
    depViolations: { error: 0, warn: 2 },
    measuredAt: '2026-01-01T16:00:00Z',
  };
}

function makeCost(totalUsd: number | null = 2.18): CostMetric {
  return {
    total_usd: totalUsd,
    per_ac_usd: totalUsd !== null ? totalUsd / 3 : null,
    per_dispatch_avg_usd: totalUsd !== null ? totalUsd : null,
    coverage: { included: 1, total: 1 },
    assumption_note: '70/30 split assumed',
  };
}

describe('kpiHeader', () => {
  it('renders header element with kpi-bar class', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('<header class="kpi-bar">');
    expect(result).toContain('</header>');
  });

  it('includes h1 with flow name', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('<h1>');
    expect(result).toContain('Foundation');
  });

  it('includes status badge in h1', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('badge-pass');
    expect(result).toContain('✓');
  });

  it('includes kpis div', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('<div class="kpis">');
  });

  it('shows USD cost when cost is provided', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost(2.18));
    expect(result).toContain('$2.18');
  });

  it('shows — for cost when cost is null', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), null);
    // cost KPI shows —
    expect(result).toContain('—');
  });

  it('shows — for cost when total_usd is null', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost(null));
    expect(result).toContain('—');
  });

  it('shows mutation score when repoHealth provided', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('72.5%');
  });

  it('shows — for mutation when repoHealth is null', () => {
    const result = kpiHeader(makeSession(), null, makeCost());
    expect(result).toContain('—');
  });

  it('shows type coverage when repoHealth provided', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('97.8%');
  });

  it('shows AC passed/total', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    expect(result).toContain('3/3');
  });

  it('shows loop count', () => {
    const session = makeSession();
    const result = kpiHeader(session, makeRepoHealth(), makeCost());
    // loops = dispatches with loop > 0 or retry count
    expect(result).toContain('loop');
  });

  it('escapes flowName to prevent XSS', () => {
    const session = makeSession({ featureName: '<script>alert(1)</script>' });
    const result = kpiHeader(session, makeRepoHealth(), makeCost());
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('shows wall-clock duration', () => {
    const result = kpiHeader(makeSession(), makeRepoHealth(), makeCost());
    // session runs from 10:00 to 15:45 = 5h45m
    expect(result).toMatch(/\d+h|\d+m/);
  });

  it('shows — for type coverage when repoHealth has null typeCoverage', () => {
    const rh: RepoHealth = {
      mutation: { score: 70, killed: 70, total: 100 },
      typeCoverage: null,
      depViolations: null,
      measuredAt: '2026-01-01T00:00:00Z',
    };
    const result = kpiHeader(makeSession(), rh, makeCost());
    expect(result).toContain('—');
  });
});
