/**
 * AgentOps observability extractor — render/index-report.ts
 * T-013: renders the cross-flow index Markdown report (AC-002..AC-005, AC-025).
 * BATCH-C (T-021): adds Repo health section (AC-032), cost cols (AC-031),
 *   cost/mutation trends (AC-033), graceful degradation (AC-034).
 *
 * renderIndexReport(allMetrics, trendInsights, generatedAt, repoHealth?) → string
 */

import type { Compliance, Insight, Metrics, RepoHealth, Session } from '../types';

import { renderRepoHealthSnapshot } from './flow-report/repo-health-snapshot';

/**
 * Símbolo curto para a coluna de compliance no cross-flow table.
 * Mantém a tabela escaneável sem sacrificar a informação:
 *   ✓ = standard (entra em trends/health)
 *   ◐ = pré-padrão (legado pré-extensões — excluído de trends)
 *   ⊘ = pm-bypass (PM autônomo skipou parte do pipeline canônico)
 */
function complianceSymbol(c: Compliance): string {
  switch (c) {
    case 'pre-standard':
      return '◐';
    case 'pm-bypass':
      return '⊘';
    case 'standard':
    default:
      return '✓';
  }
}

// ---------------------------------------------------------------------------
// Status symbol mapping (AC-003)
// ---------------------------------------------------------------------------

type FlowStatus = Metrics['status'];

