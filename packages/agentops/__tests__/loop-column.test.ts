/**
 * Regression test for AC-009 (FEAT-002 T-010):
 * Loop column populated from review_loop field in dispatch manifest.
 *
 * The enrich pipeline reads raw.review_loop (or raw.loop) into Session.dispatches[].loop.
 * The renderer converts loop to a string; null loop renders as "—".
 *
 * Positive case: four dispatches with review_loop 1, 2, 2, 3 → column shows those values.
 * Negative case: dispatch with no review_loop / loop field → column shows "—".
 */

import { renderPerDispatchTable } from '../src/render/flow-report/per-dispatch-table';
import type { Session } from '../src/types';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

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
// Positive case: review_loop values 1, 2, 2, 3 surface in Loop column
// ---------------------------------------------------------------------------

describe('Loop column — positive case (review_loop set)', () => {
  /**
   * Build a Session whose dispatches[] have loop values matching the
   * fixture described in T-010: review_loop 1, 2, 2, 3.
   *
   * In production these values come from enrich/dispatches.ts:146-151:
   *   loop = raw.loop ?? raw.review_loop ?? null
   * Here we supply the already-enriched Session directly (unit scope).
   */
  const session = makeMinimalSession({
    dispatches: [
      {
        dispatchId: 'd-001',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:01:00Z',
        completedAt: '2026-01-01T00:10:00Z',
        outputPacket: null,
        loop: 1,
        pmNote: null,
      },
      {
        dispatchId: 'd-002',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:11:00Z',
        completedAt: '2026-01-01T00:20:00Z',
        outputPacket: null,
        loop: 2,
        pmNote: null,
      },
      {
        dispatchId: 'd-003',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:21:00Z',
        completedAt: '2026-01-01T00:30:00Z',
        outputPacket: null,
        loop: 2,
        pmNote: null,
      },
      {
        dispatchId: 'd-004',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:31:00Z',
        completedAt: '2026-01-01T00:40:00Z',
        outputPacket: null,
        loop: 3,
        pmNote: null,
      },
    ],
  });

  let output: string;

  beforeAll(() => {
    output = renderPerDispatchTable(session);
  });

  it('renders loop value 1 in the table', () => {
    expect(output).toContain('| 1 |');
  });

  it('renders loop value 2 in the table', () => {
    expect(output).toContain('| 2 |');
  });

  it('renders loop value 3 in the table', () => {
    expect(output).toContain('| 3 |');
  });

  it('does not render — for any Loop cell when all loops are set', () => {
    // Each row has exactly: ID | Role | Status | Loop | Tokens | $ | Duration | PM note
    // With all four dispatches having loop values, no Loop cell should be "—".
    // We check by parsing rows. The header + separator are first two lines after ##.
    const lines = output.split('\n').filter((l) => l.startsWith('|'));
    // Skip header (index 0) and separator (index 1); data rows start at index 2
    const dataRows = lines.slice(2);
    expect(dataRows).toHaveLength(4);

    dataRows.forEach((row) => {
      const cells = row.split('|').map((c) => c.trim());
      // cells[0] = '' (before first |), cells[4] = Loop column (0-indexed after split)
      // Table columns: ID(1) Role(2) Status(3) Loop(4) Tokens(5) $(6) Duration(7) PM note(8)
      const loopCell = cells[4];
      expect(loopCell).not.toBe('—');
      expect(['1', '2', '3']).toContain(loopCell);
    });
  });
});

// ---------------------------------------------------------------------------
// Negative case: missing review_loop → Loop column renders as "—"
// ---------------------------------------------------------------------------

describe('Loop column — negative case (no review_loop)', () => {
  const session = makeMinimalSession({
    dispatches: [
      {
        dispatchId: 'd-missing',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:01:00Z',
        completedAt: null,
        outputPacket: null,
        loop: null,
        pmNote: null,
      },
    ],
  });

  let output: string;

  beforeAll(() => {
    output = renderPerDispatchTable(session);
  });

  it('renders — in the Loop cell when loop is null', () => {
    const lines = output.split('\n').filter((l) => l.startsWith('|'));
    const dataRows = lines.slice(2);
    expect(dataRows).toHaveLength(1);

    const cells = dataRows[0].split('|').map((c) => c.trim());
    // Loop is column index 4 (after split on '|', empty string at [0] and [last])
    const loopCell = cells[4];
    expect(loopCell).toBe('—');
  });
});
