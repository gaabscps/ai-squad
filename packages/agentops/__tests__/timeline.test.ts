/**
 * Tests for render/flow-report/timeline.ts — T-018
 * AC-029: Timeline section with ASCII bar chart.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { parse } from '../src/parse';
import { renderTimeline } from '../src/render/flow-report/timeline';
import type { Session } from '../src/types';

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');

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

// ---------------------------------------------------------------------------
// Snapshot: Fixture A
// ---------------------------------------------------------------------------

describe('renderTimeline — Fixture A', () => {
  let session: Session;

  beforeAll(async () => {
    const raw = await parse(FIXTURE_A);
    session = enrich(raw);
  });

  it('matches snapshot', () => {
    const output = renderTimeline(session);
    expect(output).toMatchSnapshot();
  });

  it('contains ## Timeline header', () => {
    const output = renderTimeline(session);
    expect(output).toContain('## Timeline');
  });

  it('contains column headers', () => {
    const output = renderTimeline(session);
    expect(output).toContain('Phase');
    expect(output).toContain('Started');
    expect(output).toContain('Duration');
    expect(output).toContain('Visual');
  });

  it('contains ASCII bar characters', () => {
    const output = renderTimeline(session);
    expect(output).toMatch(/[█░]/);
  });
});

// ---------------------------------------------------------------------------
// No phases
// ---------------------------------------------------------------------------

describe('renderTimeline — no phases', () => {
  it('shows "(no phase data available)" message', () => {
    const session = makeMinimalSession();
    const output = renderTimeline(session);
    expect(output).toContain('(no phase data available)');
  });

  it('contains ## Timeline header', () => {
    const output = renderTimeline(makeMinimalSession());
    expect(output).toContain('## Timeline');
  });

  it('shows "(no phase data available)" when all phases have null startedAt', () => {
    const session = makeMinimalSession({
      phases: [{ name: 'specify', startedAt: null, completedAt: null, status: 'not_started' }],
    });
    const output = renderTimeline(session);
    expect(output).toContain('(no phase data available)');
  });
});

// ---------------------------------------------------------------------------
// Phase ordering
// ---------------------------------------------------------------------------

describe('renderTimeline — ordering', () => {
  it('orders phases by started_at ascending', () => {
    const session = makeMinimalSession({
      phases: [
        {
          name: 'implementation',
          startedAt: '2026-01-01T02:00:00Z',
          completedAt: '2026-01-01T04:00:00Z',
          status: 'done',
        },
        {
          name: 'specify',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T01:00:00Z',
          status: 'done',
        },
      ],
    });
    const output = renderTimeline(session);
    const specifyPos = output.indexOf('specify');
    const implPos = output.indexOf('implementation');
    expect(specifyPos).toBeLessThan(implPos);
  });

  it('handles running phase (no completedAt)', () => {
    const session = makeMinimalSession({
      phases: [
        {
          name: 'implementation',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          status: 'in_progress',
        },
      ],
    });
    const output = renderTimeline(session);
    expect(output).toContain('running');
  });
});

// ---------------------------------------------------------------------------
// ASCII bar chart
// ---------------------------------------------------------------------------

describe('renderTimeline — ASCII bar', () => {
  it('longest phase gets full bar (all █)', () => {
    const session = makeMinimalSession({
      phases: [
        {
          name: 'specify',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T10:00:00Z', // 10 hours = longest
          status: 'done',
        },
        {
          name: 'plan',
          startedAt: '2026-01-01T10:00:00Z',
          completedAt: '2026-01-01T10:30:00Z', // 30 min
          status: 'done',
        },
      ],
    });
    const output = renderTimeline(session);
    // Longest phase (specify) should have full bar
    expect(output).toContain('██████████');
  });
});
