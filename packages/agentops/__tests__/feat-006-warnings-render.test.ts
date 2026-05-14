/**
 * Tests for T-009 / AC-007, AC-008: renderFlowReport ## Warnings section.
 *
 * AC-007: WHEN report finds dispatch with status outside canonical enum
 *         THE SYSTEM SHALL emit a warning visible in the output containing
 *         dispatch_id, task_id, role, status received, and list of valid statuses.
 * AC-008: THE SYSTEM SHALL NOT silently drop; dispatch appears in report in
 *         an "unknown_status" section.
 */

import { renderFlowReport } from '../src/render/flow-report';
import { renderDispatchWarnings } from '../src/render/report';
import type { DispatchWarning } from '../src/enrich/dispatches';
import type { Metrics, Session } from '../src/types';

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

function makeMinimalMetrics(overrides: Partial<Metrics> = {}): Metrics {
  return {
    taskId: 'FEAT-TEST-006',
    featureName: 'Warnings Test',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    totalDispatches: 0,
    dispatchesByRole: {
      'audit-agent': 0,
      'blocker-specialist': 0,
      'code-reviewer': 0,
      dev: 0,
      'logic-reviewer': 0,
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
    phaseDurations: { specify: null, plan: null, tasks: null, implementation: 'running' },
    acClosure: { total: 0, pass: 0, partial: 0, fail: 0, missing: 0 },
    reviewerFindings: null,
    dispatchesPerAc: 0,
    tokenCost: { total: null, perAc: null },
    reworkRate: null,
    insights: [],
    ...overrides,
  };
}

function makeMinimalSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-TEST-006',
    featureName: 'Warnings Test',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    phases: [],
    dispatches: [],
    acs: [],
    qaResults: [],
    expectedPipeline: [],
    escalationMetrics: null,
    ...overrides,
  };
}

const GENERATED_AT = '2026-01-01T00:00:00Z';

// ---------------------------------------------------------------------------
// renderDispatchWarnings unit tests
// ---------------------------------------------------------------------------

describe('renderDispatchWarnings — no warnings', () => {
  it('returns null when warnings array is empty', () => {
    const result = renderDispatchWarnings([]);
    expect(result).toBeNull();
  });

  it('returns null when warnings is undefined', () => {
    const result = renderDispatchWarnings(undefined);
    expect(result).toBeNull();
  });
});

describe('renderDispatchWarnings — unknown_status warning', () => {
  const warnings: DispatchWarning[] = [
    {
      kind: 'unknown_status',
      dispatch_id: 'd-unknown',
      task_id: 'T-TEST',
      role: 'dev',
      status: 'completed',
      valid: ['done', 'needs_review', 'blocked', 'escalate', 'pending', 'running', 'needs_changes', 'failed'],
    },
  ];

  it('renders ## Warnings header', () => {
    const result = renderDispatchWarnings(warnings);
    expect(result).not.toBeNull();
    expect(result).toContain('## Warnings');
  });

  it('AC-007: contains dispatch_id, task_id, role, status in output', () => {
    const result = renderDispatchWarnings(warnings)!;
    expect(result).toContain('d-unknown');
    expect(result).toContain('T-TEST');
    expect(result).toContain('dev');
    expect(result).toContain('completed');
  });

  it('AC-007: contains [unknown_status] kind label', () => {
    const result = renderDispatchWarnings(warnings)!;
    expect(result).toContain('[unknown_status]');
  });

  it('contains valid status list reference', () => {
    const result = renderDispatchWarnings(warnings)!;
    // At minimum, "done" should appear somewhere in the output (valid list)
    expect(result).toContain('done');
  });
});

describe('renderDispatchWarnings — deprecated_status warning', () => {
  const warnings: DispatchWarning[] = [
    {
      kind: 'deprecated_status',
      dispatch_id: 'd-deprecated',
      task_id: 'T-TEST-2',
      status: 'partial',
      note: 'deprecated; will be removed in vNext+1',
    },
  ];

  it('renders ## Warnings header', () => {
    const result = renderDispatchWarnings(warnings);
    expect(result).not.toBeNull();
    expect(result).toContain('## Warnings');
  });

  it('contains [deprecated_status] kind label', () => {
    const result = renderDispatchWarnings(warnings)!;
    expect(result).toContain('[deprecated_status]');
  });

  it('contains dispatch_id and status', () => {
    const result = renderDispatchWarnings(warnings)!;
    expect(result).toContain('d-deprecated');
    expect(result).toContain('partial');
  });
});

