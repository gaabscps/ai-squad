/**
 * Unit tests for aggregateBatchesFromSession — summary fallback chain + XSS pass-through.
 * Covers: AC-009 (summary), firstNSentences fallback truncation, XSS regression.
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
// Tests: XSS pass-through (aggregator does NOT escape — renderer's job)
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — XSS regression', () => {
  it('passes pmNote with <script> tag as literal (no escaping in aggregator)', () => {
    const xssNote = '<script>alert(1)</script> malicious payload';
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        pmNote: xssNote,
        outputPacket: null,
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.pmNote).toBe(xssNote);
    expect(result[0]?.pmNote).toContain('<script>');
  });

  it('passes summary_for_reviewers with HTML tags as literal', () => {
    const xssSummary = 'First <b>bold</b> sentence. Second <script>bad()</script> one.';
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        outputPacket: { summary_for_reviewers: xssSummary },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.summary).toContain('<b>bold</b>');
  });
});

// ---------------------------------------------------------------------------
// Tests: summary fallback chain (AC-009)
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — summary fallback chain (AC-009)', () => {
  it('falls back to pmNote 2 sentences when dev has no summary_for_reviewers', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        pmNote: 'First pm sentence. Second pm sentence. Third ignored.',
        outputPacket: { tasks_covered: [] }, // no summary_for_reviewers
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.summary).toBe('First pm sentence. Second pm sentence.');
  });

  it('returns null summary when neither summary_for_reviewers nor pmNote exist', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        outputPacket: null,
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.summary).toBeNull();
  });

  it('extracts exactly 2 sentences from summary_for_reviewers', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        outputPacket: {
          summary_for_reviewers: 'Sentence one. Sentence two. Sentence three should be ignored.',
        },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.summary).toBe('Sentence one. Sentence two.');
  });

  it('falls back to truncated text at 120 chars when no sentence terminator in summary', () => {
    // A summary with no punctuation terminators and more than 120 chars
    const longText = 'A'.repeat(130); // 130 chars, no terminator
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        outputPacket: { summary_for_reviewers: longText },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    // Should truncate to 119 chars + ellipsis
    expect(result[0]?.summary).toBe('A'.repeat(119) + '…');
  });

  it('returns full text when no sentence terminator and text <= 120 chars', () => {
    const shortText = 'A short summary without terminator';
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        outputPacket: { summary_for_reviewers: shortText },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.summary).toBe(shortText);
  });

  it('prefers dev summary over pmNote fallback when both present', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T00:00:00.000Z',
        pmNote: 'This is the PM note. It should NOT appear in summary.',
        outputPacket: {
          summary_for_reviewers: 'Dev summary first sentence. Dev summary second sentence.',
        },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    expect(result[0]?.summary).toBe('Dev summary first sentence. Dev summary second sentence.');
  });

  it('uses lowest-loop dev dispatch for summary when multiple dev dispatches exist', () => {
    const session = makeSession([
      {
        dispatchId: 'feat-001-batch-a-dev-loop2',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T09:00:00.000Z',
        loop: 2,
        outputPacket: {
          summary_for_reviewers: 'Loop2 first sentence. Loop2 second sentence.',
        },
      },
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T08:00:00.000Z',
        loop: null,
        outputPacket: {
          summary_for_reviewers: 'Original first sentence. Original second sentence.',
        },
      },
    ]);

    const result = aggregateBatchesFromSession(session);
    // loop: null (treated as 0) is lower than loop: 2, so original wins
    expect(result[0]?.summary).toBe('Original first sentence. Original second sentence.');
  });
});
