/**
 * Story-card format utilities — FEAT-005 T-002.
 * Pure functions for human-friendly display strings.
 */

/**
 * Accepts `null` (returns `'—'`), unlike the private formatDuration siblings
 * in flow-grid-card.ts and kpi-header.ts which require a non-null number.
 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
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

export function formatCost(usd: number | null): string {
  if (usd === null) return '—';
  return `$${usd.toFixed(2)}`;
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
