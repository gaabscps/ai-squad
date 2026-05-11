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

/** Shape of a PM session warning entry written by capture-pm-session.ts (AC-007). */
export interface PmSessionWarning {
  reason: string;
  timestamp: string;
  session_id: string;
}

/**
 * Renders the Token cost section with three distinct paths:
 *
 * (a) `pmSessions` populated AND `pmWarnings` empty → real "Total tokens / Tokens per AC" line.
 * (b) `pmWarnings` non-empty → prepend a warning header; render cost line if sessions exist,
 *     otherwise fall back to dispatch-count proxy.
 * (c) `pmSessions` empty AND `pmWarnings` empty → dispatch-count proxy PLUS a brief hint line
 *     so future Stop-hook regressions are immediately visible.
 *
 * When called without `pmSessions`/`pmWarnings` (existing call sites), falls back to the
 * legacy two-branch logic determined by `tokenCost.total`.
 */
export function renderTokenCost(
  tokenCost: Metrics['tokenCost'],
  totalDispatches: number,
  pmSessions?: unknown[],
  pmWarnings?: PmSessionWarning[],
): string {
  const hasSessions = Array.isArray(pmSessions) && pmSessions.length > 0;
  const hasWarnings = Array.isArray(pmWarnings) && pmWarnings.length > 0;
  const newParamsPassed = Array.isArray(pmSessions) && Array.isArray(pmWarnings);

  // Build the real cost line (used in paths a and b-with-sessions)
  const realCostLine =
    tokenCost.total !== null
      ? `Total tokens: ${tokenCost.total}${tokenCost.perAc !== null ? ` | Tokens/AC: ${tokenCost.perAc.toFixed(0)}` : ''}`
      : null;

  // Proxy fallback line (used in paths b-without-sessions and c)
  const proxyLine = `Token cost not available — using dispatch count as cost proxy: ${totalDispatches} dispatches`;

  // Hint line appended in path (c) only
  const hintLine =
    '⚠ pm-orchestrator Stop hook did not run — re-run agentops install-hooks (worktree-aware)';

  // --- Path (b): warnings present ---
  if (newParamsPassed && hasWarnings) {
    const warningHeader = `⚠ PM session capture warning: ${pmWarnings![0]!.reason}`;
    const costContent = realCostLine ?? proxyLine;
    return `## Token cost\n\n${warningHeader}\n\n${costContent}`;
  }

  // --- Path (a): sessions present, no warnings ---
  if (newParamsPassed && hasSessions && !hasWarnings) {
    return `## Token cost\n\n${realCostLine ?? proxyLine}`;
  }

  // --- Path (c): sessions empty, no warnings (new params passed) ---
  if (newParamsPassed && !hasSessions && !hasWarnings) {
    return `## Token cost\n\n${proxyLine}\n\n${hintLine}`;
  }

  // --- Legacy fallback: called without new params ---
  if (realCostLine !== null) {
    return `## Token cost\n\n${realCostLine}`;
  }
  return `## Token cost\n\n${proxyLine}`;
}
