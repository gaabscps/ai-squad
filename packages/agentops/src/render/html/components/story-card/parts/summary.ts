/**
 * Summary renderer — FEAT-005 T-009.
 * Renders the 2-sentence technical summary below the stats strip.
 * Covers: AC-009.
 */

import { escape } from '../../../shared/escape';

/**
 * Renders the batch summary paragraph.
 *
 * AC-009: summary text already extracted by aggregator (2 first sentences of
 * summary_for_reviewers or pmNote fallback). This renderer only does HTML escaping
 * and applies the --empty modifier class when null.
 */
export function renderSummary(summary: string | null): string {
  if (!summary) {
    return `<p class="story-card__summary story-card__summary--empty">(no summary)</p>`;
  }
  return `<p class="story-card__summary">${escape(summary)}</p>`;
}
