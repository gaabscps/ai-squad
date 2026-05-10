/**
 * Stats-strip renderer — FEAT-005 T-007.
 * Renders 6 KPIs in a fixed flex row: time · cost · tasks · ACs · files · pipeline.
 * Covers: AC-005, AC-007.
 */

import { formatDuration, formatCost } from '../format';
import type { BatchData } from '../types';

import { renderPipelineLine } from './pipeline-line';

/**
 * Renders the stats strip with exactly 6 KPIs in fixed order (AC-005):
 *   1. duration  2. cost  3. tasks  4. ACs (N/M or N)  5. files  6. pipeline
 *
 * AC-007: formatDuration/formatCost handle null → '—'.
 * AC-008: CSS handles responsive layout; this function outputs semantic markup only.
 */
export function renderStatsStrip(batch: BatchData): string {
  const acsValue =
    batch.acScope !== null
      ? `${batch.acsCovered.length}/${batch.acScope.length}`
      : `${batch.acsCovered.length}`;

  const stats = [
    stat('time', formatDuration(batch.durationMs)),
    stat('cost', formatCost(batch.costUsd)),
    stat('tasks', String(batch.tasksCovered.length)),
    stat('ACs', acsValue),
    stat('files', String(batch.filesChanged.length)),
  ].join('');

  const pipeline = renderPipelineLine(batch.rolesPipeline);

  return `<div class="story-card__stats">${stats}${pipeline}</div>`;
}

function stat(label: string, value: string): string {
  return (
    `<span class="story-card__stat">` +
    `<span class="story-card__stat-label">${label}</span> ` +
    `<span class="story-card__stat-value">${value}</span>` +
    `</span>`
  );
}
