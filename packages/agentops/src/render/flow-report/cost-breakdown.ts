/**
 * flow-report/cost-breakdown.ts — Cost breakdown section (AC-025, T-014).
 * Renders total tokens, USD estimate, wall-clock, tool uses, and coverage note.
 */

import type { Metrics } from '../../types';

/** Formats milliseconds into a human-friendly duration string */
function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (remainingSecs === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSecs}s`;
}

/** Formats a USD amount to 4 decimal places */
function fmtUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/**
 * Renders the Cost breakdown section for a per-flow report.
 * Uses metrics.cost (CostMetric) when available; falls back to tokenCost proxy.
 */
export function renderCostBreakdown(metrics: Metrics): string {
  const lines: string[] = ['## Cost breakdown'];

  const cost = metrics.cost;

  if (cost?.total_usd === null || cost?.total_usd === undefined) {
    // No USD data
    const note = cost?.assumption_note ?? 'no usage data available';
    lines.push('');
    lines.push(`_${note}_`);
    lines.push('');
    lines.push(`- Total tokens: ${metrics.tokenCost.total ?? 'n/a'}`);
    lines.push('- Estimated cost USD: n/a (no usage data with known model)');
    lines.push('- Cost per AC: n/a');
    lines.push('- Cost per dispatch (avg): n/a');
    lines.push('- Wall-clock duration: n/a');
    lines.push('- Tool uses: n/a');
    if (cost) {
      lines.push(
        `- Coverage: ${cost.coverage.included} of ${cost.coverage.total} dispatches included`,
      );
    }
    return lines.join('\n');
  }

  // Aggregate wall-clock and tool uses from session dispatches
  // These are not in Metrics directly; we surface from cost.assumption_note coverage note
  const { total_usd, per_ac_usd, per_dispatch_avg_usd, coverage, assumption_note } = cost;

  lines.push('');
  lines.push(`_${assumption_note}_`);
  lines.push('');
  lines.push(`- Estimated cost USD total: ${fmtUsd(total_usd)}`);
  lines.push(`- Cost per AC: ${per_ac_usd !== null ? fmtUsd(per_ac_usd) : 'n/a (no ACs defined)'}`);
  lines.push(
    `- Cost per dispatch (avg): ${per_dispatch_avg_usd !== null ? fmtUsd(per_dispatch_avg_usd) : 'n/a'}`,
  );
  lines.push(
    `- Coverage: ${coverage.included} of ${coverage.total} dispatches included in cost calculation`,
  );

  return lines.join('\n');
}

interface DispatchForBreakdown {
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
    model: string;
    cost_usd?: number;
    phase_coverage?: string;
    phase_split?: Partial<Record<string, number>>;
  };
}

/** Renders the "### Cost by phase" subsection when phase_coverage data is available. */
function renderByPhase(dispatches: DispatchForBreakdown[], totalUsd: number | null): string {
  // Accumulate cost per phase
  const phaseUsd: Record<string, number> = {};
  for (const d of dispatches) {
    if (!d.usage?.cost_usd) continue;
    const { phase_coverage, phase_split, cost_usd } = d.usage;
    if (!phase_coverage) continue;
    if (phase_coverage === 'mixed' && phase_split) {
      for (const [ph, ratio] of Object.entries(phase_split)) {
        phaseUsd[ph] = (phaseUsd[ph] ?? 0) + cost_usd * (ratio ?? 0);
      }
    } else {
      phaseUsd[phase_coverage] = (phaseUsd[phase_coverage] ?? 0) + cost_usd;
    }
  }
  const entries = Object.entries(phaseUsd).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '';
  const rows = entries.map(([ph, usd]) => {
    const pct = totalUsd && totalUsd > 0 ? ((usd / totalUsd) * 100).toFixed(1) : 'n/a';
    return `| ${ph} | ${fmtUsd(usd)} | ${pct}% |`;
  });
  return [
    '',
    '### Cost by phase',
    '',
    '| Phase | Cost USD | % of total |',
    '|-------|----------|------------|',
    ...rows,
    '',
    '_Mixed sessions split via wall-clock proportional estimate_',
  ].join('\n');
}

/**
 * Renders the Cost breakdown section with extended usage stats from session dispatches.
 * Accepts optional raw dispatch usage data for wall-clock and tool uses aggregation.
 */
export function renderCostBreakdownFull(
  metrics: Metrics,
  dispatches: DispatchForBreakdown[],
): string {
  const lines: string[] = ['## Cost breakdown'];

  // Aggregate wall-clock and tool uses
  let totalDurationMs = 0;
  let totalToolUses = 0;
  let totalTokens = 0;
  let usageCount = 0;

  for (const d of dispatches) {
    if (d.usage) {
      totalDurationMs += d.usage.duration_ms;
      totalToolUses += d.usage.tool_uses;
      totalTokens += d.usage.total_tokens;
      usageCount++;
    }
  }

  const cost = metrics.cost;

  if (cost?.total_usd === null || cost?.total_usd === undefined) {
    const note = cost?.assumption_note ?? 'no usage data available';
    lines.push('');
    lines.push(`_${note}_`);
    lines.push('');
    lines.push(`- Total tokens: ${usageCount > 0 ? totalTokens : 'n/a'}`);
    lines.push(
      '  - Estimated input (70%): ' + (usageCount > 0 ? Math.round(totalTokens * 0.7) : 'n/a'),
    );
    lines.push(
      '  - Estimated output (30%): ' + (usageCount > 0 ? Math.round(totalTokens * 0.3) : 'n/a'),
    );
    lines.push('- Estimated cost USD: n/a');
    lines.push('- Cost per AC: n/a');
    lines.push('- Cost per dispatch (avg): n/a');
    lines.push(`- Wall-clock duration: ${usageCount > 0 ? formatMs(totalDurationMs) : 'n/a'}`);
    lines.push(`- Tool uses total: ${usageCount > 0 ? totalToolUses : 'n/a'}`);
    if (cost) {
      lines.push(
        `- Coverage: ${cost.coverage.included} of ${cost.coverage.total} dispatches included in cost calculation`,
      );
    }
    return lines.join('\n');
  }

  const { total_usd, per_ac_usd, per_dispatch_avg_usd, coverage, assumption_note } = cost;

  lines.push('');
  lines.push(`_${assumption_note}_`);
  lines.push('');
  lines.push(`- Total tokens: ${totalTokens > 0 ? totalTokens : 'n/a'}`);
  if (totalTokens > 0) {
    lines.push(`  - Estimated input (70%): ${Math.round(totalTokens * 0.7)}`);
    lines.push(`  - Estimated output (30%): ${Math.round(totalTokens * 0.3)}`);
  }
  lines.push(`- Estimated cost USD total: ${fmtUsd(total_usd)}`);
  lines.push(`- Cost per AC: ${per_ac_usd !== null ? fmtUsd(per_ac_usd) : 'n/a (no ACs defined)'}`);
  lines.push(
    `- Cost per dispatch (avg): ${per_dispatch_avg_usd !== null ? fmtUsd(per_dispatch_avg_usd) : 'n/a'}`,
  );
  lines.push(`- Wall-clock duration: ${totalDurationMs > 0 ? formatMs(totalDurationMs) : 'n/a'}`);
  lines.push(`- Tool uses total: ${totalToolUses > 0 ? totalToolUses : 'n/a'}`);
  lines.push(
    `- Coverage: ${coverage.included} of ${coverage.total} dispatches included in cost calculation`,
  );

  const byPhase = renderByPhase(dispatches, total_usd);
  if (byPhase) lines.push(byPhase);

  return lines.join('\n');
}
