/**
 * flow-report/index.ts — Orchestrator for per-flow Markdown report (T-020).
 * Assembles 14 sections in the revised order per Plan D10 / UX-1.
 *
 * Section order:
 *  1. Header (feature name + status + Insights)
 *  2. Cost breakdown
 *  3. Repo health snapshot
 *  4. Per-dispatch breakdown
 *  5. Per-AC closure detail
 *  6. Phase durations
 *  7. Timeline
 *  8. Dispatches by role
 *  9. Task success rate
 * 10. Loop rate
 * 11. Escalation rate
 * 12. AC closure summary
 * 13. Reviewer findings
 * 14. PM notes log
 */

import type { DispatchWarning } from '../../enrich/dispatches';
import type { Insight, Metrics, RepoHealth, Session } from '../../types';

import { renderCostBreakdownFull } from './cost-breakdown';
import {
  renderPhaseDurations,
  renderDispatches,
  renderTaskSuccessRate,
  renderLoopRate,
  renderEscalationRate,
  renderAcClosure,
  renderReviewerFindings,
  renderTokenCost,
  type PmSessionWarning,
} from './existing-sections';
import { renderHeader } from './header';
import { renderPerAcDetail } from './per-ac-detail';
import { renderPerDispatchTable } from './per-dispatch-table';
import { renderPmNotesLog } from './pm-notes';
import { renderRepoHealthSnapshot } from './repo-health-snapshot';
import { renderTimeline } from './timeline';
import { renderDispatchWarnings } from '../report';

/**
 * Renders a complete per-flow Markdown report with all 14 sections.
 *
 * @param metrics          - Computed metrics for the session.
 * @param insights         - Insight rules output.
 * @param generatedAt      - ISO timestamp string for the "Generated at" line.
 * @param featureName      - Human-readable feature name.
 * @param currentPhase     - Current pipeline phase.
 * @param session          - Optional full session for rich sections (per-dispatch, per-AC, timeline, PM notes).
 * @param repoHealth       - Optional repo health snapshot (AC-028).
 * @param pmWarnings       - Optional PM session capture warnings (AC-007); surfaced in header.
 * @param dispatchWarnings - Optional dispatch normalisation warnings (FEAT-006 T-009 / AC-007, AC-008);
 *                          renders ## Warnings section when non-empty.
 */
export function renderFlowReport(
  metrics: Metrics,
  insights: Insight[],
  generatedAt: string,
  featureName: string,
  currentPhase: string,
  session?: Session,
  repoHealth?: RepoHealth | null,
  pmWarnings?: PmSessionWarning[],
  dispatchWarnings?: DispatchWarning[],
): string {
  const sections: string[] = [];

  // Derive pmSessions from synthesized pm-orchestrator dispatches in session (AC-006 / f-lr-001).
  // A pm-orchestrator dispatch exists iff the Stop hook captured a session entry.
  const pmSessions = session?.dispatches.filter((d) => d.role === 'pm-orchestrator') ?? [];

  // 1. Header (H1 + status block + Insights + AC-007 warning when present)
  sections.push(renderHeader(metrics, insights, generatedAt, featureName, currentPhase, pmWarnings));

  // 2. Cost breakdown
  const dispatches = session?.dispatches ?? [];
  sections.push(renderCostBreakdownFull(metrics, dispatches));

  // 3. Repo health snapshot
  const rh = repoHealth !== undefined ? repoHealth : (metrics.repoHealth ?? null);
  sections.push(renderRepoHealthSnapshot(rh));

  // 4. Per-dispatch breakdown (requires session)
  if (session) {
    sections.push(renderPerDispatchTable(session));
  }

  // 5. Per-AC closure detail (requires session)
  if (session) {
    sections.push(renderPerAcDetail(session));
  }

  // 6. Phase durations
  sections.push(renderPhaseDurations(metrics.phaseDurations));

  // 7. Timeline (requires session)
  if (session) {
    sections.push(renderTimeline(session));
  }

  // 8. Dispatches by role
  sections.push(renderDispatches(metrics));

  // 9. Task success rate
  sections.push(renderTaskSuccessRate(metrics.taskSuccessRate));

  // 10. Loop rate
  sections.push(renderLoopRate(metrics.loopRate));

  // 11. Escalation rate
  sections.push(renderEscalationRate(metrics.escalationRate));

  // 12. AC closure summary
  sections.push(renderAcClosure(metrics.acClosure));

  // 13. Reviewer findings (omit if null)
  const findingsSection = renderReviewerFindings(metrics.reviewerFindings);
  if (findingsSection !== null) {
    sections.push(findingsSection);
  }

  // 14. PM notes log (requires session)
  if (session) {
    sections.push(renderPmNotesLog(session));
  }

  // 15. Dispatch warnings — FEAT-006 T-009 (AC-007, AC-008).
  // Rendered only when dispatchWarnings is non-empty; omitted entirely when empty or undefined.
  const warningsSection = renderDispatchWarnings(dispatchWarnings);
  if (warningsSection !== null) {
    sections.push(warningsSection);
  }

  // Token cost — forward pmSessions and pmWarnings so AC-006/AC-007 paths are reachable.
  // Only activate the new-params paths when pmWarnings was explicitly passed by the caller
  // (i.e., not undefined). When undefined, use legacy two-branch fallback so existing
  // call sites that omit pmWarnings are unaffected.
  if (pmWarnings !== undefined) {
    sections.push(
      renderTokenCost(metrics.tokenCost, metrics.totalDispatches, pmSessions, pmWarnings),
    );
  } else {
    sections.push(renderTokenCost(metrics.tokenCost, metrics.totalDispatches));
  }

  return sections.join('\n\n') + '\n';
}