function statusSymbol(status: FlowStatus): string {
  switch (status) {
    case 'done':
      return '✓';
    case 'escalated':
      return '⚠';
    case 'paused':
      return '⏸';
    case 'running':
    case 'specify-only':
    default:
      return '…';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Formats a number as a percentage string, or '—' for unavailable */
function fmtPct(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

/** Formats dispatches/AC ratio */
function fmtRatio(value: number): string {
  if (value === 0) return '—';
  return value.toFixed(2);
}

/** Extracts ISO date (YYYY-MM-DD) from ISO timestamp */
function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

/** Formats USD to 4 decimal places or '—' if null */
function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(4)}`;
}

/** Builds a Markdown table from headers and rows */
function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---');
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderCrossFlowTable(allMetrics: { session: Session; metrics: Metrics }[]): string {
  const headers = [
    'ID',
    'Compl.',
    'Feature',
    'Phase',
    'Status',
    'Dispatches',
    'ACs',
    'Disp/AC',
    'Esc %',
    '$ USD',
    '$/AC',
    'Created',
  ];
  const rows = allMetrics.map(({ metrics: m }) => {
    const symbol = statusSymbol(m.status);
    const escPct = m.totalDispatches === 0 ? '—' : fmtPct(m.escalationRate);
    const totalUsd = fmtUsd(m.cost?.total_usd);
    const perAcUsd = fmtUsd(m.cost?.per_ac_usd);
    return [
      `${symbol} ${m.taskId}`,
      complianceSymbol(m.compliance),
      m.featureName,
      m.currentPhase,
      m.status,
      String(m.totalDispatches),
      String(m.acClosure.total),
      fmtRatio(m.dispatchesPerAc),
      escPct,
      totalUsd,
      perAcUsd,
      isoDate(m.startedAt),
    ];
  });
  return mdTable(headers, rows);
}

function renderComplianceLegend(allMetrics: { metrics: Metrics }[]): string {
  const hasPreStandard = allMetrics.some((m) => m.metrics.compliance === 'pre-standard');
  const hasPmBypass = allMetrics.some((m) => m.metrics.compliance === 'pm-bypass');
  if (!hasPreStandard && !hasPmBypass) return '';
  const lines = [
    '',
    '_Compl. legend:_ ✓ standard · ◐ pré-padrão (excluído de trends/health) · ⊘ pm-bypass (excluído de trends/health)',
  ];
  return lines.join('\n');
}

function renderTrends(
  trendInsights: Insight[],
  completedFlowCount: number,
  allMetrics: { session: Session; metrics: Metrics }[],
): string {
  const extraBullets: string[] = [];

  // Trends e health metrics consideram apenas flows 'standard' — pré-padrão
  // e pm-bypass são auditados visualmente mas não distorcem a curva.
  const eligible = allMetrics.filter((m) => m.metrics.compliance === 'standard');

  // AC-033: cost trend (≥ 2 flows with cost data)
  const flowsWithCost = eligible.filter(
    (m) => m.metrics.cost?.per_ac_usd !== null && m.metrics.cost?.per_ac_usd !== undefined,
  );
  if (flowsWithCost.length >= 2) {
    const first = flowsWithCost[0]!;
    const last = flowsWithCost[flowsWithCost.length - 1]!;
    const firstCost = first.metrics.cost!.per_ac_usd!;
    const lastCost = last.metrics.cost!.per_ac_usd!;
    const delta = firstCost !== 0 ? ((lastCost - firstCost) / firstCost) * 100 : 0;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
    extraBullets.push(
      `Cost per AC: ${first.metrics.taskId}=${fmtUsd(firstCost)} → ${last.metrics.taskId}=${fmtUsd(lastCost)} (${deltaStr})`,
    );
  }

  // AC-033: mutation score trend (≥ 2 flows with mutation data)
  const flowsWithMutation = eligible.filter(
    (m) => m.metrics.repoHealth?.mutation !== null && m.metrics.repoHealth?.mutation !== undefined,
  );
  if (flowsWithMutation.length >= 2) {
    const first = flowsWithMutation[0]!;
    const last = flowsWithMutation[flowsWithMutation.length - 1]!;
    const firstScore = first.metrics.repoHealth!.mutation!.score;
    const lastScore = last.metrics.repoHealth!.mutation!.score;
    const delta = lastScore - firstScore;
    const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
    extraBullets.push(
      `Mutation score: ${first.metrics.taskId}=${firstScore.toFixed(1)}% → ${last.metrics.taskId}=${lastScore.toFixed(1)}% (${deltaStr})`,
    );
  }

  const allBullets = [...trendInsights.map((i) => i.message), ...extraBullets];

  if (completedFlowCount < 2 && allBullets.length === 0) {
    return '## Trends\n\n- (need ≥ 2 completed flows for trend analysis)';
  }
  if (allBullets.length === 0) {
    return '## Trends\n\n- (need ≥ 2 completed flows for trend analysis)';
  }
  const bullets = allBullets.map((b) => `- ${b}`).join('\n');
  return `## Trends\n\n${bullets}`;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Renders the cross-flow index Markdown report.
 * Sections: H1, header, repo health (AC-032), cross-flow table (AC-031), trends (AC-033).
 *
 * @param allMetrics   - All session+metrics pairs.
 * @param trendInsights - Trend insights from computeTrends.
 * @param generatedAt  - ISO timestamp string.
 * @param repoHealth   - Optional current repo health snapshot (AC-032, AC-034).
 */
export function renderIndexReport(
  allMetrics: { session: Session; metrics: Metrics }[],
  trendInsights: Insight[],
  generatedAt: string,
  repoHealth?: RepoHealth | null,
): string {
  const sections: string[] = [];

  // H1
  sections.push('# AgentOps observability — overview');

  // Header (AC-004)
  sections.push(`> Generated at: ${generatedAt} | Total flows: ${allMetrics.length}`);

  // Repo health (AC-032, AC-034) — added to top after header
  if (repoHealth !== undefined) {
    sections.push(renderRepoHealthSnapshot(repoHealth));
  }

  // Cross-flow snapshot (AC-002, AC-003, AC-005, AC-031)
  sections.push('## Cross-flow snapshot');
  if (allMetrics.length === 0) {
    sections.push('(no flows yet)');
  } else {
    const table = renderCrossFlowTable(allMetrics);
    const legend = renderComplianceLegend(allMetrics);
    sections.push(legend ? `${table}\n${legend}` : table);
  }

  // Trends (AC-025, AC-033)
  const completedCount = allMetrics.filter((m) => m.metrics.status === 'done').length;
  sections.push(renderTrends(trendInsights, completedCount, allMetrics));

  return sections.join('\n\n') + '\n';
}
