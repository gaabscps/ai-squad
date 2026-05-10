/**
 * __tests__/flow-report.test.ts — Tests for per-flow HTML page orchestrator.
 * Covers: AC-001, AC-002, AC-003, AC-006, AC-009, AC-010, AC-012, AC-021, AC-022
 */

import type { CostMetric, RepoHealth, Session } from '../../../types';
import { renderFlowHtml } from '../flow-report';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-002',
    featureName: 'AgentOps render',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'done',
    startedAt: '2026-01-02T09:00:00Z',
    completedAt: '2026-01-02T14:45:00Z',
    phases: [
      {
        name: 'implementation',
        startedAt: '2026-01-02T09:00:00Z',
        completedAt: '2026-01-02T14:45:00Z',
        status: 'done',
      },
    ],
    dispatches: [
      {
        dispatchId: 'feat-002-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-02T09:00:00Z',
        completedAt: '2026-01-02T10:30:00Z',
        outputPacket: null,
        loop: 0,
        pmNote: 'BATCH-A done. Setup complete.',
      },
      {
        dispatchId: 'feat-002-batch-b-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-02T10:30:00Z',
        completedAt: '2026-01-02T14:45:00Z',
        outputPacket: null,
        loop: 0,
        pmNote: 'BATCH-B done. Core components implemented.',
      },
    ],
    acs: ['AC-001', 'AC-002', 'AC-003'],
    qaResults: [
      { ac: 'AC-001', status: 'pass' },
      { ac: 'AC-002', status: 'pass' },
      { ac: 'AC-003', status: 'pass' },
    ],
    expectedPipeline: [],
    escalationMetrics: null,
    ...overrides,
  };
}

function makeRepoHealth(): RepoHealth {
  return {
    mutation: { score: 70.7, killed: 141, total: 200 },
    typeCoverage: { percent: 97.83, anyCount: 4 },
    depViolations: { error: 0, warn: 1 },
    measuredAt: '2026-01-02T15:00:00Z',
  };
}

function makeCost(): CostMetric {
  return {
    total_usd: 3.34,
    per_ac_usd: 1.11,
    per_dispatch_avg_usd: 1.67,
    coverage: { included: 2, total: 2 },
    assumption_note: '70/30 split assumed',
  };
}

const SAMPLE_MD = `# FEAT-002 AgentOps render

## Summary

This flow implemented AgentOps rendering.

## Per-dispatch breakdown

| Dispatch | Status |
|----------|--------|
| feat-002-batch-a-dev | done |
`;

describe('renderFlowHtml', () => {
  let result: string;

  beforeEach(() => {
    result = renderFlowHtml(makeSession(), makeRepoHealth(), makeCost(), SAMPLE_MD);
  });

  it('returns a complete HTML5 document', () => {
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<html');
    expect(result).toContain('</html>');
  });

  it('has correct page title with flowName', () => {
    expect(result).toContain('<title>AgentOps render — AgentOps</title>');
  });

  it('escapes flowName in title when it contains HTML chars', () => {
    const dangerous = makeSession({ featureName: '<b>Inject</b>' });
    const out = renderFlowHtml(dangerous, null, null, '');
    expect(out).not.toContain('<title><b>Inject</b>');
    expect(out).toContain('&lt;b&gt;Inject&lt;/b&gt;');
  });

  it('includes inline CSS style tag (self-contained, AC-006, AC-017)', () => {
    expect(result).toContain('<style>');
    expect(result).toContain('</style>');
    // No external CSS file references
    expect(result).not.toContain('<link rel="stylesheet"');
  });

  it('contains CSS tokens with :root and dark mode (AC-020)', () => {
    expect(result).toContain(':root {');
    expect(result).toContain('prefers-color-scheme: dark');
  });

  it('has no JavaScript script src (zero local bundle, AC-006)', () => {
    expect(result).not.toMatch(/<script src=/);
  });

  it('contains kpi-bar header (AC-002)', () => {
    expect(result).toContain('class="kpi-bar"');
    expect(result).toContain('<header');
  });

  it('shows flow name in header', () => {
    expect(result).toContain('AgentOps render');
  });

  it('shows cost KPI in header', () => {
    expect(result).toContain('$3.34');
  });

  it('shows mutation score in header', () => {
    expect(result).toContain('70.7%');
  });

  it('shows type coverage in header', () => {
    expect(result).toContain('97.8%');
  });

  it('contains <main> element', () => {
    expect(result).toContain('<main>');
    expect(result).toContain('</main>');
  });

  it('contains story section (AC-003)', () => {
    expect(result).toContain('class="story"');
    expect(result).toContain('<h2>Story</h2>');
  });

  it('renders story cards for each batch (AC-003)', () => {
    // Two batches → two story-card articles
    const cardMatches = result.match(/<article class="story-card/g);
    expect(cardMatches).not.toBeNull();
    expect(cardMatches!.length).toBeGreaterThanOrEqual(1);
  });

  it('contains drilldown section (AC-009)', () => {
    expect(result).toContain('class="drilldown"');
    expect(result).toContain('Per-AC closure detail');
    expect(result).toContain('Per-dispatch breakdown');
  });

  it('drilldown details are collapsed by default (no open attribute)', () => {
    // All <details> in drilldown should not have open
    const openMatches = result.match(/<details open/g);
    expect(openMatches).toBeNull();
  });

  it('contains raw-data section (AC-010)', () => {
    expect(result).toContain('class="raw-data"');
    expect(result).toContain('View raw Markdown report');
  });

  it('MD content is embedded in raw-data section (AC-012)', () => {
    expect(result).toContain('md-embed');
    // The MD content headings should be converted to HTML
    expect(result).toContain('FEAT-002 AgentOps render');
  });

  it('raw-data section is collapsed by default', () => {
    // The raw-data section details should not have open attribute
    expect(result).not.toContain('<details open');
  });

  it('uses details/summary for expand/collapse (no JS required, AC-008)', () => {
    expect(result).toContain('<details>');
    expect(result).toContain('<summary>');
  });

  it('contains AC-009: reuses drilldown logic from components', () => {
    // Drilldown should contain semantic table tags (not just text)
    expect(result).toContain('<table>');
    expect(result).toContain('<thead>');
    expect(result).toContain('<tbody>');
  });

  it('flow with no dispatches renders empty story but intact structure (AC-006)', () => {
    const emptySession = makeSession({ dispatches: [] });
    const out = renderFlowHtml(emptySession, null, null, '');
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('class="story"');
    expect(out).toContain('class="drilldown"');
    expect(out).toContain('class="raw-data"');
  });

  it('empty markdown still renders raw-data section', () => {
    const out = renderFlowHtml(makeSession(), null, null, '');
    expect(out).toContain('class="raw-data"');
    expect(out).toContain('View raw Markdown report');
  });

  it('repoHealth null → KPI shows dashes for mut/type', () => {
    const out = renderFlowHtml(makeSession(), null, null, '');
    expect(out).toContain('—');
  });

  it('cost null → KPI shows dash for USD', () => {
    const out = renderFlowHtml(makeSession(), makeRepoHealth(), null, '');
    expect(out).toContain('—');
  });

  it('has lang attribute on html element', () => {
    expect(result).toContain('lang="pt-BR"');
  });

  it('has charset and viewport meta tags (AC-019)', () => {
    expect(result).toContain('charset="UTF-8"');
    expect(result).toContain('viewport');
  });

  it('snapshot matches (update with npm test -- -u if HTML changes intentionally)', () => {
    expect(result).toMatchSnapshot();
  });
});
