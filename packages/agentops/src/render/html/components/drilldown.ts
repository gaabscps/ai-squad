/**
 * components/drilldown.ts — Drilldown sections for per-flow HTML report.
 * 5 collapsed <details> sections: Per-AC, Per-dispatch, Repo health, Findings, Phase durations.
 * Recomputes data directly from Session (D3/DD-1: invasive split skipped; inline HTML).
 * All dynamic values are HTML-escaped.
 */

import type { RepoHealth, Session } from '../../../types';
import { escape } from '../shared/escape';

/** Builds an HTML table from headers and rows */
function htmlTable(headers: string[], rows: string[][]): string {
  const ths = headers.map((h) => `<th>${escape(h)}</th>`).join('');
  const trs = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table>\n<thead><tr>${ths}</tr></thead>\n<tbody>\n${trs}\n</tbody>\n</table>`;
}

/** Wraps content in a <details> element (closed by default — no open attribute) */
function details(summary: string, content: string): string {
  return `<details>\n<summary>${escape(summary)}</summary>\n<div>${content}</div>\n</details>`;
}

/** Truncates a string to maxLen, appending '...' if needed */
function trunc(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
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

/** Gets evidence note for an AC from qa output packet */
function getAcEvidence(session: Session, acId: string): string {
  for (const d of session.dispatches) {
    if (d.role !== 'qa' || !d.outputPacket) continue;
    const acCov = d.outputPacket.ac_coverage;
    if (!Array.isArray(acCov)) continue;
    for (const entry of acCov) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        (entry as Record<string, unknown>).ac === acId
      ) {
        const ev = (entry as Record<string, unknown>).evidence;
        if (typeof ev === 'string') return escape(trunc(ev, 80));
      }
    }
  }
  return '—';
}

/** Section 1: Per-AC closure detail table */
function perAcSection(session: Session): string {
  if (session.acs.length === 0) {
    return '<p>(no ACs defined)</p>';
  }
  const sorted = [...session.acs].sort();
  const hasQa = session.dispatches.some((d) => d.role === 'qa');
  const validator = hasQa ? 'qa' : '—';

  const rows = sorted.map((acId) => {
    const qaResult = session.qaResults.find((r) => r.ac === acId);
    const status = qaResult ? qaResult.status : 'missing';
    const evidence = getAcEvidence(session, acId);
    return [escape(acId), escape(status), escape(validator), evidence];
  });

  return htmlTable(['AC ID', 'Status', 'Validator', 'Evidence'], rows);
}

/** Section 2: Per-dispatch breakdown table */
function perDispatchSection(session: Session): string {
  if (session.dispatches.length === 0) {
    return '<p>(no dispatches)</p>';
  }
  const sorted = [...session.dispatches].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const rows = sorted.map((d) => {
    const id = escape(trunc(d.dispatchId, 20));
    const role = escape(d.role);
    const status = escape(d.status);
    const loop = d.loop !== null ? String(d.loop) : '—';
    const tokens = d.usage ? String(d.usage.total_tokens) : '—';
    const duration = d.usage ? fmtMs(d.usage.duration_ms) : '—';
    const note = d.pmNote ? escape(trunc(d.pmNote, 60)) : '—';
    return [id, role, status, loop, tokens, duration, note];
  });
  return htmlTable(
    ['Dispatch ID', 'Role', 'Status', 'Loop', 'Tokens', 'Duration', 'PM note'],
    rows,
  );
}

/** Section 3: Repo health snapshot table */
function repoHealthSection(repoHealth: RepoHealth | null): string {
  if (repoHealth === null) {
    return (
      '<p>Repo health: not measured ' +
      '(run <code>npm run mutation &amp;&amp; npm run type-coverage &amp;&amp; npm run arch:check</code> first)</p>'
    );
  }

  const rows: string[][] = [];

  if (repoHealth.mutation !== null) {
    const score = repoHealth.mutation.score;
    const status = score >= 70 ? '✓' : score >= 63 ? '⚠' : '✗';
    rows.push(['Mutation score', `${score.toFixed(1)}%`, '≥ 70%', status]);
  } else {
    rows.push(['Mutation score', '—', '≥ 70%', '—']);
  }

  if (repoHealth.typeCoverage !== null) {
    const pct = repoHealth.typeCoverage.percent;
    const status = pct >= 95 ? '✓' : pct >= 85.5 ? '⚠' : '✗';
    rows.push(['Type coverage', `${pct.toFixed(1)}%`, '≥ 95%', status]);
    rows.push(['`any` count', String(repoHealth.typeCoverage.anyCount), '—', '—']);
  } else {
    rows.push(['Type coverage', '—', '≥ 95%', '—']);
  }

  if (repoHealth.depViolations !== null) {
    const errors = repoHealth.depViolations.error;
    rows.push([
      'Dep violations (error)',
      String(errors),
      '= 0',
      errors === 0 ? '✓' : errors <= 0 ? '⚠' : '✗',
    ]);
    rows.push(['Dep violations (warn)', String(repoHealth.depViolations.warn), '—', '—']);
  } else {
    rows.push(['Dep violations', '—', '= 0', '—']);
  }

  const measuredAt = repoHealth.measuredAt.slice(0, 10);
  return `<p><em>Measured at: ${escape(measuredAt)}</em></p>\n${htmlTable(['Métrica', 'Valor', 'Threshold', 'Status'], rows)}`;
}

/** Section 4: Reviewer findings */
function findingsSection(session: Session): string {
  const findings: string[] = [];
  for (const d of session.dispatches) {
    if (d.role !== 'code-reviewer' && d.role !== 'logic-reviewer') continue;
    if (!d.outputPacket) continue;
    const f = d.outputPacket.findings;
    if (Array.isArray(f)) {
      for (const item of f) {
        if (typeof item === 'string' && item.trim()) {
          findings.push(item);
        } else if (typeof item === 'object' && item !== null) {
          const msg = (item as Record<string, unknown>).message;
          if (typeof msg === 'string' && msg.trim()) findings.push(msg);
        }
      }
    }
  }
  if (findings.length === 0) {
    return '<p>(none)</p>';
  }
  const items = findings.map((f) => `<li>${escape(trunc(f, 200))}</li>`).join('\n');
  return `<ul>${items}</ul>`;
}

/** Section 5: Phase durations table */
function phaseDurationsSection(session: Session): string {
  const validPhases = session.phases.filter((p) => p.startedAt !== null);
  if (validPhases.length === 0) {
    return '<p>(no phase data available)</p>';
  }
  const sorted = [...validPhases].sort((a, b) =>
    (a.startedAt ?? '').localeCompare(b.startedAt ?? ''),
  );
  const rows = sorted.map((p) => {
    const start = p.startedAt ?? '—';
    const end = p.completedAt ?? 'running';
    let duration = 'running';
    if (p.startedAt && p.completedAt) {
      const ms = new Date(p.completedAt).getTime() - new Date(p.startedAt).getTime();
      duration = fmtMs(ms);
    }
    return [
      escape(p.name),
      escape(start.slice(11, 19)),
      escape(end.slice(0, 19).replace('T', ' ')),
      escape(duration),
      escape(p.status),
    ];
  });
  return htmlTable(['Phase', 'Started', 'Completed', 'Duration', 'Status'], rows);
}

/**
 * Renders the drilldown section with 5 collapsed <details> panels.
 * @param session - Enriched session data
 * @param repoHealth - Repo health snapshot, or null
 */
export function drilldown(session: Session, repoHealth: RepoHealth | null): string {
  const sections = [
    details('Per-AC closure detail', perAcSection(session)),
    details('Per-dispatch breakdown', perDispatchSection(session)),
    details('Repo health snapshot', repoHealthSection(repoHealth)),
    details('Reviewer findings', findingsSection(session)),
    details('Phase durations', phaseDurationsSection(session)),
  ];

  return `<section class="drilldown">
<h2>Drilldown</h2>
${sections.join('\n')}
</section>`;
}
