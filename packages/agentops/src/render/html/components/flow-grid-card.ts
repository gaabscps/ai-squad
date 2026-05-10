/**
 * components/flow-grid-card.ts — Per-flow card for the index.html grid.
 * Generates a clickable card with status badge, KPIs, and optional sparklines.
 * Links use relative paths (AC-025) for GitHub Pages portability.
 */

import type { Compliance, Session } from '../../../types';
import { escape } from '../shared/escape';

import { badge, statusBadgeFromBatchState } from './badge';
import { sparkline } from './sparkline';

/** Aggregated summary for a single flow (cross-flow index card data) */
export interface FlowSummary {
  flowId: string;
  flowName: string;
  status: string;
  compliance: Compliance;
  startedAt: string;
  totalUsd: number | null;
  acsPassed: number;
  acsTotal: number;
  wallClockMs: number | null;
  costSeries: number[];
  mutationSeries: number[];
  loops: number;
}

/** Formats milliseconds as human-readable duration */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rem = s % 60;
    return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM === 0 ? `${h}h` : `${h}h${remM}m`;
}

/**
 * Renders a flow card for the index grid.
 *
 * @param flow - Aggregated flow summary
 * @param history - All preceding flows (including current); sparkline shown if >= 2 entries
 */
function complianceBadge(compliance: Compliance): string {
  if (compliance === 'pre-standard') return badge('pré-padrão', 'neutral');
  if (compliance === 'pm-bypass') return badge('pm-bypass', 'warn');
  return '';
}

export function flowGridCard(flow: FlowSummary, history: FlowSummary[]): string {
  const { kind, label } = statusBadgeFromBatchState(flow.status, flow.loops);

  const usdStr = flow.totalUsd !== null ? `$${flow.totalUsd.toFixed(2)}` : '—';
  const acsStr = `${flow.acsPassed}/${flow.acsTotal} ACs`;
  const wallStr = flow.wallClockMs !== null ? formatDuration(flow.wallClockMs) : '—';
  const complianceMarker = complianceBadge(flow.compliance);

  // Sparklines only when history has >= 2 distinct flows.
  // Considera apenas flows 'standard' — pré-padrão e pm-bypass não distorcem
  // a curva de evolução do contrato.
  let trendsHtml = '';
  const eligibleHistory = history.filter((f) => f.compliance === 'standard');
  if (eligibleHistory.length >= 2) {
    const costValues = eligibleHistory.map((f) => f.totalUsd ?? 0);
    const mutValues = eligibleHistory.map((f) =>
      f.mutationSeries.length > 0 ? f.mutationSeries[f.mutationSeries.length - 1]! : 0,
    );
    const costSparkline = sparkline(costValues);
    const mutSparkline = sparkline(mutValues);
    const costSpan = costSparkline ? `<span>cost ${costSparkline}</span>` : '';
    const mutSpan = mutSparkline ? `<span>mut ${mutSparkline}</span>` : '';
    if (costSpan || mutSpan) {
      trendsHtml = `\n  <div class="trends">${costSpan}${mutSpan}</div>`;
    }
  }

  return `<a class="flow-card" href="./${escape(flow.flowId)}.html">
  <header>
    ${badge(label, kind)}${complianceMarker}
    <h3>${escape(flow.flowName)}</h3>
  </header>
  <div class="flow-meta">
    <span>${usdStr}</span>
    <span>${acsStr}</span>
    <span>${wallStr}</span>
  </div>${trendsHtml}
</a>`;
}

/**
 * Creates a FlowSummary from a Session.
 * Cost data must be injected separately (Session doesn't carry CostMetric directly).
 * Use this as a base; callers may override totalUsd and cost/mutation series.
 */
export function summarizeFlow(
  session: Session,
  opts?: {
    totalUsd?: number | null;
    costSeries?: number[];
    mutationSeries?: number[];
  },
): FlowSummary {
  const passedAcs = session.qaResults.filter((r) => r.status === 'pass').length;
  const loops = session.dispatches.filter((d) => d.loop !== null && d.loop > 0).length;

  let wallClockMs: number | null = null;
  if (session.completedAt) {
    wallClockMs = new Date(session.completedAt).getTime() - new Date(session.startedAt).getTime();
  }

  return {
    flowId: session.taskId,
    flowName: session.featureName,
    status: session.status,
    compliance: session.compliance,
    startedAt: session.startedAt,
    totalUsd: opts?.totalUsd ?? null,
    acsPassed: passedAcs,
    acsTotal: session.acs.length,
    wallClockMs,
    costSeries: opts?.costSeries ?? [],
    mutationSeries: opts?.mutationSeries ?? [],
    loops,
  };
}
