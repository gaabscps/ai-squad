/**
 * flow-report/existing-sections.ts — Phase durations, Dispatches by role,
 * Task success rate, Loop rate, Escalation rate, AC closure, Reviewer findings,
 * Token cost.
 * Extracted from flow-report.ts (T-013 refactor). Byte-identical output.
 */

import { GALILEO_HEALTHY_ESCALATION_BAND } from '../../constants';
import type { Metrics, Role } from '../../types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const ALL_ROLES: Role[] = [
  'audit-agent',
  'blocker-specialist',
  'code-reviewer',
  'dev',
  'logic-reviewer',
  'pm-orchestrator',
  'qa',
];

/** Returns Galileo band classification label for an escalation rate (0..1) */
function escalationBandLabel(rate: number): string {
  if (rate < GALILEO_HEALTHY_ESCALATION_BAND.lower) {
    return `below healthy band (< ${GALILEO_HEALTHY_ESCALATION_BAND.lower * 100}%)`;
  }
  if (rate > GALILEO_HEALTHY_ESCALATION_BAND.upper) {
    return `above healthy band (> ${GALILEO_HEALTHY_ESCALATION_BAND.upper * 100}%)`;
  }
  return `in healthy band (${GALILEO_HEALTHY_ESCALATION_BAND.lower * 100}–${GALILEO_HEALTHY_ESCALATION_BAND.upper * 100}%)`;
}

/** Formats a number as a percentage string rounded to 1 decimal */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Formats a phase duration value */
function formatDuration(value: number | 'running' | 'not_started'): string {
  if (value === 'running') return 'running';
  if (value === 'not_started') return '—';
  return `${value} min`;
}

/** Formats a task success rate value (number | null) */
function formatRate(value: number | null): string {
  if (value === null) return 'n/a';
  return pct(value);
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

// ---------------------------------------------------------------------------
// Section renderers (public — called by index.ts orchestrator)
// ---------------------------------------------------------------------------

export function renderPhaseDurations(phaseDurations: Metrics['phaseDurations']): string {
  const phases = ['specify', 'plan', 'tasks', 'implementation'];
  const rows = phases.map((phase) => {
    const val: number | 'running' | 'not_started' = phaseDurations[phase] ?? 'not_started';
    return [phase, formatDuration(val)];
  });
  const table = mdTable(['Phase', 'Duration'], rows);
  return `## Phase durations\n\n${table}`;
}

export function renderDispatches(metrics: Metrics): string {
  const rows = ALL_ROLES.map((role) => [role, String(metrics.dispatchesByRole[role] ?? 0)]);
  rows.push(['**Total**', String(metrics.totalDispatches)]);
  const table = mdTable(['Role', 'Dispatches'], rows);
  return `## Dispatches\n\n${table}`;
}

export function renderTaskSuccessRate(taskSuccessRate: Metrics['taskSuccessRate']): string {
  const rows = ALL_ROLES.map((role) => [role, formatRate(taskSuccessRate[role] ?? null)]);
  const table = mdTable(['Role', 'Task success rate'], rows);
  return `## Task success rate\n\n${table}`;
}

export function renderLoopRate(loopRate: number): string {
  return `## Loop rate\n\nLoop rate: ${pct(loopRate)}`;
}

export function renderEscalationRate(escalationRate: number): string {
  const band = escalationBandLabel(escalationRate);
  return `## Escalation rate\n\nEscalation rate: ${pct(escalationRate)} — ${band}`;
}

export function renderAcClosure(acClosure: Metrics['acClosure']): string {
  const { total, pass, partial, fail, missing } = acClosure;
  return `## AC closure\n\nTotal: ${total} | Pass: ${pass} | Partial: ${partial} | Fail: ${fail} | Missing: ${missing}`;
}

export function renderReviewerFindings(findings: Metrics['reviewerFindings']): string | null {
  if (findings === null) return null;
  const rows = [
    ['critical', String(findings.critical)],
    ['major', String(findings.major)],
    ['minor', String(findings.minor)],
  ];
  const table = mdTable(['Severity', 'Count'], rows);
  return `## Reviewer findings density\n\n${table}`;
}

export function renderTokenCost(tokenCost: Metrics['tokenCost'], totalDispatches: number): string {
  if (tokenCost.total !== null) {
    const perAcStr = tokenCost.perAc !== null ? ` | Tokens/AC: ${tokenCost.perAc.toFixed(0)}` : '';
    return `## Token cost\n\nTotal tokens: ${tokenCost.total}${perAcStr}`;
  }
  return `## Token cost\n\nToken cost not available — using dispatch count as cost proxy: ${totalDispatches} dispatches`;
}
