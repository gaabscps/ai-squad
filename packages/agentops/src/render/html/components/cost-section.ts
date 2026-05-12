/**
 * components/cost-section.ts — Prominent Cost section for per-flow HTML report.
 * Surfaces total USD, $/AC, $/dispatch, tokens (with input/output split), wall-clock,
 * tool uses, coverage, and per-model breakdown — data otherwise buried inside the
 * collapsed Markdown embed.
 */

import { ANTHROPIC_PRICING_2026 } from '../../../constants';
import { computeUsageCost } from '../../../measure/cost';
import type { CostMetric, Session, Usage } from '../../../types';
import { fmtUsd } from '../../flow-report/utils';
import { escape } from '../shared/escape';

const INPUT_RATIO = 0.7;
const OUTPUT_RATIO = 0.3;

function fmtMs(ms: number): string {
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

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

interface ModelAgg {
  dispatches: number;
  totalTokens: number;
  toolUses: number;
  durationMs: number;
  usd: number;
}

function pricingFor(
  model: string,
): { input_per_mtok_usd: number; output_per_mtok_usd: number } | null {
  if (model === 'opus-4-7') return ANTHROPIC_PRICING_2026['opus-4-7'];
  if (model === 'sonnet-4-6') return ANTHROPIC_PRICING_2026['sonnet-4-6'];
  if (model === 'haiku-4-5') return ANTHROPIC_PRICING_2026['haiku-4-5'];
  return null;
}

function usdFor(usage: Usage): number {
  const pricing = pricingFor(usage.model);
  if (!pricing) return 0;
  return computeUsageCost(usage, pricing, INPUT_RATIO, OUTPUT_RATIO);
}

function aggregateUsage(session: Session): {
  totalTokens: number;
  toolUses: number;
  durationMs: number;
  withUsage: number;
  byModel: Record<string, ModelAgg>;
} {
  let totalTokens = 0;
  let toolUses = 0;
  let durationMs = 0;
  let withUsage = 0;
  const byModel: Record<string, ModelAgg> = {};

  for (const d of session.dispatches) {
    if (!d.usage) continue;
    withUsage++;
    const u: Usage = d.usage;
    totalTokens += u.total_tokens;
    toolUses += u.tool_uses;
    durationMs += u.duration_ms;

    const key = u.model;
    const agg = byModel[key] ?? {
      dispatches: 0,
      totalTokens: 0,
      toolUses: 0,
      durationMs: 0,
      usd: 0,
    };
    agg.dispatches++;
    agg.totalTokens += u.total_tokens;
    agg.toolUses += u.tool_uses;
    agg.durationMs += u.duration_ms;
    agg.usd += usdFor(u);
    byModel[key] = agg;
  }

  return { totalTokens, toolUses, durationMs, withUsage, byModel };
}

interface GroupAgg {
  dispatches: number;
  totalTokens: number;
  durationMs: number;
  usd: number;
}

function aggregateBy<K extends string>(
  session: Session,
  classify: (d: Session['dispatches'][number]) => K | null,
): Record<K, GroupAgg> {
  const acc = {} as Record<K, GroupAgg>;
  for (const d of session.dispatches) {
    if (!d.usage) continue;
    const key = classify(d);
    if (key === null) continue;
    const cur = acc[key] ?? { dispatches: 0, totalTokens: 0, durationMs: 0, usd: 0 };
    cur.dispatches++;
    cur.totalTokens += d.usage.total_tokens;
    cur.durationMs += d.usage.duration_ms;
    cur.usd += usdFor(d.usage);
    acc[key] = cur;
  }
  return acc;
}

function classifyByPhase(session: Session, d: Session['dispatches'][number]): string | null {
  for (const p of session.phases) {
    if (!p.startedAt) continue;
    const phaseStart = new Date(p.startedAt).getTime();
    const phaseEnd = p.completedAt ? new Date(p.completedAt).getTime() : Number.POSITIVE_INFINITY;
    const t = new Date(d.startedAt).getTime();
    if (t >= phaseStart && t <= phaseEnd) return p.name;
  }
  return 'unattributed';
}

function metricCard(label: string, value: string, sub?: string): string {
  const subHtml = sub ? `<small>${escape(sub)}</small>` : '';
  return `<div class="cost-card">
  <span class="cost-label">${escape(label)}</span>
  <span class="cost-value">${escape(value)}</span>
  ${subHtml}
</div>`;
}

function groupBreakdownTable(
  title: string,
  groupLabel: string,
  groups: Record<string, GroupAgg>,
  totalUsd: number | null,
): string {
  const entries = Object.entries(groups).sort((a, b) => b[1].usd - a[1].usd);
  if (entries.length === 0) return '';
  const rows = entries
    .map(([key, agg]) => {
      const share = totalUsd && totalUsd > 0 ? (agg.usd / totalUsd) * 100 : 0;
      return `<tr>
  <td><code>${escape(key)}</code></td>
  <td>${agg.dispatches}</td>
  <td>${fmtNum(agg.totalTokens)}</td>
  <td>${fmtMs(agg.durationMs)}</td>
  <td>${fmtUsd(agg.usd, 4)}</td>
  <td>${share.toFixed(1)}%</td>
</tr>`;
    })
    .join('\n');
  return `<details class="cost-breakdown">
  <summary>${escape(title)}</summary>
  <table class="cost-models">
    <thead>
      <tr>
        <th>${escape(groupLabel)}</th>
        <th>Dispatches</th>
        <th>Tokens</th>
        <th>Duration</th>
        <th>USD</th>
        <th>Share</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</details>`;
}

function modelBreakdownTable(byModel: Record<string, ModelAgg>, totalUsd: number | null): string {
  const rows = Object.entries(byModel)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([model, agg]) => {
      const share = totalUsd && totalUsd > 0 ? (agg.usd / totalUsd) * 100 : 0;
      return `<tr>
  <td><code>${escape(model)}</code></td>
  <td>${agg.dispatches}</td>
  <td>${fmtNum(agg.totalTokens)}</td>
  <td>${fmtMs(agg.durationMs)}</td>
  <td>${agg.toolUses}</td>
  <td>${fmtUsd(agg.usd, 4)}</td>
  <td>${share.toFixed(1)}%</td>
</tr>`;
    })
    .join('\n');

  if (!rows) return '';

  return `<table class="cost-models">
  <thead>
    <tr>
      <th>Model</th>
      <th>Dispatches</th>
      <th>Tokens</th>
      <th>Duration</th>
      <th>Tool uses</th>
      <th>USD</th>
      <th>Share</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

/**
 * Renders the prominent Cost section between Story and Drilldown.
 *
 * @param session - Enriched session data
 * @param cost - CostMetric or null when no usage data is available
 */
export function costSection(session: Session, cost: CostMetric | null): string {
  const usage = aggregateUsage(session);

  if (cost === null && usage.withUsage === 0) {
    return `<section class="cost-section">
  <h2>Cost</h2>
  <p class="cost-empty">No usage data available — run dispatches with <code>&lt;usage&gt;</code> annotations or apply <code>npm run agentops:backfill</code>.</p>
</section>`;
  }

  const totalUsd = cost?.total_usd ?? null;
  const perAcUsd = cost?.per_ac_usd ?? null;
  const perDispatchUsd = cost?.per_dispatch_avg_usd ?? null;
  const coverage = cost?.coverage ?? {
    included: usage.withUsage,
    total: session.dispatches.length,
  };
  const note = cost?.assumption_note ?? '';

  const inputTokens = Math.round(usage.totalTokens * INPUT_RATIO);
  const outputTokens = Math.round(usage.totalTokens * OUTPUT_RATIO);

  const cards = [
    metricCard(
      'Total cost',
      totalUsd !== null ? fmtUsd(totalUsd) : '—',
      totalUsd !== null ? fmtUsd(totalUsd, 4) : undefined,
    ),
    metricCard(
      '$ / AC',
      perAcUsd !== null ? fmtUsd(perAcUsd, 4) : '—',
      session.acs.length > 0 ? `${session.acs.length} ACs` : undefined,
    ),
    metricCard(
      '$ / dispatch',
      perDispatchUsd !== null ? fmtUsd(perDispatchUsd, 4) : '—',
      `avg of ${coverage.included}`,
    ),
    metricCard(
      'Tokens',
      usage.totalTokens > 0 ? fmtNum(usage.totalTokens) : '—',
      usage.totalTokens > 0
        ? `${fmtNum(inputTokens)} in / ${fmtNum(outputTokens)} out (70/30)`
        : undefined,
    ),
    metricCard(
      'Wall-clock',
      usage.durationMs > 0 ? fmtMs(usage.durationMs) : '—',
      `${usage.withUsage} dispatches with usage`,
    ),
    metricCard(
      'Tool uses',
      usage.toolUses > 0 ? fmtNum(usage.toolUses) : '—',
      usage.withUsage > 0
        ? `~${(usage.toolUses / usage.withUsage).toFixed(1)} per dispatch`
        : undefined,
    ),
  ];

  const coverageRatio =
    coverage.total > 0 ? Math.round((coverage.included / coverage.total) * 100) : 0;
  const coverageKind = coverageRatio >= 90 ? 'pass' : coverageRatio >= 60 ? 'warn' : 'fail';

  const byRole = aggregateBy(session, (d) => d.role);
  const byPhase = aggregateBy(session, (d) => classifyByPhase(session, d));

  return `<section class="cost-section">
  <header class="cost-header">
    <h2>Cost</h2>
    <span class="badge badge-${coverageKind}">coverage ${coverage.included}/${coverage.total} (${coverageRatio}%)</span>
  </header>
  <div class="cost-grid">
    ${cards.join('\n    ')}
  </div>
  ${modelBreakdownTable(usage.byModel, totalUsd)}
  ${groupBreakdownTable('Cost by role (subagent type)', 'Role', byRole, totalUsd)}
  ${groupBreakdownTable('Cost by SDD phase', 'Phase', byPhase, totalUsd)}
  ${note ? `<p class="cost-note"><em>${escape(note)}</em></p>` : ''}
</section>`;
}
