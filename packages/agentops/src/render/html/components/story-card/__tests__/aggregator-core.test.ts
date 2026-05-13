/**
 * Unit tests for aggregateBatchesFromSession — core state, title, pipeline — FEAT-005.
 * Covers: AC-001, AC-005, AC-007 (partial), AC-009 (partial), AC-014, AC-015, AC-016, AC-017.
 *
 * Split from aggregator.test.ts (BLOCKER-2 fix: 479L → 3 files ≤ 250L each).
 * Fixture topics here: empty session, FEAT-001 BATCH-A like, title fallback.
 */

import type { Session } from '../../../../../types';
import { aggregateBatchesFromSession } from '../aggregator';

// ---------------------------------------------------------------------------
// Minimal Session factory helpers
// ---------------------------------------------------------------------------

type DispatchInput = Partial<Session['dispatches'][0]> & {
  dispatchId: string;
  role: Session['dispatches'][0]['role'];
  status: Session['dispatches'][0]['status'];
  startedAt: string;
};

function makeSession(
  dispatches: DispatchInput[],
  pipeline: Session['expectedPipeline'] = [],
): Session {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test Feature',
    currentPhase: 'implementation',
    status: 'running',
    startedAt: dispatches[0]?.startedAt ?? '2026-01-01T00:00:00.000Z',
    completedAt: null,
    phases: [],
    dispatches: dispatches.map((d) => ({
      dispatchId: d.dispatchId,
      role: d.role,
      status: d.status,
      startedAt: d.startedAt,
      completedAt: d.completedAt ?? null,
      outputPacket: d.outputPacket ?? null,
      loop: d.loop ?? null,
      pmNote: d.pmNote ?? null,
      usage: d.usage,
      ...(d.taskId !== undefined ? { taskId: d.taskId } : {}),
    })),
    acs: [],
    qaResults: [],
    expectedPipeline: pipeline,
    escalationMetrics: null,
  };
}

