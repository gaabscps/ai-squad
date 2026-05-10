/**
 * Story-card header renderer — FEAT-005 T-006.
 * Produces <header><h3>...</h3>{badge}</header>.
 * Covers: AC-001, AC-002, AC-019.
 */

import { escape } from '../../../shared/escape';
import { batchStateToBadge } from '../state';
import type { BatchData } from '../types';

/**
 * Renders the card header with batch title + status badge.
 *
 * AC-001 duplication guard: when batch.title === batch.batchId (case-insensitive
 * ASCII compare) only the batchId is rendered — the title span with dot separator
 * is omitted to prevent "BATCH-A · BATCH-A" duplication.
 *
 * AC-019: produces <header> element meant to live inside <article> (added by index.ts).
 */
export function renderCardHeader(batch: BatchData): string {
  const badge = renderBadge(batch);
  const h3 = renderH3(batch);
  return `<header>${h3}${badge}</header>`;
}

function renderH3(batch: BatchData): string {
  // AC-001: case-insensitive compare to detect fallback (title === batchId)
  const isDuplicate = batch.title.toLowerCase() === batch.batchId.toLowerCase();
  if (isDuplicate) {
    return `<h3>${escape(batch.batchId)}</h3>`;
  }
  return `<h3>${escape(batch.batchId)}<span class="dot">·</span>${escape(batch.title)}</h3>`;
}

function renderBadge(batch: BatchData): string {
  const { kind, label, ariaLabel } = batchStateToBadge(batch.state);
  // AC-019: aria-label in format "status: <text>"
  return `<span class="badge badge-${kind}" aria-label="${escape(ariaLabel)}">${escape(label)}</span>`;
}
