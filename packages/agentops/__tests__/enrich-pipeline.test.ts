/**
 * Unit tests for enrich.ts — expectedPipeline rich-field parsing.
 * FEAT-005 T-003 / AC-005: title, acScope, tasksCovered fields on pipeline entries.
 */

import { enrich } from '../src/enrich';
import type { RawSession } from '../src/types';

describe('enrich — normaliseExpectedPipeline rich fields (FEAT-005 T-003)', () => {
  it('populates title, acScope, tasksCovered when manifest provides them', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PIPELINE-RICH',
      sessionYml: {
        task_id: 'FEAT-PIPELINE-RICH',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [
          {
            batch_id: 'BATCH-A',
            title: 'Setup + Foundational configs',
            ac_scope: ['AC-001', 'AC-005'],
            tasks_covered: ['T-001', 'T-002', 'T-003'],
            required_roles: ['dev', 'qa'],
          },
          {
            // older entry without title/ac_scope/tasks_covered
            batch_id: 'BATCH-B',
            required_roles: ['dev'],
          },
        ],
        actual_dispatches: [],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.expectedPipeline).toHaveLength(2);
    const batchA = session.expectedPipeline[0]!;
    expect(batchA.title).toBe('Setup + Foundational configs');
    expect(batchA.acScope).toEqual(['AC-001', 'AC-005']);
    expect(batchA.tasksCovered).toEqual(['T-001', 'T-002', 'T-003']);
    const batchB = session.expectedPipeline[1]!;
    expect(batchB.title).toBeUndefined();
    expect(batchB.acScope).toBeUndefined();
    expect(batchB.tasksCovered).toBeUndefined();
  });

  it('filters non-string values from ac_scope and tasks_covered arrays', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PIPELINE-FILTER',
      sessionYml: {
        task_id: 'FEAT-PIPELINE-FILTER',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [
          {
            batch_id: 'BATCH-C',
            ac_scope: ['AC-001', 42, null, 'AC-002'],
            tasks_covered: ['T-001', true, 'T-002'],
            required_roles: ['dev'],
          },
        ],
        actual_dispatches: [],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    const batchC = session.expectedPipeline[0]!;
    expect(batchC.acScope).toEqual(['AC-001', 'AC-002']);
    expect(batchC.tasksCovered).toEqual(['T-001', 'T-002']);
  });
});
