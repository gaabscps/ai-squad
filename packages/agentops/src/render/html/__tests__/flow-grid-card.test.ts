import type { Session } from '../../../types';
import { flowGridCard, summarizeFlow } from '../components/flow-grid-card';
import type { FlowSummary } from '../components/flow-grid-card';

function makeFlowSummary(overrides: Partial<FlowSummary> = {}): FlowSummary {
  return {
    flowId: 'FEAT-001',
    flowName: 'Foundation',
    status: 'done',
    compliance: 'standard',
    startedAt: '2026-01-01T10:00:00Z',
    totalUsd: 2.18,
    acsPassed: 34,
    acsTotal: 34,
    wallClockMs: 5 * 3600 * 1000,
    costSeries: [1.0, 1.5, 2.18],
    mutationSeries: [65.0, 68.5, 72.5],
    loops: 1,
    ...overrides,
  };
}

describe('flowGridCard', () => {
  it('renders anchor element with flow-card class', () => {
    const result = flowGridCard(makeFlowSummary(), []);
    expect(result).toContain('<a class="flow-card"');
  });

  it('links to relative ./FEAT-001.html', () => {
    const result = flowGridCard(makeFlowSummary(), []);
    expect(result).toContain('href="./FEAT-001.html"');
  });

  it('uses relative link (not absolute path)', () => {
    const result = flowGridCard(makeFlowSummary({ flowId: 'FEAT-003' }), []);
    expect(result).toContain('./FEAT-003.html');
    expect(result).not.toContain('/agentops/FEAT');
  });

  it('includes flow name in h3', () => {
    const result = flowGridCard(makeFlowSummary(), []);
    expect(result).toContain('Foundation');
  });

  it('escapes flowName to prevent XSS', () => {
    const result = flowGridCard(makeFlowSummary({ flowName: '<script>alert(1)</script>' }), []);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('shows status badge', () => {
    const result = flowGridCard(makeFlowSummary({ status: 'done', loops: 0 }), []);
    expect(result).toContain('badge-pass');
  });

  it('shows USD cost', () => {
    const result = flowGridCard(makeFlowSummary({ totalUsd: 2.18 }), []);
    expect(result).toContain('$2.18');
  });

  it('shows ACs passed/total', () => {
    const result = flowGridCard(makeFlowSummary({ acsPassed: 34, acsTotal: 34 }), []);
    expect(result).toContain('34/34');
  });

  it('shows — for USD when totalUsd is null', () => {
    const result = flowGridCard(makeFlowSummary({ totalUsd: null }), []);
    expect(result).toContain('—');
  });

  it('does not include sparkline when history is empty', () => {
    const result = flowGridCard(makeFlowSummary(), []);
    expect(result).not.toContain('<svg');
  });

  it('does not include sparkline when history has only 1 entry', () => {
    // With 1 history item, no sparkline should appear
    const history = [makeFlowSummary()];
    const r2 = flowGridCard(makeFlowSummary(), history);
    expect(r2).not.toContain('<svg');
  });

  it('includes sparkline SVG when history has >= 2 entries', () => {
    const history = [makeFlowSummary(), makeFlowSummary({ flowId: 'FEAT-002', totalUsd: 3.0 })];
    const result = flowGridCard(makeFlowSummary({ flowId: 'FEAT-003' }), history);
    expect(result).toContain('<svg');
  });

  it('includes trends div', () => {
    const history = [makeFlowSummary(), makeFlowSummary({ flowId: 'FEAT-002', totalUsd: 3.0 })];
    const result = flowGridCard(makeFlowSummary(), history);
    expect(result).toContain('class="trends"');
  });

  it('shows wall-clock duration', () => {
    const result = flowGridCard(makeFlowSummary({ wallClockMs: 5 * 3600 * 1000 }), []);
    expect(result).toMatch(/5h/);
  });

  it('renders flow-meta div', () => {
    const result = flowGridCard(makeFlowSummary(), []);
    expect(result).toContain('class="flow-meta"');
  });
});

describe('summarizeFlow', () => {
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
      dispatches: [],
      acs: ['AC-001', 'AC-002'],
      qaResults: [
        { ac: 'AC-001', status: 'pass' },
        { ac: 'AC-002', status: 'pass' },
      ],
      expectedPipeline: [],
      escalationMetrics: null,
      ...overrides,
    };
  }

  it('returns FlowSummary with flowId from session.taskId', () => {
    const result = summarizeFlow(makeSession());
    expect(result.flowId).toBe('FEAT-001');
  });

  it('returns flowName from session.featureName', () => {
    const result = summarizeFlow(makeSession());
    expect(result.flowName).toBe('Foundation');
  });

  it('returns status from session.status', () => {
    const result = summarizeFlow(makeSession());
    expect(result.status).toBe('done');
  });

  it('computes acsPassed correctly', () => {
    const result = summarizeFlow(makeSession());
    expect(result.acsPassed).toBe(2);
  });

  it('computes acsTotal correctly', () => {
    const result = summarizeFlow(makeSession());
    expect(result.acsTotal).toBe(2);
  });

  it('computes wallClockMs from startedAt and completedAt', () => {
    const result = summarizeFlow(makeSession());
    expect(result.wallClockMs).toBeGreaterThan(0);
  });

  it('returns null totalUsd when no cost available', () => {
    const result = summarizeFlow(makeSession());
    expect(result.totalUsd).toBeNull();
  });
});
