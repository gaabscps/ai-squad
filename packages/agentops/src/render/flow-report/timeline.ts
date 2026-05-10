/**
 * flow-report/timeline.ts — Timeline section with ASCII bar chart (AC-029, T-018).
 * Shows phase/batch durations proportionally.
 */

import type { Session } from '../../types';

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

/** Formats milliseconds as human-readable duration */
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

/** Formats ISO timestamp to HH:MM:SS */
function fmtTime(iso: string): string {
  return iso.slice(11, 19);
}

/** Generates ASCII bar proportional to fraction (0..1), width=10 */
function asciiBar(fraction: number, width = 10): string {
  const filled = Math.round(fraction * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Renders the Timeline section (AC-029).
 * ASCII bar chart showing relative phase durations.
 * Columns: Phase | Started | Completed | Duration | Visual
 */
export function renderTimeline(session: Session): string {
  if (session.phases.length === 0) {
    return '## Timeline\n\n_(no phase data available)_';
  }

  // Filter phases with at least a startedAt
  const validPhases = session.phases.filter((p) => p.startedAt !== null);
  if (validPhases.length === 0) {
    return '## Timeline\n\n_(no phase data available)_';
  }

  // Sort by startedAt
  const sorted = [...validPhases].sort((a, b) => {
    return (a.startedAt ?? '').localeCompare(b.startedAt ?? '');
  });

  // Compute durations in ms
  interface PhaseWithDuration {
    name: string;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
  }

  const phasesWithDuration: PhaseWithDuration[] = sorted.map((p) => {
    const start = new Date(p.startedAt!).getTime();
    const end = p.completedAt ? new Date(p.completedAt).getTime() : null;
    const durationMs = end !== null ? end - start : null;
    return { name: p.name, startedAt: p.startedAt!, completedAt: p.completedAt, durationMs };
  });

  // Find max duration for proportional bar
  const maxMs = Math.max(
    ...phasesWithDuration.map((p) => p.durationMs).filter((d): d is number => d !== null),
    1,
  );

  const headers = ['Phase', 'Started', 'Completed', 'Duration', 'Visual'];
  const rows = phasesWithDuration.map((p) => {
    const started = fmtTime(p.startedAt);
    const completed = p.completedAt ? fmtTime(p.completedAt) : 'running';
    const duration = p.durationMs !== null ? fmtMs(p.durationMs) : 'running';
    const bar = p.durationMs !== null ? asciiBar(p.durationMs / maxMs) : '░░░░░░░░░░';
    return [p.name, started, completed, duration, bar];
  });

  const table = mdTable(headers, rows);
  return `## Timeline\n\n${table}`;
}
