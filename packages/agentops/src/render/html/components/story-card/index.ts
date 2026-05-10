/**
 * story-card/index.ts — Composer + public barrel for the story-card module.
 * FEAT-005 T-013.
 *
 * Public surface consumed by flow-report.ts:
 *   import { aggregateBatchesFromSession, storyCard } from './components/story-card';
 *
 * Node resolves './components/story-card' to this file automatically.
 * Re-exports types for back-compat with any consumer that imports from the barrel.
 */

import { escape } from '../../shared/escape';

import { renderCardHeader } from './parts/card-header';
import { renderDrilldowns } from './parts/drilldowns';
import { renderRetryBanner } from './parts/retry-banner';
import { renderStatsStrip } from './parts/stats-strip';
import { renderSummary } from './parts/summary';
import type { BatchData } from './types';

// Public type re-exports (AC-001 back-compat for consumers importing from the barrel)
export type { BatchData, BatchState, BatchDispatchRow } from './types';
export { aggregateBatchesFromSession } from './aggregator';

/**
 * Renders a single batch story card as a self-contained HTML <article>.
 *
 * AC-002 / AC-019: article element with class `story-card story-card--{state}` and
 *   aria-label so screen readers identify each card by batchId.
 * AC-012: retry banner rendered conditionally by renderRetryBanner (empty string when
 *   no retries → no blank element in output).
 */
export function storyCard(batch: BatchData): string {
  const retry = renderRetryBanner(batch.retryEntries);
  return (
    `<article class="story-card story-card--${escape(batch.state)}" aria-label="batch ${escape(batch.batchId)}">` +
    `\n  ${renderCardHeader(batch)}` +
    `\n  ${renderStatsStrip(batch)}` +
    (retry ? `\n  ${retry}` : '') +
    `\n  ${renderSummary(batch.summary)}` +
    `\n  ${renderDrilldowns(batch)}` +
    `\n</article>`
  );
}
