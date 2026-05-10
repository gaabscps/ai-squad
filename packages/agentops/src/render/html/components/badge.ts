/**
 * components/badge.ts — Status badge component.
 * Generates colored inline badges for status display in the AgentOps HTML dashboard.
 * XSS-safe: label is always HTML-escaped.
 */

import { escape } from '../shared/escape';

export type BadgeKind = 'pass' | 'warn' | 'fail' | 'neutral';

/**
 * Renders a colored status badge span.
 * @param label - Badge text (will be HTML-escaped)
 * @param kind - Visual style variant
 */
export function badge(label: string, kind: BadgeKind): string {
  return `<span class="badge badge-${kind}">${escape(label)}</span>`;
}

/**
 * Maps batch state + loop count to a badge kind and label.
 *
 * Mapping (DD-2 per spec):
 * - done + loops === 0 → pass / ✓
 * - done + loops > 0  → warn / ⚠
 * - pending_human | failed → fail / ✗
 * - running | pending | anything else → neutral / …
 */
export function statusBadgeFromBatchState(
  state: string,
  loops: number,
): { kind: BadgeKind; label: string } {
  if (state === 'done') {
    return loops === 0 ? { kind: 'pass', label: '✓' } : { kind: 'warn', label: '⚠' };
  }
  if (state === 'pending_human' || state === 'failed') {
    return { kind: 'fail', label: '✗' };
  }
  // running, pending, or any unknown state
  return { kind: 'neutral', label: '…' };
}
