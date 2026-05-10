/**
 * Drilldowns renderer — FEAT-005 T-011.
 * Renders 4 <details> sections in fixed order: Files / ACs / Pipeline / PM note.
 * Covers: AC-013, AC-014, AC-015, AC-016, AC-017, AC-018.
 */

import { escape } from '../../../shared/escape';
import { formatDuration, truncate } from '../format';
import type { BatchData } from '../types';

const PATH_MAX = 60;
const EVIDENCE_MAX = 160;
const DISPATCH_ID_MAX = 24;

/**
 * Renders the 4 drilldown <details> elements (AC-013).
 * AC-018: pure HTML5 <details>/<summary> — zero JS required.
 */
export function renderDrilldowns(batch: BatchData): string {
  return (
    `<div class="story-card__drilldowns">` +
    renderFilesChanged(batch) +
    renderAcsCovered(batch) +
    renderPipelineTrace(batch) +
    renderPmNote(batch) +
    `</div>`
  );
}

/** AC-014: Files changed table — path | action | tasks */
function renderFilesChanged(batch: BatchData): string {
  const count = batch.filesChanged.length;
  const rows = batch.filesChanged
    .map((f) => {
      const path = escape(truncate(f.path, PATH_MAX));
      const action = escape(f.action);
      const tasks = escape(f.tasksCovered.join(', '));
      return `<tr><td>${path}</td><td>${action}</td><td>${tasks}</td></tr>`;
    })
    .join('');

  return (
    `<details>` +
    `<summary>Files changed (${count})</summary>` +
    `<table class="story-card__files">` +
    `<thead><tr><th>path</th><th>action</th><th>tasks</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</details>`
  );
}

/** AC-015: ACs covered list — AC-XXX — evidence (truncated 160) */
function renderAcsCovered(batch: BatchData): string {
  const count = batch.acsCovered.length;
  const items = batch.acsCovered
    .map((ac) => {
      const id = escape(ac.id);
      const ev = escape(truncate(ac.evidence, EVIDENCE_MAX));
      return `<li><strong>${id}</strong> — ${ev}</li>`;
    })
    .join('');

  return (
    `<details>` +
    `<summary>ACs covered (${count})</summary>` +
    `<ul class="story-card__acs">${items}</ul>` +
    `</details>`
  );
}

/** AC-016: Pipeline trace table — role | dispatch_id | loop | duration | tokens | status */
function renderPipelineTrace(batch: BatchData): string {
  const count = batch.dispatches.length;
  const rows = batch.dispatches
    .map((d) => {
      const role = escape(d.role);
      const dispId = escape(truncate(d.dispatchId, DISPATCH_ID_MAX));
      const loop = d.loop !== null ? String(d.loop) : '—';
      const duration = formatDuration(d.durationMs);
      const tokens = d.totalTokens !== null ? String(d.totalTokens) : '—';
      const status = escape(d.status);
      return `<tr><td>${role}</td><td>${dispId}</td><td>${loop}</td><td>${duration}</td><td>${tokens}</td><td>${status}</td></tr>`;
    })
    .join('');

  return (
    `<details>` +
    `<summary>Pipeline trace (${count} dispatches)</summary>` +
    `<table class="story-card__pipeline-trace">` +
    `<thead><tr><th>role</th><th>dispatch_id</th><th>loop</th><th>duration</th><th>tokens</th><th>status</th></tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table>` +
    `</details>`
  );
}

/** AC-017: PM note — raw text (no truncation), escape() applied */
function renderPmNote(batch: BatchData): string {
  const body =
    batch.pmNote !== null
      ? `<p class="story-card__pmnote">${escape(batch.pmNote)}</p>`
      : `<p class="story-card__pmnote">(no PM note)</p>`;

  return `<details><summary>PM note</summary>${body}</details>`;
}
