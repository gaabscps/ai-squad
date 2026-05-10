/**
 * render/html/index-report.ts — Cross-flow index HTML page orchestrator.
 * Assembles a complete self-contained index.html for all flows.
 * AC-001, AC-013, AC-014, AC-015, AC-016, AC-021, AC-022, AC-024, AC-025
 *
 * Structure: shell( header + repo-health + flow-grid )
 * Sessions displayed in descending order by startedAt (last flow first).
 */

import type { RepoHealth, Session } from '../../types';

import { badge } from './components/badge';
import { flowGridCard, summarizeFlow } from './components/flow-grid-card';
import { shell } from './shared/shell';

/**
 * Aggregates cross-flow KPIs from all sessions.
 * Emits spans with var(--fg-muted) for metadata.
 */
function crossFlowKpis(sessions: Session[]): string {
  const totalFlows = sessions.length;

  const totalAcs = sessions.reduce((sum, s) => sum + s.acs.length, 0);

  const totalPassedAcs = sessions.reduce(
    (sum, s) => sum + s.qaResults.filter((r) => r.status === 'pass').length,
    0,
  );

  // Wall-clock total from all sessions
  let totalWallMs = 0;
  for (const s of sessions) {
    if (s.completedAt) {
      totalWallMs += new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
    }
  }

  const flowStr = `<span>${totalFlows} flow${totalFlows !== 1 ? 's' : ''}</span>`;
  const acsStr = `<span style="color:var(--fg-muted)">${totalPassedAcs}/${totalAcs} ACs</span>`;
  const wallStr = `<span style="color:var(--fg-muted)">${formatWallClock(totalWallMs)}</span>`;

  return `${flowStr}${acsStr}${wallStr}`;
}

/** Formats total milliseconds as human-readable wall-clock */
function formatWallClock(ms: number): string {
  if (ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h${remM}m`;
}

/**
 * Renders repo health as a grid of colored badges.
 * Falls back to a placeholder message when repoHealth is null.
 */
function badgeGrid(repoHealth: RepoHealth | null): string {
  if (repoHealth === null) {
    return '<p class="muted">Repo health not available — run measurement tools first</p>';
  }

  const badges: string[] = [];

  if (repoHealth.mutation !== null) {
    const score = repoHealth.mutation.score;
    const kind = score >= 70 ? 'pass' : score >= 63 ? 'warn' : 'fail';
    badges.push(badge(`mut ${score.toFixed(1)}%`, kind));
  }

  if (repoHealth.typeCoverage !== null) {
    const pct = repoHealth.typeCoverage.percent;
    const kind = pct >= 95 ? 'pass' : pct >= 85.5 ? 'warn' : 'fail';
    badges.push(badge(`type ${pct.toFixed(1)}%`, kind));
  }

  if (repoHealth.depViolations !== null) {
    const errors = repoHealth.depViolations.error;
    const kind = errors === 0 ? 'pass' : 'fail';
    badges.push(badge(`arch ${errors === 0 ? '✓' : `${errors} err`}`, kind));
  }

  if (badges.length === 0) {
    return '<p class="muted">No health metrics available</p>';
  }

  return `<div class="badge-grid">${badges.join(' ')}</div>`;
}

/**
 * Renders the complete index.html page.
 * Sessions are sorted descending by startedAt (newest flow first, per spec).
 *
 * @param sessions - All enriched sessions (any order; sorted internally)
 * @param repoHealth - Most recent repo health snapshot, or null
 * @returns Self-contained HTML string
 */
export function renderIndexHtml(sessions: Session[], repoHealth: RepoHealth | null): string {
  // Sort sessions descending by startedAt (newest first)
  const sorted = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // Build flow grid — pass cumulative history slice so sparklines work correctly.
  // sorted[0] = newest; for sparklines we need ascending history.
  // We reverse back so oldest→newest for history builds, then display newest→oldest.
  const ascending = [...sorted].reverse();

  const gridCards = sorted
    .map((session) => {
      // history = all flows from oldest up to and including this one (ascending)
      const idx = ascending.findIndex((s) => s.taskId === session.taskId);
      const history = ascending.slice(0, idx + 1).map((s) => summarizeFlow(s));
      return flowGridCard(summarizeFlow(session), history);
    })
    .join('\n');

  const body = `
    <header>
      <h1>AgentOps · CalendárioFR</h1>
      <div class="kpis">${crossFlowKpis(sessions)}</div>
    </header>
    <main>
      <section class="repo-health-current">
        <h2>Repo health (current)</h2>
        ${badgeGrid(repoHealth)}
      </section>
      <section>
        <h2>Flows</h2>
        <div class="flow-grid">
          ${gridCards}
        </div>
      </section>
    </main>
  `;

  return shell({
    title: 'AgentOps · CalendárioFR',
    body,
  });
}
