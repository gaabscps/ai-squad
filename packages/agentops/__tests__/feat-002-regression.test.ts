/**
 * Regression tests for FEAT-002 T-011 — AC-004, AC-010.
 *
 * Three fixture sessions cover the FEAT-009/010/011 failure shapes:
 *
 *   (a) FEAT-FIXT-MISSING-QA: qa dispatch in manifest but no outputs/<id>-qa-*.json.
 *       Metric: acClosure.missing > 0 (spec ACs not covered by qaResults).
 *       Reporter: ac_coverage column reflects missing coverage, not silently "0/0/0".
 *
 *   (b) FEAT-FIXT-EMPTY-FINDINGS: reviewer wrote findings: [] explicitly.
 *       Metric: reviewerFindings = { critical: 0, major: 0, minor: 0 }.
 *       Reporter: renders "0 / 0 / 0" legitimately; no warning emitted.
 *
 *   (c) FEAT-FIXT-NO-WORKTREE-HOOK: no pm_orchestrator_sessions[] in manifest,
 *       no pm_orchestrator_session_warnings[].
 *       renderTokenCost called with empty arrays → emits the Stop hook hint line.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { measure, computeReviewerFindings, computeAcClosureSummary } from '../src/measure';
import { parse } from '../src/parse';
import { renderTokenCost } from '../src/render/flow-report/existing-sections';
import { renderReviewerFindings, renderAcClosure } from '../src/render/flow-report/existing-sections';
import type { Metrics } from '../src/types';

// ---------------------------------------------------------------------------
// Fixture root
// ---------------------------------------------------------------------------

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */

const FIXT_MISSING_QA = path.join(FIXTURES_ROOT, 'FEAT-FIXT-MISSING-QA');
const FIXT_EMPTY_FINDINGS = path.join(FIXTURES_ROOT, 'FEAT-FIXT-EMPTY-FINDINGS');
const FIXT_NO_WORKTREE_HOOK = path.join(FIXTURES_ROOT, 'FEAT-FIXT-NO-WORKTREE-HOOK');

// ---------------------------------------------------------------------------
// Helper: parse → enrich → measure pipeline
// ---------------------------------------------------------------------------

async function metricsForFixture(fixturePath: string): Promise<Metrics> {
  const raw = await parse(fixturePath);
  const session = enrich(raw);
  return measure(session);
}

// ---------------------------------------------------------------------------
// Fixture (a): FEAT-FIXT-MISSING-QA
// qa dispatch is listed in manifest but outputs/qa-1.json does not exist.
// Expected: acClosure.missing > 0 because qaResults will be empty (no qa output).
// AC-004: reporter must surface the gap, not silently render all-pass.
// ---------------------------------------------------------------------------

