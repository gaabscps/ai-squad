/**
 * Unit tests for state machine v2 — FEAT-005 T-004.
 * Covers: AC-002, AC-003, AC-004.
 */

import { computeBatchState, batchStateToBadge } from '../state';
import type { DispatchLike } from '../state';

// Helper to build DispatchLike objects quickly
function d(
  role: DispatchLike['role'],
  status: DispatchLike['status'],
  opts: { loop?: number | null; startedAt?: string } = {},
): DispatchLike {
  return {
    role,
    status,
    loop: opts.loop ?? null,
    startedAt: opts.startedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

describe('computeBatchState', () => {
  // AC-002 table (a): all done, loops = 0 → done
  it('returns done when all dispatches are done with no loops', () => {
    const dispatches = [
      d('dev', 'done', { loop: null }),
      d('code-reviewer', 'done', { loop: null }),
      d('qa', 'done', { loop: null }),
    ];
    expect(computeBatchState(dispatches)).toBe('done');
  });

  // AC-002 table (b): all done, max loop > 1 → done-retried
  it('returns done-retried when all dispatches done but loop > 1 present', () => {
    const dispatches = [
      d('dev', 'done', { loop: null }),
      d('dev', 'done', { loop: 2 }),
      d('code-reviewer', 'done', { loop: null }),
      d('qa', 'done', { loop: null }),
    ];
    expect(computeBatchState(dispatches)).toBe('done-retried');
  });

  // Current SDD format: loop = 1 is L1 (first attempt), not a retry
  it('returns done (not done-retried) when all dispatches done at loop = 1 only', () => {
    const dispatches = [
      d('dev', 'done', { loop: 1 }),
      d('code-reviewer', 'done', { loop: 1 }),
      d('logic-reviewer', 'done', { loop: 1 }),
      d('qa', 'done', { loop: 1 }),
    ];
    expect(computeBatchState(dispatches)).toBe('done');
  });

  // Current SDD format: loop reaches 2 → retried
  it('returns done-retried when any dispatch reaches loop = 2', () => {
    const dispatches = [
      d('dev', 'done', { loop: 1 }),
      d('code-reviewer', 'done', { loop: 1 }),
      d('dev', 'done', { loop: 2 }),
      d('qa', 'done', { loop: 2 }),
    ];
    expect(computeBatchState(dispatches)).toBe('done-retried');
  });

  // AC-004 — AUDIT-AGENT case: blocked dispatch followed by retry done from same role
  it('returns done-retried when blocked dispatch resolved by same-role retry (AUDIT-AGENT)', () => {
    const dispatches = [
      d('audit-agent', 'blocked', { startedAt: '2026-01-01T00:00:00.000Z', loop: null }),
      d('audit-agent', 'done', { startedAt: '2026-01-01T01:00:00.000Z', loop: 2 }),
    ];
    expect(computeBatchState(dispatches)).toBe('done-retried');
  });

  // AC-003 — needs_review is intermediate, NOT a failure
  it('returns done when needs_review + done qa (needs_review is intermediate)', () => {
    const dispatches = [
      d('dev', 'done', { loop: null }),
      d('code-reviewer', 'needs_review', { loop: null }),
      d('logic-reviewer', 'needs_review', { loop: null }),
      d('qa', 'done', { loop: null }),
    ];
    expect(computeBatchState(dispatches)).toBe('done');
  });

  // AC-002 table (c): escalate present → escalated (takes priority)
  it('returns escalated when any dispatch has escalate status', () => {
    const dispatches = [
      d('dev', 'done', { loop: null }),
      d('blocker-specialist', 'escalate', { loop: null }),
    ];
    expect(computeBatchState(dispatches)).toBe('escalated');
  });

  // AC-002 table (d): blocked unresolved → blocked
  it('returns blocked when blocked dispatch is not resolved by retry', () => {
    const dispatches = [d('dev', 'blocked', { loop: null })];
    expect(computeBatchState(dispatches)).toBe('blocked');
  });

  // AC-002 table (d): blocked + another role not done → blocked (not resolved)
  it('returns blocked when blocked + another role still running (unresolved)', () => {
    const dispatches = [
      d('dev', 'blocked', { startedAt: '2026-01-01T00:00:00.000Z', loop: null }),
      d('qa', 'done', { startedAt: '2026-01-01T01:00:00.000Z', loop: null }),
    ];
    // qa is done, but dev's last dispatch is blocked → not fully resolved
    expect(computeBatchState(dispatches)).toBe('blocked');
  });

  // AC-002 table (e): empty dispatches → running
  it('returns running for empty dispatches', () => {
    expect(computeBatchState([])).toBe('running');
  });

  // AC-002 table (e): only running-like dispatches → running
  it('returns running when only status is partial (no terminal done)', () => {
    // partial is not in DispatchStatus but test with a non-done/non-blocked/non-escalate
    // Only needs_review dispatches → terminal empty → running
    const dispatches = [
      d('dev', 'needs_review', { loop: null }),
      d('code-reviewer', 'needs_review', { loop: null }),
    ];
    expect(computeBatchState(dispatches)).toBe('running');
  });

  // AC-003 regression: needs_review from cr/lr must not block done-retried resolution
  it('returns done-retried when dev blocked+retried-done and cr/lr left needs_review (AC-003)', () => {
    const dispatches = [
      d('dev', 'blocked', { startedAt: '2026-01-01T00:00:00.000Z', loop: 1 }),
      d('dev', 'done', { startedAt: '2026-01-01T01:00:00.000Z', loop: 2 }),
      d('code-reviewer', 'needs_review', { startedAt: '2026-01-01T00:30:00.000Z', loop: null }),
      d('logic-reviewer', 'needs_review', { startedAt: '2026-01-01T00:35:00.000Z', loop: null }),
    ];
    // Before fix: every-done check on all dispatches would fail because cr/lr are needs_review,
    // causing the function to return 'blocked'. After fix: needs_review are excluded from
    // terminalDispatches, lastByRole only sees dev(done), → done-retried.
    expect(computeBatchState(dispatches)).toBe('done-retried');
  });

  // Additional edge: escalate takes priority over blocked
  it('escalated takes priority over blocked', () => {
    const dispatches = [
      d('dev', 'blocked', { loop: null }),
      d('blocker-specialist', 'escalate', { loop: null }),
    ];
    expect(computeBatchState(dispatches)).toBe('escalated');
  });
});

describe('batchStateToBadge', () => {
  it('maps done to pass kind with correct label and ariaLabel', () => {
    const badge = batchStateToBadge('done');
    expect(badge.kind).toBe('pass');
    expect(badge.label).toBe('✓ done');
    expect(badge.ariaLabel).toBe('status: done');
  });

  it('maps done-retried to warn kind', () => {
    const badge = batchStateToBadge('done-retried');
    expect(badge.kind).toBe('warn');
    expect(badge.label).toBe('↻ done (retried)');
    expect(badge.ariaLabel).toBe('status: done with retries');
  });

  it('maps escalated to fail kind', () => {
    const badge = batchStateToBadge('escalated');
    expect(badge.kind).toBe('fail');
    expect(badge.label).toBe('✗ escalated');
    expect(badge.ariaLabel).toBe('status: escalated');
  });

  it('maps blocked to fail kind', () => {
    const badge = batchStateToBadge('blocked');
    expect(badge.kind).toBe('fail');
    expect(badge.label).toBe('⏸ blocked');
    expect(badge.ariaLabel).toBe('status: blocked');
  });

  it('maps running to neutral kind', () => {
    const badge = batchStateToBadge('running');
    expect(badge.kind).toBe('neutral');
    expect(badge.label).toBe('◌ running');
    expect(badge.ariaLabel).toBe('status: running');
  });
});
