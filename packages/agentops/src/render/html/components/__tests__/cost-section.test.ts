/**
 * Tests for render/html/components/cost-section.ts
 */

import type { CostMetric, Session } from '../../../../types';
import { costSection } from '../cost-section';

function makeMinimalSession(overrides: Partial<Session> = {}): Session {
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

const makeCost = (overrides: Partial<CostMetric> = {}): CostMetric => ({
  total_usd: 0.05,
  per_ac_usd: 0.025,
  per_dispatch_avg_usd: 0.05,
  coverage: { included: 1, total: 1 },
  assumption_note: '',
  ...overrides,
});

const dispatchWithUsage = {
  dispatchId: 'd1',
  role: 'dev' as const,
  status: 'done' as const,
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: '2026-01-01T01:00:00Z',
  outputPacket: null,
  loop: null,
  pmNote: null,
  usage: {
    total_tokens: 1000,
    tool_uses: 5,
    duration_ms: 120000,
    model: 'sonnet-4-6' as const,
  },
};

// ---------------------------------------------------------------------------
// Basic rendering
// ---------------------------------------------------------------------------

describe('costSection — empty session with cost=null', () => {
  it('contains section element and "No usage data" message', () => {
    const session = makeMinimalSession();
    const output = costSection(session, null);
    expect(output).toContain('<section class="cost-section">');
    expect(output).toContain('No usage data');
  });
});

describe('costSection — session with usage and cost', () => {
  it('renders cost section with USD values', () => {
    const session = makeMinimalSession({ dispatches: [dispatchWithUsage] });
    const cost = makeCost();
    const output = costSection(session, cost);
    expect(output).toContain('<section class="cost-section">');
    expect(output).toContain('Cost');
    expect(output).toContain('$0.05');
  });
});

// ---------------------------------------------------------------------------
// fmtMs branches
// ---------------------------------------------------------------------------

describe('costSection — fmtMs branches via dispatch duration_ms', () => {
  function makeDispatchWithDuration(duration_ms: number) {
    return {
      ...dispatchWithUsage,
      usage: { ...dispatchWithUsage.usage, duration_ms },
    };
  }

  it('formats < 1000ms as "${ms}ms"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatchWithDuration(500)] });
    const output = costSection(session, null);
    expect(output).toContain('500ms');
  });

  it('formats 1000-59999ms as "${s}s"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatchWithDuration(30000)] });
    const output = costSection(session, null);
    expect(output).toContain('30s');
  });

  it('formats 60000-3599999ms with remainder as "${m}m ${rem}s"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatchWithDuration(90000)] });
    const output = costSection(session, null);
    expect(output).toContain('1m 30s');
  });

  it('formats exactly 60000ms as "1m" (no remainder)', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatchWithDuration(60000)] });
    const output = costSection(session, null);
    expect(output).toContain('1m');
    expect(output).not.toContain('1m 0s');
  });

  it('formats exactly 3600000ms as "1h"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatchWithDuration(3600000)] });
    const output = costSection(session, null);
    expect(output).toContain('1h');
  });

  it('formats 5400000ms as "1h30m"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatchWithDuration(5400000)] });
    const output = costSection(session, null);
    expect(output).toContain('1h30m');
  });
});

// ---------------------------------------------------------------------------
// coverageKind badges
// ---------------------------------------------------------------------------

describe('costSection — coverageKind badges', () => {
  it('shows badge-pass when coverage >= 90%', () => {
    const session = makeMinimalSession({ dispatches: [dispatchWithUsage] });
    const cost = makeCost({ coverage: { included: 9, total: 10 } });
    const output = costSection(session, cost);
    expect(output).toContain('badge-pass');
  });

  it('shows badge-warn when coverage is 60-89%', () => {
    const session = makeMinimalSession({ dispatches: [dispatchWithUsage] });
    const cost = makeCost({ coverage: { included: 7, total: 10 } });
    const output = costSection(session, cost);
    expect(output).toContain('badge-warn');
  });

  it('shows badge-fail when coverage < 60%', () => {
    const session = makeMinimalSession({ dispatches: [dispatchWithUsage] });
    const cost = makeCost({ coverage: { included: 5, total: 10 } });
    const output = costSection(session, cost);
    expect(output).toContain('badge-fail');
  });
});

// ---------------------------------------------------------------------------
// modelBreakdownTable with empty byModel
// ---------------------------------------------------------------------------

describe('costSection — modelBreakdownTable with no usage', () => {
  it('does not break and renders cost-section without model table', () => {
    const session = makeMinimalSession();
    const cost = makeCost({ coverage: { included: 0, total: 0 } });
    const output = costSection(session, cost);
    expect(output).toContain('<section class="cost-section">');
    expect(output).not.toContain('cost-models');
  });
});

// ---------------------------------------------------------------------------
// groupBreakdownTable with empty groups
// ---------------------------------------------------------------------------

describe('costSection — groupBreakdownTable with empty groups', () => {
  it('does not include details element when no groups', () => {
    const session = makeMinimalSession();
    const cost = makeCost({ coverage: { included: 0, total: 0 } });
    const output = costSection(session, cost);
    expect(output).not.toContain('<details');
  });
});

// ---------------------------------------------------------------------------
// pricingFor each model
// ---------------------------------------------------------------------------

describe('costSection — pricingFor each model', () => {
  function makeSessionWithModel(model: 'opus-4-7' | 'sonnet-4-6' | 'haiku-4-5') {
    return makeMinimalSession({
      dispatches: [
        {
          ...dispatchWithUsage,
          usage: { ...dispatchWithUsage.usage, model, total_tokens: 10000 },
        },
      ],
    });
  }

  it('calculates non-zero USD for opus-4-7', () => {
    const session = makeSessionWithModel('opus-4-7');
    const output = costSection(session, null);
    expect(output).toMatch(/\$0\.\d+/);
  });

  it('calculates non-zero USD for sonnet-4-6', () => {
    const session = makeSessionWithModel('sonnet-4-6');
    const output = costSection(session, null);
    expect(output).toMatch(/\$0\.\d+/);
  });

  it('calculates non-zero USD for haiku-4-5', () => {
    const session = makeSessionWithModel('haiku-4-5');
    const output = costSection(session, null);
    expect(output).toMatch(/\$0\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// Zero tokens
// ---------------------------------------------------------------------------

describe('costSection — zero tokens', () => {
  it('shows "—" for tokens and wall-clock when total_tokens is 0', () => {
    const session = makeMinimalSession({
      dispatches: [
        {
          ...dispatchWithUsage,
          usage: { ...dispatchWithUsage.usage, total_tokens: 0, duration_ms: 0, tool_uses: 0 },
        },
      ],
    });
    const output = costSection(session, null);
    expect(output).toContain('—');
  });
});

// ---------------------------------------------------------------------------
// assumption_note
// ---------------------------------------------------------------------------

describe('costSection — assumption_note', () => {
  it('renders assumption_note when present', () => {
    const session = makeMinimalSession({ dispatches: [dispatchWithUsage] });
    const cost = makeCost({ assumption_note: 'Estimated from proxy data' });
    const output = costSection(session, cost);
    expect(output).toContain('Estimated from proxy data');
  });

  it('does not render note element when assumption_note is empty', () => {
    const session = makeMinimalSession({ dispatches: [dispatchWithUsage] });
    const cost = makeCost({ assumption_note: '' });
    const output = costSection(session, cost);
    expect(output).not.toContain('cost-note');
  });
});
