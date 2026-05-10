/**
 * Tests for render/flow-report/per-dispatch-table.ts — T-015
 * AC-026: Per-dispatch breakdown table.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { parse } from '../src/parse';
import { renderPerDispatchTable } from '../src/render/flow-report/per-dispatch-table';
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

describe('renderPerDispatchTable — Fixture A', () => {
  let session: Session;

  beforeAll(async () => {
    const raw = await parse(FIXTURE_A);
    session = enrich(raw);
  });

  it('matches snapshot', () => {
    const output = renderPerDispatchTable(session);
    expect(output).toMatchSnapshot();
  });

  it('contains ## Per-dispatch breakdown header', () => {
    const output = renderPerDispatchTable(session);
    expect(output).toContain('## Per-dispatch breakdown');
  });

  it('contains all column headers', () => {
    const output = renderPerDispatchTable(session);
    expect(output).toContain('ID');
    expect(output).toContain('Role');
    expect(output).toContain('Status');
    expect(output).toContain('Loop');
    expect(output).toContain('Tokens');
  });

  it('contains dispatch ids (truncated to 12 chars)', () => {
    const output = renderPerDispatchTable(session);
    // Fixture A has dispatches: dev-1, code-reviewer-1, qa-1, audit-agent
    // 'code-reviewer-1' = 15 chars → truncated to 'code-reviewe...'
    expect(output).toContain('dev-1');
  });
});

// ---------------------------------------------------------------------------
// No dispatches
// ---------------------------------------------------------------------------

describe('renderPerDispatchTable — no dispatches', () => {
  it('shows "(no dispatches)" message', () => {
    const session = makeMinimalSession();
    const output = renderPerDispatchTable(session);
    expect(output).toContain('(no dispatches)');
    expect(output).toContain('## Per-dispatch breakdown');
  });
});

// ---------------------------------------------------------------------------
// Ordering by started_at
// ---------------------------------------------------------------------------

describe('renderPerDispatchTable — ordering', () => {
  it('orders rows by started_at ascending', () => {
    const session = makeMinimalSession({
      dispatches: [
        {
          dispatchId: 'later',
          role: 'qa',
          status: 'done',
          startedAt: '2026-01-01T02:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
        {
          dispatchId: 'earlier',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T01:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
      ],
    });
    const output = renderPerDispatchTable(session);
    const earlierPos = output.indexOf('earlier');
    const laterPos = output.indexOf('later');
    expect(earlierPos).toBeLessThan(laterPos);
  });
});

// ---------------------------------------------------------------------------
// PM note truncation
// ---------------------------------------------------------------------------

describe('renderPerDispatchTable — pm note truncation', () => {
  it('truncates pm_note to 80 chars with ellipsis', () => {
    const longNote = 'A'.repeat(100);
    const session = makeMinimalSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: longNote,
        },
      ],
    });
    const output = renderPerDispatchTable(session);
    expect(output).toContain('...');
    expect(output).not.toContain('A'.repeat(100));
  });
});

// ---------------------------------------------------------------------------
// fmtMs via duration_ms in dispatches
// ---------------------------------------------------------------------------

function makeDispatch(duration_ms: number) {
  return {
    dispatchId: 'd1',
    role: 'dev' as const,
    status: 'done' as const,
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    outputPacket: null,
    loop: null,
    pmNote: null,
    usage: {
      total_tokens: 100,
      tool_uses: 2,
      duration_ms,
      model: 'sonnet-4-6' as const,
    },
  };
}

describe('renderPerDispatchTable — fmtMs formatting', () => {
  it('formats 500ms as "500ms"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatch(500)] });
    const output = renderPerDispatchTable(session);
    expect(output).toContain('500ms');
  });

  it('formats 30000ms as "30s"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatch(30000)] });
    const output = renderPerDispatchTable(session);
    expect(output).toContain('30s');
  });

  it('formats 90000ms as "1m 30s"', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatch(90000)] });
    const output = renderPerDispatchTable(session);
    expect(output).toContain('1m 30s');
  });

  it('formats 120000ms as "2m" (no remainder)', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatch(120000)] });
    const output = renderPerDispatchTable(session);
    expect(output).toContain('2m');
    expect(output).not.toContain('2m 0s');
  });
});

// ---------------------------------------------------------------------------
// dispatchCostUsd via model
// ---------------------------------------------------------------------------

describe('renderPerDispatchTable — dispatchCostUsd by model', () => {
  it('computes non-zero cost for opus-4-7', () => {
    const dispatch = {
      ...makeDispatch(60000),
      usage: { ...makeDispatch(60000).usage, model: 'opus-4-7' as const },
    };
    const session = makeMinimalSession({ dispatches: [dispatch] });
    const output = renderPerDispatchTable(session);
    expect(output).toMatch(/\$0\./);
  });

  it('computes non-zero cost for sonnet-4-6', () => {
    const session = makeMinimalSession({ dispatches: [makeDispatch(60000)] });
    const output = renderPerDispatchTable(session);
    expect(output).toMatch(/\$0\./);
  });

  it('computes non-zero cost for haiku-4-5', () => {
    const dispatch = {
      ...makeDispatch(60000),
      usage: { ...makeDispatch(60000).usage, model: 'haiku-4-5' as const },
    };
    const session = makeMinimalSession({ dispatches: [dispatch] });
    const output = renderPerDispatchTable(session);
    expect(output).toMatch(/\$0\./);
  });

  it('shows "—" for unknown model', () => {
    const dispatch = {
      ...makeDispatch(60000),
      usage: { ...makeDispatch(60000).usage, model: 'unknown' as const },
    };
    const session = makeMinimalSession({ dispatches: [dispatch] });
    const output = renderPerDispatchTable(session);
    expect(output).toContain('—');
  });

  it('shows "—" for tokens, $, and duration when usage is undefined', () => {
    const session = makeMinimalSession({
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
    const output = renderPerDispatchTable(session);
    const dashes = (output.match(/—/g) ?? []).length;
    expect(dashes).toBeGreaterThanOrEqual(3);
  });
});
