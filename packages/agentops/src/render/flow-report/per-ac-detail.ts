/**
 * flow-report/per-ac-detail.ts — Per-AC closure detail table (AC-027, T-016).
 * 1 row per AC, ordered by AC ID alphabetically.
 */

import type { Session } from '../../types';

/** Truncates a string to maxLen chars, appending '...' if truncated */
function trunc(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
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

/** Gets evidence note for an AC from qa output packet */
function getEvidence(session: Session, acId: string): string {
  for (const d of session.dispatches) {
    if (d.role !== 'qa') continue;
    if (!d.outputPacket) continue;
    const acCov = d.outputPacket.ac_coverage;
    if (!Array.isArray(acCov)) continue;
    for (const entry of acCov) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).ac === acId
      ) {
        const ev = (entry as Record<string, unknown>).evidence;
        if (typeof ev === 'string') return trunc(ev, 100);
      }
    }
  }
  return '—';
}

/**
 * Renders the Per-AC closure detail section (AC-027).
 * Columns: AC ID, status (pass/partial/fail/missing), validator, evidence (trunc 100).
 * Ordered by AC ID ascending.
 */
export function renderPerAcDetail(session: Session): string {
  if (session.acs.length === 0) {
    return '## Per-AC closure detail\n\n_(no ACs defined)_';
  }

  const sorted = [...session.acs].sort();

  const headers = ['AC ID', 'Status', 'Validator', 'Evidence'];
  const rows = sorted.map((acId) => {
    const qaResult = session.qaResults.find((r) => r.ac === acId);
    const status = qaResult ? qaResult.status : 'missing';

    // Determine validator role (qa if there's a qa dispatch, manual otherwise)
    const hasQaDispatch = session.dispatches.some((d) => d.role === 'qa');
    const validator = hasQaDispatch ? 'qa' : '—';

    const evidence = getEvidence(session, acId);
    return [acId, status, validator, evidence];
  });

  const table = mdTable(headers, rows);
  return `## Per-AC closure detail\n\n${table}`;
}