describe('FEAT-FIXT-MISSING-QA — AC-004, AC-010', () => {
  let metrics: Metrics;

  beforeAll(async () => {
    metrics = await metricsForFixture(FIXT_MISSING_QA);
  });

  it('parses the fixture without throwing', () => {
    expect(metrics).toBeDefined();
    expect(metrics.taskId).toBe('FEAT-FIXT-MISSING-QA');
  });

  it('reports dispatch count including qa dispatch', () => {
    // 4 dispatches: dev-1, code-reviewer-1, qa-1 (listed), audit-agent-1
    expect(metrics.totalDispatches).toBeGreaterThanOrEqual(3);
  });

  it('has non-zero acClosure.missing because qa output packet is absent', () => {
    // spec.md declares 3 ACs; qaResults is empty (no qa output file) → all 3 are missing
    expect(metrics.acClosure.total).toBe(3);
    expect(metrics.acClosure.missing).toBe(3);
    expect(metrics.acClosure.pass).toBe(0);
  });

  it('renderAcClosure output is NOT silently all-pass — missing count is visible', () => {
    const rendered = renderAcClosure(metrics.acClosure);
    // Must NOT read "Missing: 0" — the gap must surface
    expect(rendered).not.toContain('Missing: 0');
    expect(rendered).toContain('Missing: 3');
  });

  it('does NOT render — in acClosure (values are real numbers, not dashes)', () => {
    const rendered = renderAcClosure(metrics.acClosure);
    // renderAcClosure never emits "—" for numeric fields; verifies no fallback
    expect(rendered).not.toContain('—');
  });

  it('dispatch_id "qa-1" is present in the manifest dispatches', () => {
    // The qa dispatch IS in the manifest (it was dispatched) but has no output packet
    const qaDispatch = metrics.dispatchesByRole['qa'];
    expect(qaDispatch).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fixture (b): FEAT-FIXT-EMPTY-FINDINGS
// Reviewer wrote findings: [] explicitly — clean code, no issues found.
// Expected: reviewerFindings = { critical: 0, major: 0, minor: 0 }.
// AC-004: report renders 0/0/0 legitimately, no warning emitted.
// ---------------------------------------------------------------------------

describe('FEAT-FIXT-EMPTY-FINDINGS — AC-004, AC-010', () => {
  let metrics: Metrics;

  beforeAll(async () => {
    metrics = await metricsForFixture(FIXT_EMPTY_FINDINGS);
  });

  it('parses the fixture without throwing', () => {
    expect(metrics).toBeDefined();
    expect(metrics.taskId).toBe('FEAT-FIXT-EMPTY-FINDINGS');
  });

  it('reviewerFindings is non-null (reviewer dispatch ran)', () => {
    // code-reviewer-1 dispatch exists with findings: [] → must return object, not null
    expect(metrics.reviewerFindings).not.toBeNull();
  });

  it('reviewerFindings shows 0 critical, 0 major, 0 minor (explicit empty is valid)', () => {
    expect(metrics.reviewerFindings).toEqual({
      critical: 0,
      major: 0,
      minor: 0,
    });
  });

  it('renderReviewerFindings renders 0/0/0 — not missing or absent', () => {
    const rendered = renderReviewerFindings(metrics.reviewerFindings);
    expect(rendered).not.toBeNull();
    // All three severity rows render with value "0"
    expect(rendered).toContain('| critical | 0 |');
    expect(rendered).toContain('| major | 0 |');
    expect(rendered).toContain('| minor | 0 |');
  });

  it('renderReviewerFindings does not contain warning or error text', () => {
    const rendered = renderReviewerFindings(metrics.reviewerFindings);
    expect(rendered).not.toContain('⚠');
    expect(rendered).not.toContain('missing');
    expect(rendered).not.toContain('warning');
  });

  it('AC closure shows all ACs covered (qa output packet present)', () => {
    // 2 ACs declared in spec.md, both covered by qa-1.json
    expect(metrics.acClosure.total).toBe(2);
    expect(metrics.acClosure.pass).toBe(2);
    expect(metrics.acClosure.missing).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture (c): FEAT-FIXT-NO-WORKTREE-HOOK
// Manifest has no pm_orchestrator_sessions[] and no pm_orchestrator_session_warnings[].
// renderTokenCost called with empty arrays → emits the Stop hook hint line (AC-007 / T-007).
// AC-010: must NOT silently render cost-proxy fallback without the visible hint.
// ---------------------------------------------------------------------------

describe('FEAT-FIXT-NO-WORKTREE-HOOK — AC-010 (Stop hook hint)', () => {
  let metrics: Metrics;

  beforeAll(async () => {
    metrics = await metricsForFixture(FIXT_NO_WORKTREE_HOOK);
  });

  it('parses the fixture without throwing', () => {
    expect(metrics).toBeDefined();
    expect(metrics.taskId).toBe('FEAT-FIXT-NO-WORKTREE-HOOK');
  });

  it('no pm-orchestrator dispatches (no pm_orchestrator_sessions in manifest)', () => {
    // Manifest has no pm_orchestrator_sessions[] → no virtual pm-orchestrator dispatches
    expect(metrics.dispatchesByRole['pm-orchestrator']).toBe(0);
  });

  it('tokenCost.total is null (no output packets with token data)', () => {
    // dev-1 and qa-1 output packets have no usage fields → tokenCost is null
    expect(metrics.tokenCost.total).toBeNull();
  });

  it('renderTokenCost with empty pm arrays emits the Stop hook hint line', () => {
    // Simulate the T-007 path: caller provides empty pmSessions and pmWarnings
    const rendered = renderTokenCost(metrics.tokenCost, metrics.totalDispatches, [], []);
    expect(rendered).toContain('pm-orchestrator Stop hook did not run');
    expect(rendered).toContain('install-hooks');
  });

  it('renderTokenCost hint line starts with ⚠', () => {
    const rendered = renderTokenCost(metrics.tokenCost, metrics.totalDispatches, [], []);
    expect(rendered).toContain('⚠ pm-orchestrator Stop hook did not run');
  });

  it('renderTokenCost also emits the cost-proxy fallback (not silently empty)', () => {
    const rendered = renderTokenCost(metrics.tokenCost, metrics.totalDispatches, [], []);
    expect(rendered).toContain('cost proxy');
    expect(rendered).toContain(`${metrics.totalDispatches} dispatches`);
  });

  it('renderTokenCost does NOT emit PM session capture warning header (only hint)', () => {
    const rendered = renderTokenCost(metrics.tokenCost, metrics.totalDispatches, [], []);
    // The hint line is different from the warning header — no warning header in scenario (c)
    expect(rendered).not.toContain('PM session capture warning');
  });

  it('AC closure is populated (qa output packet present)', () => {
    expect(metrics.acClosure.total).toBe(2);
    expect(metrics.acClosure.pass).toBe(2);
    expect(metrics.acClosure.missing).toBe(0);
  });
});
