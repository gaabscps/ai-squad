/**
 * Tests for AC-006, AC-007: renderTokenCost warning header scenarios.
 *
 * Three scenarios:
 *   (a) pm_orchestrator_sessions populated, no warnings → real token/cost line, no warning header
 *   (b) pm_orchestrator_session_warnings non-empty → warning header prepended; cost line rendered
 *       if sessions also exist, otherwise proxy fallback
 *   (c) pm_orchestrator_sessions empty, no warnings → proxy fallback + hint line
 *
 * AC-007 header placement:
 *   renderHeader and renderFlowReport surface the warning in the report HEADER section
 *   (before cost/token sections) when pmWarnings is non-empty.
 */

import { renderTokenCost } from '../src/render/flow-report/existing-sections';
import { renderHeader } from '../src/render/flow-report/header';
import { renderFlowReport } from '../src/render/flow-report';

type PmWarning = { reason: string; timestamp: string; session_id: string };

describe('renderTokenCost — scenario (a): sessions populated, no warnings', () => {
  it('emits real total-tokens line and no warning header', () => {
    const output = renderTokenCost(
      { total: 42000, perAc: 6000 },
      5,
      [{ session_id: 'abc', model: 'sonnet-4-6' }],
      [],
    );
    expect(output).toContain('Total tokens: 42000');
    expect(output).not.toContain('⚠');
    expect(output).not.toContain('cost proxy');
    expect(output).not.toContain('did not run');
  });

  it('includes Tokens/AC when perAc is set', () => {
    const output = renderTokenCost(
      { total: 42000, perAc: 6000 },
      5,
      [{ session_id: 'abc', model: 'sonnet-4-6' }],
      [],
    );
    expect(output).toContain('Tokens/AC: 6000');
  });

  it('omits Tokens/AC line when perAc is null', () => {
    const output = renderTokenCost(
      { total: 42000, perAc: null },
      5,
      [{ session_id: 'abc', model: 'sonnet-4-6' }],
      [],
    );
    expect(output).not.toContain('Tokens/AC');
  });
});

describe('renderTokenCost — scenario (b): warnings non-empty', () => {
  const warnings: PmWarning[] = [
    { reason: 'missing_transcript_path', timestamp: '2026-01-01T00:00:00Z', session_id: 'sess-1' },
  ];

  it('prepends warning header with reason from first warning', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 3, [], warnings);
    expect(output).toContain('⚠ PM session capture warning: missing_transcript_path');
  });

  it('warning header appears before cost content', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 3, [], warnings);
    const warningIdx = output.indexOf('⚠ PM session capture warning');
    const costIdx = output.indexOf('## Token cost');
    expect(costIdx).toBeLessThan(warningIdx);
  });

  it('still renders proxy fallback when sessions empty and warning exists', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 3, [], warnings);
    expect(output).toContain('cost proxy');
  });

  it('renders real tokens line when sessions also populated alongside warnings', () => {
    const outputWithBoth = renderTokenCost(
      { total: 10000, perAc: null },
      3,
      [{ session_id: 'abc' }],
      warnings,
    );
    expect(outputWithBoth).toContain('Total tokens: 10000');
    expect(outputWithBoth).toContain('⚠ PM session capture warning: missing_transcript_path');
  });

  it('uses only the reason from the FIRST warning when multiple warnings exist', () => {
    const multiWarnings: PmWarning[] = [
      {
        reason: 'zero_assistant_turns',
        timestamp: '2026-01-01T00:00:00Z',
        session_id: 'sess-1',
      },
      {
        reason: 'missing_transcript_path',
        timestamp: '2026-01-01T00:01:00Z',
        session_id: 'sess-2',
      },
    ];
    const output = renderTokenCost({ total: null, perAc: null }, 3, [], multiWarnings);
    expect(output).toContain('⚠ PM session capture warning: zero_assistant_turns');
    expect(output).not.toContain('missing_transcript_path');
  });
});

describe('renderTokenCost — scenario (c): sessions empty, no warnings', () => {
  it('emits proxy fallback line', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 4, [], []);
    expect(output).toContain('cost proxy');
    expect(output).toContain('4 dispatches');
  });

  it('appends the Stop hook hint line', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 4, [], []);
    expect(output).toContain('pm-orchestrator Stop hook did not run');
    expect(output).toContain('install-hooks');
  });

  it('does NOT emit a ⚠ warning header (only hint)', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 4, [], []);
    // The hint line has ⚠ but should NOT be a "PM session capture warning" header
    expect(output).not.toContain('PM session capture warning');
  });
});

describe('renderTokenCost — backward compat: called without new params', () => {
  it('still works when called with only 2 args (existing call sites unchanged)', () => {
    const output = renderTokenCost({ total: null, perAc: null }, 2);
    expect(output).toContain('## Token cost');
    expect(output).toContain('cost proxy');
  });

  it('emits real tokens line when tokenCost.total is set and no new params passed', () => {
    const output = renderTokenCost({ total: 5000, perAc: null }, 2);
    expect(output).toContain('Total tokens: 5000');
  });
});

// ---------------------------------------------------------------------------
// AC-007: warning surfaced in report HEADER (renderHeader + renderFlowReport)
// ---------------------------------------------------------------------------

