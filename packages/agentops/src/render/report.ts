/**
 * render/report.ts — Cost rollup sections for agentops flow reports (AC-015).
 *
 * Two new markdown sections:
 *   - renderCostByTier:      ## Cost by tier  (AC-015, AC-016)
 *   - renderCostByPmSession: ## Cost by PM session  (AC-015, AC-013)
 *
 * FEAT-006 T-009 (AC-007, AC-008):
 *   - renderDispatchWarnings: ## Warnings section rendered when dispatch
 *     warnings are present (unknown_status, deprecated_status, unknown_role).
 *
 * Consumed by flow-report/index.ts when session data is present.
 */

import type { DispatchWarning } from '../enrich/dispatches';
import type { Session, PmSession, TierCalibration } from '../types';
import { fmtUsd, mdTable } from './flow-report/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ordered canonical tier labels (T4 first = highest-cost tier). */
const TIER_ORDER: Array<TierCalibration['tier'] | 'unknown'> = ['T1', 'T2', 'T3', 'T4', 'unknown'];

// ---------------------------------------------------------------------------
// renderCostByTier
// ---------------------------------------------------------------------------

/**
 * Aggregates `dispatches[].usage.cost_usd` grouped by `tierCalibration.tier`.
 * Dispatches without `tierCalibration` (or with `cost_usd` absent) are counted
 * in the `unknown` bucket per AC-016.
 *
 * Returns an empty string (no section rendered) when no dispatch has `cost_usd`.
 */
export function renderCostByTier(dispatches: Session['dispatches']): string {
  const tierTotals: Record<string, number> = {};

  for (const d of dispatches) {
    const costUsd = d.usage?.cost_usd;
    if (costUsd === undefined || costUsd === null) continue;

    const tier = d.tierCalibration?.tier ?? 'unknown';
    tierTotals[tier] = (tierTotals[tier] ?? 0) + costUsd;
  }

  const keys = Object.keys(tierTotals);
  if (keys.length === 0) {
    return '## Cost by tier\n\n_No cost data available._';
  }

  // Sort by canonical tier order.
  const sortedEntries = TIER_ORDER.filter((t) => tierTotals[t] !== undefined).map((tier) => ({
    tier,
    usd: tierTotals[tier] as number,
  }));

  // Any tier not in canonical order (shouldn't happen but defensive): append at end.
  for (const key of keys) {
    if (!TIER_ORDER.includes(key as TierCalibration['tier'] | 'unknown')) {
      sortedEntries.push({ tier: key as TierCalibration['tier'] | 'unknown', usd: tierTotals[key] as number });
    }
  }

  const grandTotal = sortedEntries.reduce((acc, e) => acc + e.usd, 0);

  const rows = sortedEntries.map(({ tier, usd }) => {
    const pct = grandTotal > 0 ? `${((usd / grandTotal) * 100).toFixed(1)}%` : 'n/a';
    return [tier, fmtUsd(usd), pct];
  });

  const table = mdTable(['Tier', 'Cost USD', '% of total'], rows);

  return `## Cost by tier\n\n${table}`;
}

// ---------------------------------------------------------------------------
// renderCostByPmSession
// ---------------------------------------------------------------------------

/**
 * Renders one row per pm_sessions[] entry with cost + source flag.
 * Source flag is rendered as `(platform-captured)` or `(self-reported)` per AC-013.
 *
 * Returns a "no data" note when pmSessions is empty or undefined.
 */
export function renderCostByPmSession(pmSessions: PmSession[] | undefined): string {
  const sessions = pmSessions ?? [];

  if (sessions.length === 0) {
    return '## Cost by PM session\n\n_No PM session data available._';
  }

  const rows = sessions.map((s) => {
    const sourceLabel = s.source === 'platform_captured' ? '(platform-captured)' : '(self-reported)';
    const completedAt = s.completedAt ?? '—';
    return [s.sessionId, s.startedAt, completedAt, fmtUsd(s.usage.costUsd), sourceLabel];
  });

  const table = mdTable(
    ['Session ID', 'Started at', 'Completed at', 'Cost USD', 'Source'],
    rows,
  );

  const totalCost = sessions.reduce((acc, s) => acc + s.usage.costUsd, 0);
  const totalLine = `\n_Total PM cost: ${fmtUsd(totalCost)}_`;

  return `## Cost by PM session\n\n${table}${totalLine}`;
}

// ---------------------------------------------------------------------------
// renderDispatchWarnings — FEAT-006 T-009 (AC-007, AC-008)
// ---------------------------------------------------------------------------

/**
 * Renders the ## Warnings markdown section from dispatch warnings collected
 * by normaliseDispatchesWithWarnings (T-008).
 *
 * Each warning line format:
 *   - [<kind>] dispatch_id=<...>, task_id=<...>, role=<...>, status=<...>
 *
 * Returns null when warnings is empty or undefined (section is not emitted).
 * AC-008: the section is ONLY omitted when there are truly zero warnings —
 * it is never rendered as an empty section.
 */
export function renderDispatchWarnings(
  warnings: DispatchWarning[] | undefined,
): string | null {
  if (!warnings || warnings.length === 0) return null;

  const lines: string[] = ['## Warnings'];
  lines.push('');

  // Group by kind in canonical order: unknown_role, unknown_status, deprecated_status.
  const kindOrder: DispatchWarning['kind'][] = [
    'unknown_role',
    'unknown_status',
    'deprecated_status',
  ];

  for (const kind of kindOrder) {
    const group = warnings.filter((w) => w.kind === kind);
    if (group.length === 0) continue;

    for (const w of group) {
      const parts: string[] = [`[${w.kind}]`];

      parts.push(`dispatch_id=${w.dispatch_id}`);

      if (w.task_id) {
        parts.push(`task_id=${w.task_id}`);
      }

      if (w.kind === 'unknown_role') {
        parts.push(`role=${w.role}`);
        parts.push(`valid_roles=[${w.valid.join(', ')}]`);
      } else if (w.kind === 'unknown_status') {
        parts.push(`role=${w.role}`);
        parts.push(`status=${w.status}`);
        parts.push(`valid_statuses=[${w.valid.join(', ')}]`);
      } else if (w.kind === 'deprecated_status') {
        parts.push(`status=${w.status}`);
        parts.push(`note="${w.note}"`);
      }

      lines.push(`- ${parts.join(', ')}`);
    }
  }

  return lines.join('\n');
}