function devOp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary_for_reviewers:
      'First sentence about implementation. Second sentence about tests. Third sentence ignored.',
    tasks_covered: ['T-001', 'T-002'],
    ac_evidence: {
      'AC-001': 'types.ts:10 BatchData.title field',
      'AC-002': 'state.ts:25 computeBatchState',
    },
    files_changed: [
      { path: 'src/foo.ts', action: 'created', tasks_covered: ['T-001'] },
      { path: 'src/bar.ts', action: 'modified', tasks_covered: ['T-002'] },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: empty session
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — empty session', () => {
  it('returns empty array when no dispatches', () => {
    const session = makeSession([]);
    expect(aggregateBatchesFromSession(session)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: FEAT-001 BATCH-A like fixture
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — FEAT-001 BATCH-A like fixture', () => {
  const pipeline: Session['expectedPipeline'] = [
    {
      batchId: 'BATCH-A',
      title: 'Setup + Foundational configs',
      acScope: ['AC-001', 'AC-002', 'AC-003'],
      tasksCovered: ['T-001', 'T-002'],
      requiredRoles: ['dev', 'code-reviewer', 'qa'],
    },
  ];

  const session = makeSession(
    [
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T08:00:00.000Z',
        completedAt: '2026-01-01T09:00:00.000Z',
        loop: null,
        pmNote: 'Initial dev pass. Implemented baseline. All lint checks pass.',
        outputPacket: devOp({
          files_changed: [
            { path: 'src/foo.ts', action: 'created', tasks_covered: ['T-001'] },
            { path: 'src/bar.ts', action: 'created', tasks_covered: ['T-001'] },
          ],
        }),
      },
      {
        dispatchId: 'feat-001-batch-a-dev-loop2',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T09:30:00.000Z',
        completedAt: '2026-01-01T10:00:00.000Z',
        loop: 2,
        pmNote: 'Loop 2: reviewer found lint issues. Fix: resolved all ESLint errors.',
        outputPacket: devOp({
          files_changed: [
            { path: 'src/foo.ts', action: 'modified', tasks_covered: ['T-001', 'T-002'] },
            { path: 'src/baz.ts', action: 'created', tasks_covered: ['T-002'] },
          ],
        }),
      },
      {
        dispatchId: 'feat-001-batch-a-code-reviewer',
        role: 'code-reviewer',
        status: 'done',
        startedAt: '2026-01-01T10:10:00.000Z',
        completedAt: '2026-01-01T10:30:00.000Z',
        loop: null,
        pmNote: null,
        outputPacket: null,
      },
      {
        dispatchId: 'feat-001-batch-a-qa',
        role: 'qa',
        status: 'done',
        startedAt: '2026-01-01T10:35:00.000Z',
        completedAt: '2026-01-01T10:50:00.000Z',
        loop: null,
        pmNote: null,
        outputPacket: null,
      },
    ],
    pipeline,
  );

  let result: ReturnType<typeof aggregateBatchesFromSession>;

  beforeAll(() => {
    result = aggregateBatchesFromSession(session);
  });

  it('returns one batch', () => {
    expect(result).toHaveLength(1);
  });

  it('state is done-retried (loop=2 present)', () => {
    expect(result[0]?.state).toBe('done-retried');
  });

  it('retryEntries has one entry for loop 2', () => {
    const batch = result[0]!;
    expect(batch.retryEntries).toHaveLength(1);
    expect(batch.retryEntries[0]?.loop).toBe(2);
    expect(batch.retryEntries[0]?.role).toBe('dev');
    expect(batch.retryEntries[0]?.reason).toMatch(/Loop 2/);
  });

  it('summary comes from dev dispatch (lowest loop) — 2 sentences', () => {
    expect(result[0]?.summary).toBe(
      'First sentence about implementation. Second sentence about tests.',
    );
  });

  it('files dedup: src/foo.ts last-wins with modified action from loop2', () => {
    const batch = result[0]!;
    const foo = batch.filesChanged.find((f) => f.path === 'src/foo.ts');
    expect(foo?.action).toBe('modified');
    expect(foo?.tasksCovered).toEqual(['T-001', 'T-002']);
  });

  it('filesChanged contains 3 unique paths', () => {
    const batch = result[0]!;
    expect(batch.filesChanged).toHaveLength(3);
    const paths = batch.filesChanged.map((f) => f.path);
    expect(paths).toContain('src/foo.ts');
    expect(paths).toContain('src/bar.ts');
    expect(paths).toContain('src/baz.ts');
  });

  it('title comes from expectedPipeline (AC-001)', () => {
    expect(result[0]?.title).toBe('Setup + Foundational configs');
  });

  it('acScope from manifest (AC-005)', () => {
    expect(result[0]?.acScope).toEqual(['AC-001', 'AC-002', 'AC-003']);
  });

  it('loops = 2 (max loop value)', () => {
    expect(result[0]?.loops).toBe(2);
  });

  it('pmNote is last non-null (from loop2 dispatch)', () => {
    expect(result[0]?.pmNote).toContain('Loop 2');
  });

  it('rolesPipeline is dev, code-reviewer, qa in chronological order', () => {
    expect(result[0]?.rolesPipeline).toEqual(['dev', 'code-reviewer', 'qa']);
  });

  it('dispatches has 4 rows in chronological order', () => {
    const batch = result[0]!;
    expect(batch.dispatches).toHaveLength(4);
    expect(batch.dispatches[0]?.role).toBe('dev');
    expect(batch.dispatches[1]?.role).toBe('dev');
    expect(batch.dispatches[1]?.loop).toBe(2);
    expect(batch.dispatches[3]?.role).toBe('qa');
  });

  it('acsCovered aggregates AC-001 and AC-002 from dev output packets', () => {
    const batch = result[0]!;
    const ids = batch.acsCovered.map((a) => a.id);
    expect(ids).toContain('AC-001');
    expect(ids).toContain('AC-002');
  });

  it('tasksCovered aggregates T-001 and T-002', () => {
    const batch = result[0]!;
    expect(batch.tasksCovered).toContain('T-001');
    expect(batch.tasksCovered).toContain('T-002');
  });
});

// Title fallback tests (AC-001) are in aggregator-cost-and-pipeline.test.ts

// ---------------------------------------------------------------------------
// Tests: task-id grouping (current SDD manifest format)
// ---------------------------------------------------------------------------

describe('aggregateBatchesFromSession — task-id grouping (d-T-NNN-role-lN dispatches)', () => {
  const pipeline: Session['expectedPipeline'] = [
    {
      taskId: 'T-001',
      title: 'Foundational hook',
      acScope: ['NFR-003'],
      tasksCovered: ['T-001'],
      requiredRoles: ['dev', 'code-reviewer', 'qa'],
    },
    {
      taskId: 'T-002',
      title: 'Item component',
      acScope: ['AC-004', 'AC-005'],
      tasksCovered: ['T-002'],
      requiredRoles: ['dev', 'code-reviewer', 'qa'],
    },
  ];

  const session = makeSession(
    [
      {
        dispatchId: 'd-T-001-dev-l1',
        role: 'dev',
        status: 'done',
        startedAt: '2026-05-13T00:00:00.000Z',
        completedAt: '2026-05-13T00:10:00.000Z',
        loop: 1,
        taskId: 'T-001',
      },
      {
        dispatchId: 'd-T-001-code-reviewer-l1',
        role: 'code-reviewer',
        status: 'done',
        startedAt: '2026-05-13T00:11:00.000Z',
        loop: 1,
        taskId: 'T-001',
      },
      {
        dispatchId: 'd-T-002-dev-l1',
        role: 'dev',
        status: 'done',
        startedAt: '2026-05-13T00:20:00.000Z',
        completedAt: '2026-05-13T00:30:00.000Z',
        loop: 1,
        taskId: 'T-002',
      },
      {
        dispatchId: 'd-T-002-qa-l1',
        role: 'qa',
        status: 'done',
        startedAt: '2026-05-13T00:31:00.000Z',
        loop: 1,
        taskId: 'T-002',
      },
    ],
    pipeline,
  );

  let result: ReturnType<typeof aggregateBatchesFromSession>;

  beforeAll(() => {
    result = aggregateBatchesFromSession(session);
  });

  it('produces one batch per task (not collapsed into D-T)', () => {
    expect(result).toHaveLength(2);
    expect(result.map((b) => b.batchId)).toEqual(['T-001', 'T-002']);
  });

  it('looks up titles from expectedPipeline by taskId', () => {
    expect(result[0]?.title).toBe('Foundational hook');
    expect(result[1]?.title).toBe('Item component');
  });

  it('keeps each task’s dispatches together (T-001 has 2, T-002 has 2)', () => {
    expect(result[0]?.dispatches).toHaveLength(2);
    expect(result[1]?.dispatches).toHaveLength(2);
  });

  it('falls back to extractBatchId when dispatch.taskId is absent (legacy manifest)', () => {
    const legacy = makeSession(
      [
        {
          dispatchId: 'd-T-003-dev-l1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-05-13T01:00:00.000Z',
          loop: 1,
        },
        {
          dispatchId: 'd-T-004-dev-l1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-05-13T01:10:00.000Z',
          loop: 1,
        },
      ],
      [],
    );
    const out = aggregateBatchesFromSession(legacy);
    expect(out.map((b) => b.batchId)).toEqual(['T-003', 'T-004']);
  });
});