type PmWarning = { reason: string; timestamp: string; session_id: string };

const baseMetrics = {
  taskId: 'FEAT-002',
  featureName: 'Test Feature',
  compliance: 'standard' as const,
  currentPhase: 'implementation' as const,
  status: 'running' as const,
  startedAt: '2026-01-01T00:00:00Z',
  totalDispatches: 3,
  dispatchesByRole: {
    'audit-agent': 0,
    'blocker-specialist': 0,
    'code-reviewer': 0,
    dev: 2,
    'logic-reviewer': 1,
    'pm-orchestrator': 0,
    qa: 0,
  },
  taskSuccessRate: {
    'audit-agent': null,
    'blocker-specialist': null,
    'code-reviewer': null,
    dev: null,
    'logic-reviewer': null,
    'pm-orchestrator': null,
    qa: null,
  },
  loopRate: 0,
  escalationRate: 0,
  phaseDurations: { specify: 5, plan: 10, tasks: 5, implementation: 'running' as const },
  acClosure: { total: 2, pass: 1, partial: 0, fail: 0, missing: 1 },
  reviewerFindings: null,
  dispatchesPerAc: 1.5,
  tokenCost: { total: null, perAc: null },
  reworkRate: null,
  insights: [],
};

describe('renderHeader — AC-007: warning in header', () => {
  const warnings: PmWarning[] = [
    { reason: 'missing_transcript_path', timestamp: '2026-01-01T00:00:00Z', session_id: 'sess-1' },
  ];

  it('renders warning line in header when pmWarnings non-empty', () => {
    const output = renderHeader(baseMetrics, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation', warnings);
    expect(output).toContain('⚠ PM session capture warning: missing_transcript_path');
  });

  it('warning appears before the status block', () => {
    const output = renderHeader(baseMetrics, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation', warnings);
    const warningIdx = output.indexOf('⚠ PM session capture warning');
    const statusBlockIdx = output.indexOf('> Feature:');
    expect(warningIdx).toBeGreaterThan(-1);
    expect(warningIdx).toBeLessThan(statusBlockIdx);
  });

  it('uses reason from first warning when multiple exist', () => {
    const multi: PmWarning[] = [
      { reason: 'zero_assistant_turns', timestamp: '2026-01-01T00:00:00Z', session_id: 'a' },
      { reason: 'missing_transcript_path', timestamp: '2026-01-01T00:01:00Z', session_id: 'b' },
    ];
    const output = renderHeader(baseMetrics, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation', multi);
    expect(output).toContain('zero_assistant_turns');
    expect(output).not.toContain('missing_transcript_path');
  });

  it('does NOT emit warning line when pmWarnings is empty', () => {
    const output = renderHeader(baseMetrics, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation', []);
    expect(output).not.toContain('PM session capture warning');
  });

  it('does NOT emit warning line when pmWarnings is omitted', () => {
    const output = renderHeader(baseMetrics, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation');
    expect(output).not.toContain('PM session capture warning');
  });
});

describe('renderFlowReport — AC-007: warning in header section, AC-006: real cost in token section', () => {
  const warnings: PmWarning[] = [
    { reason: 'hook_did_not_fire', timestamp: '2026-01-01T00:00:00Z', session_id: 'sess-x' },
  ];

  it('surfaces PM session capture warning in the header section (before ## Token cost)', () => {
    const report = renderFlowReport(baseMetrics, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation', undefined, null, warnings);
    const warningIdx = report.indexOf('⚠ PM session capture warning: hook_did_not_fire');
    const tokenCostIdx = report.indexOf('## Token cost');
    expect(warningIdx).toBeGreaterThan(-1);
    expect(tokenCostIdx).toBeGreaterThan(-1);
    // Warning must appear BEFORE the Token cost section (i.e., in the header)
    expect(warningIdx).toBeLessThan(tokenCostIdx);
  });

  it('AC-006: real token line rendered in Token cost section when pm-orchestrator dispatch present', () => {
    const sessionWithPm = {
      taskId: 'FEAT-002',
      featureName: 'Test Feature',
      compliance: 'standard' as const,
      currentPhase: 'implementation' as const,
      status: 'running' as const,
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      phases: [],
      dispatches: [
        {
          dispatchId: 'pm-orchestrator-abc12345',
          role: 'pm-orchestrator' as const,
          status: 'done' as const,
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T01:00:00Z',
          outputPacket: null,
          loop: null,
          pmNote: null,
          usage: {
            total_tokens: 50000,
            tool_uses: 10,
            duration_ms: 3600000,
            model: 'sonnet-4-6' as const,
          },
        },
      ],
      acs: ['AC-006', 'AC-007'],
      qaResults: [],
      expectedPipeline: [],
      escalationMetrics: null,
    };
    const metricsWithTokens = { ...baseMetrics, tokenCost: { total: 50000, perAc: 25000 } };
    const report = renderFlowReport(metricsWithTokens, [], '2026-01-01T00:00:00Z', 'Test Feature', 'implementation', sessionWithPm, null, []);
    expect(report).toContain('Total tokens: 50000');
    expect(report).not.toContain('cost proxy');
  });
});
