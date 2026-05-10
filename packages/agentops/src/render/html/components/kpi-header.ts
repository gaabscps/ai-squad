/**
 * components/kpi-header.ts — Sticky KPI header bar for per-flow HTML report.
 * Shows flow status, wall-clock, cost, ACs, mutation, type-cov, and loop count.
 * All dynamic values are HTML-escaped or formatted with numeric fallbacks.
 */

import type { CostMetric, RepoHealth, Session } from '../../../types';
import { escape } from '../shared/escape';

import { badge, statusBadgeFromBatchState } from './badge';

/** Formats milliseconds as human-readable duration (e.g. "5h45m", "30m", "45s") */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`.replace(/ 0s$/, '');
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h${remM}m`;
}

/** Formats USD amount to 2 decimal places */
function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Counts dispatches that had loop > 0 (retries) */
function countLoops(session: Session): number {
  return session.dispatches.filter((d) => d.loop !== null && d.loop > 0).length;
}

/** Counts ACs that passed in qaResults */
function countPassedAcs(session: Session): number {
  return session.qaResults.filter((r) => r.status === 'pass').length;
}

/**
 * Renders the sticky KPI header bar for a per-flow page.
 *
 * @param session - Enriched session data
 * @param repoHealth - Repo health snapshot, or null if not measured
 * @param cost - Cost metric, or null if not computed
 */
export function kpiHeader(
  session: Session,
  repoHealth: RepoHealth | null,
  cost: CostMetric | null,
): string {
  const loops = countLoops(session);
  const { kind, label } = statusBadgeFromBatchState(session.status, loops);

  // Wall-clock duration
  let wallClock = '—';
  if (session.completedAt) {
    const ms = new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime();
    wallClock = formatDuration(ms);
  }

  // USD cost
  const usdStr = cost !== null && cost.total_usd !== null ? formatUsd(cost.total_usd) : '—';

  // USD per AC
  const perAcStr =
    cost !== null && cost.per_ac_usd !== null ? `$${cost.per_ac_usd.toFixed(3)}/AC` : '';

  // ACs
  const totalAcs = session.acs.length;
  const passedAcs = countPassedAcs(session);
  const acsStr = `${passedAcs}/${totalAcs} ACs`;

  // Mutation score
  const mutStr =
    repoHealth?.mutation !== null && repoHealth?.mutation !== undefined
      ? `${repoHealth.mutation.score.toFixed(1)}%`
      : '—';

  // Type coverage
  const typStr =
    repoHealth?.typeCoverage !== null && repoHealth?.typeCoverage !== undefined
      ? `${repoHealth.typeCoverage.percent.toFixed(1)}%`
      : '—';

  // Loops
  const loopsStr = `${loops} loop${loops !== 1 ? 's' : ''}`;

  const perAcSpan = perAcStr ? `<span class="kpi-sub">${perAcStr}</span>` : '';

  return `<header class="kpi-bar">
  <h1>${escape(session.featureName)} ${badge(label, kind)}</h1>
  <div class="kpis">
    <span>${wallClock}</span>
    <span>${usdStr}</span>
    ${perAcSpan}
    <span>${acsStr}</span>
    <span>mut ${mutStr}</span>
    <span>type ${typStr}</span>
    <span>${loopsStr}</span>
  </div>
</header>`;
}
