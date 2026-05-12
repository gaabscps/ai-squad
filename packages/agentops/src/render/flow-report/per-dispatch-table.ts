/**
 * flow-report/per-dispatch-table.ts — Per-dispatch breakdown table (AC-026, T-015).
 * 1 row per dispatch, ordered by started_at ascending.
 */

import { ANTHROPIC_PRICING_2026 } from '../../constants';
import type { Session } from '../../types';
import { mdTable } from './utils';

/** Truncates a string to maxLen chars, appending '...' if truncated */
function trunc(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

/** Formats milliseconds as human-readable duration */
function fmtMs(ms: number): string {
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

/** Computes USD cost for a single dispatch. Uses pre-computed cost_usd when available. */
function dispatchCostUsd(
  usage: { total_tokens: number; model: string; cost_usd?: number } | undefined,
): string {
  if (!usage) return '—';
  if (usage.cost_usd !== undefined) return `$${usage.cost_usd.toFixed(4)}`;
  if (usage.model === 'unknown') return '—';
  const pricing =
    usage.model === 'opus-4-7'
      ? ANTHROPIC_PRICING_2026['opus-4-7']
      : usage.model === 'sonnet-4-6'
        ? ANTHROPIC_PRICING_2026['sonnet-4-6']
        : usage.model === 'haiku-4-5'
          ? ANTHROPIC_PRICING_2026['haiku-4-5']
          : null;
  if (!pricing) return '—';
  const input = usage.total_tokens * 0.7;
  const output = usage.total_tokens * 0.3;
  const usd =
    (input / 1_000_000) * pricing.input_per_mtok_usd +
    (output / 1_000_000) * pricing.output_per_mtok_usd;
  return `$${usd.toFixed(4)}`;
}

/**
 * Renders the Per-dispatch breakdown section (AC-026).
 * Columns: dispatch_id (trunc 12), role, status, loop, tokens, $, duration, pm_note (trunc 80).
 * Ordered by started_at ascending.
 */
export function renderPerDispatchTable(session: Session): string {
  if (session.dispatches.length === 0) {
    return '## Per-dispatch breakdown\n\n_(no dispatches)_';
  }

  const sorted = [...session.dispatches].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  const headers = ['ID', 'Role', 'Status', 'Loop', 'Tokens', '$', 'Duration', 'PM note'];
  const rows = sorted.map((d) => {
    const id = trunc(d.dispatchId, 12);
    const loop = d.loop !== null ? String(d.loop) : '—';
    const tokens = d.usage ? String(d.usage.total_tokens) : '—';
    const usd = dispatchCostUsd(d.usage);
    const duration = d.usage
      ? fmtMs(d.usage.duration_ms)
      : d.completedAt && d.startedAt
        ? fmtMs(new Date(d.completedAt).getTime() - new Date(d.startedAt).getTime())
        : '—';
    const note = d.pmNote ? trunc(d.pmNote, 80) : '—';
    return [id, d.role, d.status, loop, tokens, usd, duration, note];
  });

  const table = mdTable(headers, rows);
  return `## Per-dispatch breakdown\n\n${table}`;
}
