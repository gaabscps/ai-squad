/**
 * measure/findings.ts — AC closure and reviewer findings metric sub-functions.
 * All functions are pure (no I/O, no Date.now(), no random).
 */

import type { Session } from '../types';

interface AcClosure {
  total: number;
  pass: number;
  partial: number;
  fail: number;
  missing: number;
}

interface ReviewerFindings {
  critical: number;
  major: number;
  minor: number;
}

/**
 * Computes AC closure summary:
 * - total: ACs declared in spec.md
 * - pass/partial/fail: from qaResults
 * - missing: ACs in spec but not covered by any qa result
 */
export function computeAcClosureSummary(session: Session): AcClosure {
  const total = session.acs.length;
  let pass = 0;
  let partial = 0;
  let fail = 0;

  for (const result of session.qaResults) {
    if (result.status === 'pass') pass++;
    else if (result.status === 'partial') partial++;
    else if (result.status === 'fail') fail++;
  }

  const coveredAcs = new Set(session.qaResults.map((r) => r.ac));
  const missing = session.acs.filter((ac) => !coveredAcs.has(ac)).length;

  return { total, pass, partial, fail, missing };
}

/**
 * Returns reviewer findings density aggregated across all reviewer dispatches.
 * Returns null if there are no code-reviewer or logic-reviewer dispatches.
 */
export function computeReviewerFindings(session: Session): ReviewerFindings | null {
  const reviewerDispatches = session.dispatches.filter(
    (d) => d.role === 'code-reviewer' || d.role === 'logic-reviewer',
  );
  if (reviewerDispatches.length === 0) return null;

  const totals: ReviewerFindings = { critical: 0, major: 0, minor: 0 };

  for (const d of reviewerDispatches) {
    if (!d.outputPacket) continue;
    const findings = d.outputPacket.findings;
    if (!Array.isArray(findings)) continue;
    for (const finding of findings) {
      if (typeof finding !== 'object' || finding === null) continue;
      const f = finding as Record<string, unknown>;
      const severity = f.severity;
      if (severity === 'critical') totals.critical++;
      else if (severity === 'major') totals.major++;
      else if (severity === 'minor') totals.minor++;
    }
  }

  return totals;
}
