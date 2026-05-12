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

  // Deduplicate: same AC may appear in multiple QA packets. Take the best status per AC
  // (pass > partial > fail) so counts don't exceed total.
  const STATUS_RANK: Record<string, number> = { pass: 2, partial: 1, fail: 0 };
  const byAc = new Map<string, 'pass' | 'partial' | 'fail'>();
  for (const result of session.qaResults) {
    const existing = byAc.get(result.ac);
    const newRank = STATUS_RANK[result.status] ?? -1;
    const existRank = existing !== undefined ? (STATUS_RANK[existing] ?? -1) : -1;
    if (!existing || newRank > existRank) {
      byAc.set(result.ac, result.status);
    }
  }

  let pass = 0;
  let partial = 0;
  let fail = 0;
  for (const status of byAc.values()) {
    if (status === 'pass') pass++;
    else if (status === 'partial') partial++;
    else if (status === 'fail') fail++;
  }

  const coveredAcs = new Set(byAc.keys());
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
