/**
 * Unit tests para compliance handling em pré-padrão / pm-bypass / standard.
 *
 * Garante:
 * - constants.ts::complianceForFlow lookup correto
 * - enrich.ts propaga compliance para Session
 * - measure.ts propaga para Metrics
 * - insights.ts::computeTrends exclui flows não-standard
 * - render/index-report.ts mostra Compl. column + legend quando há mistura
 * - render/flow-report/header.ts mostra banner em flows não-standard
 */

import { complianceForFlow, isExcludedFromHealth } from '../src/constants';
import { enrich } from '../src/enrich';
import { computeTrends } from '../src/insights';
import { measure } from '../src/measure';
import { renderFlowReport } from '../src/render/flow-report';
import { renderIndexReport } from '../src/render/index-report';
import type { Metrics, RawSession, Role, Session } from '../src/types';

const TEST_PRIOR_FLOWS = ['FEAT-001', 'FEAT-002', 'FEAT-003', 'FEAT-004', 'FEAT-005', 'FEAT-006'];
const TEST_BYPASS_FLOWS = ['FEAT-008'];

const ALL_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
  'pm-orchestrator',
];

function makeRawSession(taskId: string): RawSession {
  return {
    taskId,
    sessionYml: {
      task_id: taskId,
      feature_name: `Feature ${taskId}`,
      current_phase: 'done',
      started_at: '2026-05-01T00:00:00Z',
      completed_at: '2026-05-01T01:00:00Z',
    },
    manifest: null,
    outputs: [],
    specMd: '- AC-001: x\n- AC-002: y\n',
    sessionDirPath: `/tmp/${taskId}`,
  };
}

function makeMetrics(overrides: Partial<Metrics>): Metrics {
  return {
    taskId: 'FEAT-X',
    featureName: 'x',
    compliance: 'standard',
    currentPhase: 'done',
    status: 'done',
    startedAt: '2026-05-01T00:00:00Z',
    totalDispatches: 4,
    dispatchesByRole: Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>,
    taskSuccessRate: Object.fromEntries(ALL_ROLES.map((r) => [r, 1])) as Record<
      Role,
      number | null
    >,
    loopRate: 0,
    escalationRate: 0,
    phaseDurations: {},
    acClosure: { total: 5, pass: 5, partial: 0, fail: 0, missing: 0 },
    reviewerFindings: null,
    dispatchesPerAc: 0.8,
    tokenCost: { total: null, perAc: null },
    reworkRate: null,
    insights: [],
    ...overrides,
  };
}

function makeSession(metrics: Metrics): Session {
  return {
    taskId: metrics.taskId,
    featureName: metrics.featureName,
    compliance: metrics.compliance,
    currentPhase: metrics.currentPhase,
    status: metrics.status,
    startedAt: metrics.startedAt,
    completedAt: '2026-05-01T01:00:00Z',
    phases: [],
    dispatches: [],
    acs: ['AC-001'],
    qaResults: [],
    expectedPipeline: [],
    escalationMetrics: null,
  };
}

