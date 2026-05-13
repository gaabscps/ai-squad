/**
 * Story-card state machine v2 — FEAT-005 T-004.
 * Computes BatchState from dispatches and maps it to a badge.
 * Covers: AC-002, AC-003, AC-004.
 */

import type { Role, DispatchStatus } from '../../../../types';

import type { BatchState } from './types';

export interface DispatchLike {
  role: Role;
  status: DispatchStatus;
  loop: number | null;
  startedAt: string;
}

/**
 * Computes batch state from its dispatches.
 *
 * Decision table (AC-002):
 *   - escalate present                     → 'escalated'
 *   - blocked present AND all-last-by-role done → 'done-retried'  (AC-004 AUDIT-AGENT case)
 *   - blocked present (unresolved)         → 'blocked'
 *   - needs_review filtered out (AC-003), all terminal done, max loop > 1 → 'done-retried'
 *   - all terminal done, max loop <= 1     → 'done'
 *   - otherwise                            → 'running'
 *
 * Retry threshold: loop = 1 is the first attempt (current SDD orchestrator
 * format: `d-T-NNN-role-l1`). Legacy fixtures use loop = null for L1 and
 * loop = N (N >= 2) for retries. Both agree that "retried" means max loop > 1.
 */
export function computeBatchState(dispatches: DispatchLike[]): BatchState {
  if (dispatches.length === 0) return 'running';

  if (dispatches.some((d) => d.status === 'escalate')) return 'escalated';

  if (dispatches.some((d) => d.status === 'blocked')) {
    // Resolved-by-retry: a blocked dispatch followed by a retry done from same role
    // This is the AUDIT-AGENT case in FEAT-001.
    // AC-003: needs_review is intermediate — exclude before checking terminal resolution.
    const terminalDispatches = dispatches.filter((d) => d.status !== 'needs_review');
    const lastByRole = lastDispatchByRole(terminalDispatches);
    if (
      Object.values(lastByRole).length > 0 &&
      Object.values(lastByRole).every((d) => d.status === 'done')
    ) {
      return 'done-retried';
    }
    return 'blocked';
  }

  // needs_review is intermediate (cr/lr before qa); skip from terminal-state aggregation (AC-003)
  const terminal = dispatches.filter((d) => d.status !== 'needs_review');
  if (terminal.length === 0) return 'running';

  if (terminal.every((d) => d.status === 'done')) {
    const loops = Math.max(0, ...dispatches.map((d) => d.loop ?? 0));
    return loops > 1 ? 'done-retried' : 'done';
  }

  return 'running';
}

export interface BadgeMapping {
  kind: 'pass' | 'warn' | 'fail' | 'neutral';
  label: string;
  ariaLabel: string;
}

/** Maps BatchState to badge display data (AC-002). */
export function batchStateToBadge(state: BatchState): BadgeMapping {
  switch (state) {
    case 'done':
      return { kind: 'pass', label: '✓ done', ariaLabel: 'status: done' };
    case 'done-retried':
      return { kind: 'warn', label: '↻ done (retried)', ariaLabel: 'status: done with retries' };
    case 'escalated':
      return { kind: 'fail', label: '✗ escalated', ariaLabel: 'status: escalated' };
    case 'blocked':
      return { kind: 'fail', label: '⏸ blocked', ariaLabel: 'status: blocked' };
    case 'running':
      return { kind: 'neutral', label: '◌ running', ariaLabel: 'status: running' };
  }
}

/** Returns the last dispatch per role, sorted chronologically by startedAt. */
function lastDispatchByRole(dispatches: DispatchLike[]): Record<string, DispatchLike> {
  const sorted = [...dispatches].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const byRole: Record<string, DispatchLike> = {};
  for (const d of sorted) byRole[d.role] = d;
  return byRole;
}
