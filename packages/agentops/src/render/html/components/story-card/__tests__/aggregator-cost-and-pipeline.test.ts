/**
 * Unit tests for aggregateBatchesFromSession — cost USD, pipeline order, XSS, AC-015 dedup.
 * Covers: AC-007 (cost), AC-015 (dedup), sort order, XSS pass-through.
 *
 * Split from aggregator.test.ts (BLOCKER-2 fix: 479L → 3 files ≤ 250L each).
 */

import type { Session } from '../../../../../types';
import { aggregateBatchesFromSession } from '../aggregator';

// ---------------------------------------------------------------------------
// Minimal Session factory helpers
// ---------------------------------------------------------------------------

type DispatchInput = Partial<Session['dispatches'][0]> & {
  dispatchId: string;
  role: Session['dispatches'][0]['role'];
  status: Session['dispatches'][0]['status'];
  startedAt: string;
};

function makeSession(
  dispatches: DispatchInput[],
  pipeline: Session['expectedPipeline'] = [],
): Session {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test Feature',
    currentPhase: 'implementation',
    status: 'running',
    startedAt: dispatches[0]?.startedAt ?? '2026-01-01T00:00:00.000Z',
    completedAt: null,
    phases: [],
    dispatches: dispatches.map((d) => ({
      dispatchId: d.dispatchId,
      role: d.role,
      status: d.status,
      startedAt: d.startedAt,
      completedAt: d.completedAt ?? null,
      outputPacket: d.outputPacket ?? null,
      loop: d.loop ?? null,
      pmNote: d.pmNote ?? null,
      usage: d.usage,
    })),
    acs: [],
    qaResults: [],
    expectedPipeline: pipeline,
    escalationMetrics: null,
  };
}

// ---------------------------------------------------------------------------
// Tests: title fallback (AC-001) — moved from aggregator-core to stay within 250L
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — title fallback to batchId (AC-001)', () => {
  it('uses batchId as title when expectedPipeline has no entry for that batchId', () => {
    const session = makeSession(
      [
        {
          dispatchId: 'feat-001-batch-c-dev',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00.000Z',
          outputPacket: null,
        },
      ],
      [{ batchId: 'BATCH-A', title: 'Setup', requiredRoles: ['dev'] }],
    );

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.title).toBe('BATCH-C');
    expect(result[0]?.batchId).toBe('BATCH-C');
  });

  it('uses batchId as title when expectedPipeline entry has no title field', () => {
    const session = makeSession(
      [
        {
          dispatchId: 'feat-001-batch-b-dev',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00.000Z',
          outputPacket: null,
        },
      ],
      [{ batchId: 'BATCH-B', requiredRoles: ['dev'] }],
    );

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.title).toBe('BATCH-B');
  });
});

// ---------------------------------------------------------------------------
// Tests: cost USD (AC-007)
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — cost USD (AC-007)', () => {
  it('sums cost_usd from dispatches that have it', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T08:00:00.000Z',
        outputPacket: null,
        usage: {
          total_tokens: 1000,
          tool_uses: 5,
          duration_ms: 60000,
          model: 'sonnet-4-6',
          cost_usd: 0.05,
        },
      },
      {
        dispatchId: 'feat-001-batch-a-qa',
        role: 'qa',
        status: 'done',
        startedAt: '2026-01-01T09:00:00.000Z',
        outputPacket: null,
        usage: {
          total_tokens: 500,
          tool_uses: 2,
          duration_ms: 30000,
          model: 'sonnet-4-6',
          cost_usd: 0.02,
        },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.costUsd).toBeCloseTo(0.07, 5);
  });

  it('returns null costUsd when no dispatch has cost_usd', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T08:00:00.000Z',
        outputPacket: null,
        usage: { total_tokens: 1000, tool_uses: 5, duration_ms: 60000, model: 'sonnet-4-6' },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.costUsd).toBeNull();
  });

  it('returns null costUsd when no usage field at all', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T08:00:00.000Z',
        outputPacket: null,
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.costUsd).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: multiple batches sorted by startedAt
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — multiple batches sorted by startedAt', () => {
  it('returns batches in chronological order', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-b-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-02T00:00:00.000Z',
      },
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.batchId).toBe('BATCH-A');
    expect(result[1]?.batchId).toBe('BATCH-B');
  });
});

// XSS pass-through tests moved to aggregator-summary-and-retry.test.ts

// ---------------------------------------------------------------------------
// Tests: AC-015 dedup acsCovered (last-wins)
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — AC-015 dedup acsCovered (last-wins)', () => {
  it('last ac_evidence wins when same AC appears in multiple dispatches', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T08:00:00.000Z',
        outputPacket: {
          ac_evidence: { 'AC-001': 'initial evidence from loop 1' },
        },
      },
      {
        dispatchId: 'feat-001-batch-a-dev-loop2',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T09:00:00.000Z',
        loop: 2,
        outputPacket: {
          ac_evidence: { 'AC-001': 'updated evidence from loop 2' },
        },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    const ac001 = result[0]?.acsCovered.find((a) => a.id === 'AC-001');
    expect(ac001?.evidence).toBe('updated evidence from loop 2');
  });
});