describe('compliance — constants', () => {
  it('FEAT-001..006 são pré-padrão', () => {
    for (const id of TEST_PRIOR_FLOWS) {
      expect(complianceForFlow(id, TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe('pre-standard');
      expect(isExcludedFromHealth(id, TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe(true);
    }
  });

  it('FEAT-008 é pm-bypass', () => {
    for (const id of TEST_BYPASS_FLOWS) {
      expect(complianceForFlow(id, TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe('pm-bypass');
      expect(isExcludedFromHealth(id, TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe(true);
    }
  });

  it('FEAT-007 (e flows desconhecidos) são standard', () => {
    expect(complianceForFlow('FEAT-007', TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe('standard');
    expect(complianceForFlow('FEAT-999', TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe('standard');
    expect(isExcludedFromHealth('FEAT-007', TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS)).toBe(false);
  });

  it('returns standard when both priorFlows and bypassFlows are empty', () => {
    expect(complianceForFlow('FEAT-X', [], [])).toBe('standard');
  });

  it('returns pre-standard (priorFlows wins) when taskId is in both priorFlows and bypassFlows', () => {
    expect(complianceForFlow('FEAT-001', ['FEAT-001'], ['FEAT-001'])).toBe('pre-standard');
  });
});

describe('compliance — enrich/measure', () => {
  it('enrich seta compliance no Session a partir do taskId', () => {
    expect(enrich(makeRawSession('FEAT-001'), TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS).compliance).toBe('pre-standard');
    expect(enrich(makeRawSession('FEAT-008'), TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS).compliance).toBe('pm-bypass');
    expect(enrich(makeRawSession('FEAT-007'), TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS).compliance).toBe('standard');
  });

  it('measure propaga compliance do Session para Metrics', () => {
    const session = enrich(makeRawSession('FEAT-001'), TEST_PRIOR_FLOWS, TEST_BYPASS_FLOWS);
    expect(measure(session).compliance).toBe('pre-standard');
  });
});

describe('compliance — computeTrends', () => {
  it('exclui flows pré-padrão de trends', () => {
    const metrics = [
      makeMetrics({ taskId: 'FEAT-001', compliance: 'pre-standard', dispatchesPerAc: 5 }),
      makeMetrics({ taskId: 'FEAT-002', compliance: 'pre-standard', dispatchesPerAc: 4 }),
    ];
    expect(computeTrends(metrics)).toEqual([]);
  });

  it('exclui flows pm-bypass de trends', () => {
    const metrics = [
      makeMetrics({ taskId: 'FEAT-007', compliance: 'standard', dispatchesPerAc: 2 }),
      makeMetrics({ taskId: 'FEAT-008', compliance: 'pm-bypass', dispatchesPerAc: 3 }),
    ];
    expect(computeTrends(metrics)).toEqual([]);
  });

  it('inclui apenas flows standard em trends', () => {
    const metrics = [
      makeMetrics({ taskId: 'FEAT-001', compliance: 'pre-standard', dispatchesPerAc: 5 }),
      makeMetrics({ taskId: 'FEAT-007', compliance: 'standard', dispatchesPerAc: 2 }),
      makeMetrics({ taskId: 'FEAT-009', compliance: 'standard', dispatchesPerAc: 1.5 }),
    ];
    const trends = computeTrends(metrics);
    expect(trends.length).toBeGreaterThan(0);
    expect(trends[0]?.message).toContain('FEAT-007');
    expect(trends[0]?.message).toContain('FEAT-009');
  });
});

describe('compliance — render flow-report (markdown)', () => {
  it('mostra banner pré-padrão no header', () => {
    const m = makeMetrics({ taskId: 'FEAT-001', compliance: 'pre-standard' });
    const output = renderFlowReport(m, [], '2026-05-09T00:00:00Z', 'Foundation', 'done');
    expect(output).toContain('Pré-padrão');
    expect(output).toContain('Excluído de trends e health metrics');
  });

  it('mostra banner pm-bypass no header', () => {
    const m = makeMetrics({ taskId: 'FEAT-008', compliance: 'pm-bypass' });
    const output = renderFlowReport(m, [], '2026-05-09T00:00:00Z', 'Priorities', 'done');
    expect(output).toContain('PM-bypass');
    expect(output).toContain('handoff.md');
  });

  it('NÃO mostra banner em flows standard', () => {
    const m = makeMetrics({ taskId: 'FEAT-007', compliance: 'standard' });
    const output = renderFlowReport(m, [], '2026-05-09T00:00:00Z', 'Rich text', 'done');
    expect(output).not.toContain('Pré-padrão');
    expect(output).not.toContain('PM-bypass');
  });
});

describe('compliance — render index (cross-flow table)', () => {
  it('adiciona coluna Compl. na cross-flow table', () => {
    const standardMetrics = makeMetrics({ taskId: 'FEAT-007', compliance: 'standard' });
    const allMetrics = [{ session: makeSession(standardMetrics), metrics: standardMetrics }];
    const output = renderIndexReport(allMetrics, [], '2026-05-09T00:00:00Z');
    expect(output).toContain('| Compl. |');
    expect(output).toContain('| ✓ |'); // standard symbol
  });

  it('mostra legenda quando há flow não-standard', () => {
    const stdM = makeMetrics({ taskId: 'FEAT-007', compliance: 'standard' });
    const preM = makeMetrics({ taskId: 'FEAT-001', compliance: 'pre-standard' });
    const allMetrics = [
      { session: makeSession(stdM), metrics: stdM },
      { session: makeSession(preM), metrics: preM },
    ];
    const output = renderIndexReport(allMetrics, [], '2026-05-09T00:00:00Z');
    expect(output).toContain('Compl. legend');
    expect(output).toContain('◐ pré-padrão');
    expect(output).toContain('⊘ pm-bypass');
  });

  it('NÃO mostra legenda quando todos são standard', () => {
    const stdM = makeMetrics({ taskId: 'FEAT-007', compliance: 'standard' });
    const allMetrics = [{ session: makeSession(stdM), metrics: stdM }];
    const output = renderIndexReport(allMetrics, [], '2026-05-09T00:00:00Z');
    expect(output).not.toContain('Compl. legend');
  });

  it('exibe símbolo ⊘ para flow pm-bypass na tabela', () => {
    const pmM = makeMetrics({ taskId: 'FEAT-008', compliance: 'pm-bypass' });
    const allMetrics = [{ session: makeSession(pmM), metrics: pmM }];
    const output = renderIndexReport(allMetrics, [], '2026-05-09T00:00:00Z');
    expect(output).toContain('| ⊘ |');
  });

  it('exibe símbolo ◐ para flow pré-padrão na tabela', () => {
    const preM = makeMetrics({ taskId: 'FEAT-001', compliance: 'pre-standard' });
    const allMetrics = [{ session: makeSession(preM), metrics: preM }];
    const output = renderIndexReport(allMetrics, [], '2026-05-09T00:00:00Z');
    expect(output).toContain('| ◐ |');
  });
});
