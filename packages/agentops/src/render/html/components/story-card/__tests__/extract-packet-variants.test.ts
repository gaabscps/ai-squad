/**
 * Unit tests for the packet-schema variants supported by extractFilesChanged,
 * extractAcsCovered, and extractTasksCovered. The aggregator must work with
 * both the legacy structured shape (used by FEAT-001..FEAT-005 fixtures) and
 * the current SDD packet shape emitted by the orchestrator.
 */

import {
  extractAcsCovered,
  extractFilesChanged,
  extractTasksCovered,
} from '../aggregator/extract';

describe('extractFilesChanged', () => {
  it('accepts the structured form ({ path, action, tasks_covered })', () => {
    const op = {
      files_changed: [
        { path: 'src/foo.ts', action: 'created', tasks_covered: ['T-001'] },
        { path: 'src/bar.ts', action: 'modified', tasks_covered: ['T-002'] },
      ],
    };
    expect(extractFilesChanged(op)).toEqual([
      { path: 'src/foo.ts', action: 'created', tasksCovered: ['T-001'] },
      { path: 'src/bar.ts', action: 'modified', tasksCovered: ['T-002'] },
    ]);
  });

  it('accepts the path-only form ([string, ...]) and falls back to packet task_id', () => {
    const op = {
      task_id: 'T-001',
      files_changed: ['web/package.json', 'test-utils/renderWithDnd.tsx'],
    };
    expect(extractFilesChanged(op)).toEqual([
      { path: 'web/package.json', action: 'changed', tasksCovered: ['T-001'] },
      { path: 'test-utils/renderWithDnd.tsx', action: 'changed', tasksCovered: ['T-001'] },
    ]);
  });

  it('returns an empty array when files_changed is missing or non-array', () => {
    expect(extractFilesChanged({})).toEqual([]);
    expect(extractFilesChanged({ files_changed: null })).toEqual([]);
  });

  it('skips empty strings in path-only form', () => {
    expect(extractFilesChanged({ files_changed: ['', 'a.ts'] })).toEqual([
      { path: 'a.ts', action: 'changed', tasksCovered: [] },
    ]);
  });
});

describe('extractAcsCovered', () => {
  it('accepts ac_evidence (legacy: map AC → free-form string)', () => {
    const op = {
      ac_evidence: {
        'AC-001': 'types.ts:10 BatchData.title field',
        'AC-002': 'state.ts:25 computeBatchState',
      },
    };
    expect(extractAcsCovered(op)).toEqual([
      { id: 'AC-001', evidence: 'types.ts:10 BatchData.title field' },
      { id: 'AC-002', evidence: 'state.ts:25 computeBatchState' },
    ]);
  });

  it('accepts ac_coverage (qa: map AC → list of evidence IDs)', () => {
    const op = {
      ac_coverage: {
        'NFR-003': ['E-NFR003-001', 'E-NFR003-002', 'E-NFR003-003'],
        'AC-026': ['E-AC026-001'],
      },
    };
    expect(extractAcsCovered(op)).toEqual([
      { id: 'NFR-003', evidence: 'E-NFR003-001, E-NFR003-002, E-NFR003-003' },
      { id: 'AC-026', evidence: 'E-AC026-001' },
    ]);
  });

  it('prefers ac_evidence when both are present', () => {
    const op = {
      ac_evidence: { 'AC-001': 'explicit' },
      ac_coverage: { 'AC-001': ['E-001'], 'AC-002': ['E-002'] },
    };
    expect(extractAcsCovered(op)).toEqual([{ id: 'AC-001', evidence: 'explicit' }]);
  });

  it('returns empty when neither field is present', () => {
    expect(extractAcsCovered({})).toEqual([]);
  });
});

describe('extractTasksCovered', () => {
  it('reads tasks_covered when present', () => {
    expect(extractTasksCovered({ tasks_covered: ['T-001', 'T-002'] })).toEqual(['T-001', 'T-002']);
  });

  it('falls back to packet task_id when tasks_covered is absent', () => {
    expect(extractTasksCovered({ task_id: 'T-007' })).toEqual(['T-007']);
  });

  it('returns empty array when neither field is present', () => {
    expect(extractTasksCovered({})).toEqual([]);
  });
});