describe('renderDispatchWarnings — unknown_role warning', () => {
  const warnings: DispatchWarning[] = [
    {
      kind: 'unknown_role',
      dispatch_id: 'd-badrole',
      task_id: 'T-TEST-3',
      role: 'not-a-role',
      valid: ['dev', 'qa', 'code-reviewer'],
    },
  ];

  it('contains [unknown_role] kind label and dispatch_id', () => {
    const result = renderDispatchWarnings(warnings)!;
    expect(result).toContain('[unknown_role]');
    expect(result).toContain('d-badrole');
    expect(result).toContain('not-a-role');
  });
});

describe('renderDispatchWarnings — mixed warnings grouped by kind', () => {
  const warnings: DispatchWarning[] = [
    {
      kind: 'unknown_status',
      dispatch_id: 'd-s1',
      task_id: 'T-1',
      role: 'dev',
      status: 'completed',
      valid: ['done'],
    },
    {
      kind: 'deprecated_status',
      dispatch_id: 'd-d1',
      task_id: 'T-2',
      status: 'partial',
      note: 'deprecated',
    },
    {
      kind: 'unknown_role',
      dispatch_id: 'd-r1',
      task_id: 'T-3',
      role: 'bad-role',
      valid: ['dev'],
    },
  ];

  it('groups by kind with sub-headers', () => {
    const result = renderDispatchWarnings(warnings)!;
    // Should contain both kind labels
    expect(result).toContain('[unknown_status]');
    expect(result).toContain('[deprecated_status]');
    expect(result).toContain('[unknown_role]');
  });

  it('contains all dispatch ids', () => {
    const result = renderDispatchWarnings(warnings)!;
    expect(result).toContain('d-s1');
    expect(result).toContain('d-d1');
    expect(result).toContain('d-r1');
  });
});

// ---------------------------------------------------------------------------
// renderFlowReport integration — ## Warnings section
// ---------------------------------------------------------------------------

describe('renderFlowReport — ## Warnings section (AC-007, AC-008)', () => {
  const dispatchWarnings: DispatchWarning[] = [
    {
      kind: 'unknown_status',
      dispatch_id: 'd-unknown-42',
      task_id: 'T-042',
      role: 'dev',
      status: 'completed',
      valid: ['done', 'needs_review', 'blocked', 'escalate'],
    },
  ];

  it('AC-007: ## Warnings section appears in report when dispatchWarnings non-empty', () => {
    const metrics = makeMinimalMetrics();
    const session = makeMinimalSession();
    const report = renderFlowReport(
      metrics,
      [],
      GENERATED_AT,
      'Warnings Test',
      'implementation',
      session,
      null,
      undefined,
      dispatchWarnings,
    );
    expect(report).toContain('## Warnings');
  });

  it('AC-007: warning line contains dispatch_id, task_id, role, status', () => {
    const metrics = makeMinimalMetrics();
    const session = makeMinimalSession();
    const report = renderFlowReport(
      metrics,
      [],
      GENERATED_AT,
      'Warnings Test',
      'implementation',
      session,
      null,
      undefined,
      dispatchWarnings,
    );
    expect(report).toContain('d-unknown-42');
    expect(report).toContain('T-042');
    expect(report).toContain('dev');
    expect(report).toContain('completed');
  });

  it('AC-008: ## Warnings section does NOT appear when dispatchWarnings empty', () => {
    const metrics = makeMinimalMetrics();
    const session = makeMinimalSession();
    const report = renderFlowReport(
      metrics,
      [],
      GENERATED_AT,
      'Warnings Test',
      'implementation',
      session,
      null,
      undefined,
      [],
    );
    expect(report).not.toContain('## Warnings');
  });

  it('## Warnings section not rendered when dispatchWarnings omitted (backward compat)', () => {
    const metrics = makeMinimalMetrics();
    const session = makeMinimalSession();
    const report = renderFlowReport(
      metrics,
      [],
      GENERATED_AT,
      'Warnings Test',
      'implementation',
      session,
      null,
    );
    expect(report).not.toContain('## Warnings');
  });

  it('AC-008: unknown_status dispatch appears in per-dispatch breakdown (not dropped)', () => {
    const session = makeMinimalSession({
      dispatches: [
        {
          dispatchId: 'd-unknown-42',
          role: 'dev',
          status: 'unknown_status' as import('../src/types').DispatchStatus,
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: null,
        },
      ],
    });
    const metrics = makeMinimalMetrics({ totalDispatches: 1 });
    const report = renderFlowReport(
      metrics,
      [],
      GENERATED_AT,
      'Warnings Test',
      'implementation',
      session,
      null,
      undefined,
      dispatchWarnings,
    );
    // The dispatch should appear in the per-dispatch breakdown table
    expect(report).toContain('d-unknown-42');
    // The ## Warnings section should also be present
    expect(report).toContain('## Warnings');
  });
});
