/**
 * Retry-banner renderer — FEAT-005 T-010.
 * Renders an <aside> warn banner when batch has retry entries.
 * Covers: AC-010, AC-011, AC-012.
 */

import { escape } from '../../../shared/escape';
import type { BatchData } from '../types';

type RetryEntry = BatchData['retryEntries'][0];

/**
 * Renders the retry banner if retryEntries is non-empty.
 *
 * AC-012: returns '' when no retries — no empty element rendered.
 * AC-010: one aside per role (grouped); ⚠ prefix, warn styling via CSS class.
 * AC-011: reason comes from pmNote of specific loop dispatch; escape() applied.
 */
export function renderRetryBanner(retryEntries: BatchData['retryEntries']): string {
  if (retryEntries.length === 0) return '';

  // Group by role (AC-010: one aside per role)
  const byRole = new Map<string, RetryEntry[]>();
  for (const entry of retryEntries) {
    if (!byRole.has(entry.role)) byRole.set(entry.role, []);
    byRole.get(entry.role)!.push(entry);
  }

  const asides: string[] = [];
  for (const [role, entries] of byRole) {
    const count = entries.length;
    const loopParts = entries
      .sort((a, b) => a.loop - b.loop)
      .map((e) => `loop ${e.loop}: ${escape(e.reason)}`)
      .join('; ');
    asides.push(
      `<aside class="story-card__retry" role="status">` +
        `⚠ ${escape(role)} retried ${count}× — ${loopParts}` +
        `</aside>`,
    );
  }

  return asides.join('');
}
