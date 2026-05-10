/**
 * flow-report/pm-notes.ts — PM notes log section (AC-030, T-019).
 * Chronological bullet list of non-empty pmNotes from dispatches.
 */

import type { Session } from '../../types';

/** Truncates a string to maxLen chars with link to manifest entry */
function truncNote(s: string, maxLen: number, dispatchId: string): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + `... (see manifest entry ${dispatchId})`;
}

/** Formats ISO timestamp to YYYY-MM-DD HH:MM */
function fmtTimestamp(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * Renders the PM notes log section (AC-030).
 * Bullet list ordered by dispatch.startedAt ascending.
 * Format: `- [<timestamp> <role>] <note>` (notes > 200 chars truncated).
 */
export function renderPmNotesLog(session: Session): string {
  // Filter dispatches with non-empty pmNote, sorted by startedAt
  const withNotes = [...session.dispatches]
    .filter((d) => d.pmNote !== null && d.pmNote.trim() !== '')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  if (withNotes.length === 0) {
    return '## PM notes log\n\n_(no PM notes recorded)_';
  }

  const bullets = withNotes.map((d) => {
    const timestamp = fmtTimestamp(d.startedAt);
    const note = truncNote(d.pmNote!, 200, d.dispatchId);
    return `- [${timestamp} ${d.role}] ${note}`;
  });

  return `## PM notes log\n\n${bullets.join('\n')}`;
}
