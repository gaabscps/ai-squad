/**
 * flow-report/repo-health-snapshot.ts — Repo health snapshot section (AC-028, AC-032, AC-034).
 * Shared between flow-report and index-report.
 * renderRepoHealthSnapshot(repoHealth: RepoHealth | null) → string
 */

import type { RepoHealth } from '../../types';
import { mdTable } from './utils';

/** Returns a status symbol based on threshold comparison */
function statusSymbol(value: number, threshold: number, lowerIsBetter: boolean): string {
  if (lowerIsBetter) {
    if (value === 0) return '✓';
    if (value <= threshold) return '⚠';
    return '✗';
  }
  // higher is better
  if (value >= threshold) return '✓';
  if (value >= threshold * 0.9) return '⚠';
  return '✗';
}

/**
 * Renders the Repo health snapshot section (AC-028, AC-032, AC-034).
 *
 * Metrics table columns: Métrica | Valor | Threshold | Status (✓/⚠/✗).
 * If repoHealth is null → graceful "not measured" message (AC-034).
 *
 * Shared between flow-report/index.ts and render/index-report.ts.
 */
export function renderRepoHealthSnapshot(repoHealth: RepoHealth | null): string {
  if (repoHealth === null) {
    return (
      '## Repo health snapshot\n\n' +
      'Repo health: not measured ' +
      '(run `npm run mutation && npm run type-coverage && npm run arch:check` first)'
    );
  }

  const headers = ['Métrica', 'Valor', 'Threshold', 'Status'];
  const rows: string[][] = [];

  // Mutation score
  if (repoHealth.mutation !== null) {
    const score = repoHealth.mutation.score;
    const threshold = 70;
    rows.push([
      'Mutation score',
      `${score.toFixed(1)}%`,
      `≥ ${threshold}%`,
      statusSymbol(score, threshold, false),
    ]);
  } else {
    rows.push(['Mutation score', '—', '≥ 70%', '—']);
  }

  // Type coverage
  if (repoHealth.typeCoverage !== null) {
    const percent = repoHealth.typeCoverage.percent;
    const threshold = 95;
    rows.push([
      'Type coverage',
      `${percent.toFixed(1)}%`,
      `≥ ${threshold}%`,
      statusSymbol(percent, threshold, false),
    ]);
    rows.push(['`any` count', String(repoHealth.typeCoverage.anyCount), '—', '—']);
  } else {
    rows.push(['Type coverage', '—', '≥ 95%', '—']);
  }

  // Dep violations
  if (repoHealth.depViolations !== null) {
    const errors = repoHealth.depViolations.error;
    rows.push(['Dep violations (error)', String(errors), '= 0', statusSymbol(errors, 0, true)]);
    rows.push(['Dep violations (warn)', String(repoHealth.depViolations.warn), '—', '—']);
  } else {
    rows.push(['Dep violations', '—', '= 0', '—']);
  }

  const table = mdTable(headers, rows);
  const measuredAt = repoHealth.measuredAt.slice(0, 10);
  return `## Repo health snapshot\n\n_Measured at: ${measuredAt}_\n\n${table}`;
}
