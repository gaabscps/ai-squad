/**
 * Tests for tier_calibration surfacing in agentops Session dispatches.
 * T-018 / AC-016: when actual_dispatches[].tier_calibration is present, it is
 * exposed as tierCalibration on the dispatch entry; when absent, tierCalibration
 * is undefined (v1 manifest compat — rollup renderer buckets undefined as "unknown").
 */

import { enrich } from '../src/enrich';
import type { RawSession } from '../src/types';
import { isTierCalibration } from '../src/enrich/guards';

function makeRaw(actualDispatches: unknown[]): RawSession {
  return {
    taskId: 'FEAT-TC-TEST',
    sessionYml: {
      task_id: 'FEAT-TC-TEST',
      feature_name: 'TierCalibrationTest',
      current_phase: 'done',
      started_at: '2026-01-01T00:00:00Z',
    },
    manifest: {
      expected_pipeline: [],
      actual_dispatches: actualDispatches,
    },
    outputs: [],
    specMd: null,
    sessionDirPath: '/tmp/fake-tc',
  };
}

describe('tier_calibration on dispatches (AC-016)', () => {
  it('exposes tierCalibration when tier_calibration is present and valid', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-t3-dev',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T00:00:00Z',
        tier_calibration: {
          tier: 'T3',
          model: 'sonnet',
          effort: 'high',
          loop_kind: 'dev L1',
        },
      },
    ]);
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(1);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeDefined();
    expect(d.tierCalibration!.tier).toBe('T3');
    expect(d.tierCalibration!.model).toBe('sonnet');
    expect(d.tierCalibration!.effort).toBe('high');
    expect(d.tierCalibration!.loopKind).toBe('dev L1');
  });

  it('exposes tierCalibration on a T4 dispatch (opus, high)', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-t4-dev',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T01:00:00Z',
        tier_calibration: {
          tier: 'T4',
          model: 'opus',
          effort: 'high',
          loop_kind: 'dev L3',
        },
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeDefined();
    expect(d.tierCalibration!.tier).toBe('T4');
    expect(d.tierCalibration!.effort).toBe('high');
    expect(d.tierCalibration!.loopKind).toBe('dev L3');
  });

  it('leaves tierCalibration undefined when tier_calibration is absent (v1 manifest)', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-no-tier',
        role: 'qa',
        status: 'done',
        started_at: '2026-01-01T02:00:00Z',
        // no tier_calibration field — v1 manifest
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeUndefined();
  });

  it('leaves tierCalibration undefined when tier_calibration is invalid (missing tier field)', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-invalid-tier',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T03:00:00Z',
        tier_calibration: {
          // missing tier field — invalid
          model: 'sonnet',
          effort: 'medium',
          loop_kind: 'dev L1',
        },
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeUndefined();
  });

  it('handles mixed dispatches: 2 with tier_calibration, 1 without', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-t1-dev',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T00:00:00Z',
        tier_calibration: {
          tier: 'T1',
          model: 'haiku',
          effort: 'low',
          loop_kind: 'dev L1',
        },
      },
      {
        dispatch_id: 'd-t2-reviewer',
        role: 'code-reviewer',
        status: 'done',
        started_at: '2026-01-01T01:00:00Z',
        tier_calibration: {
          tier: 'T2',
          model: 'sonnet',
          effort: 'medium',
          loop_kind: 'review',
        },
      },
      {
        dispatch_id: 'd-no-tier-qa',
        role: 'qa',
        status: 'done',
        started_at: '2026-01-01T02:00:00Z',
        // absent tier_calibration
      },
    ]);
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(3);

    const d1 = session.dispatches.find((d) => d.dispatchId === 'd-t1-dev')!;
    expect(d1.tierCalibration).toBeDefined();
    expect(d1.tierCalibration!.tier).toBe('T1');
    expect(d1.tierCalibration!.effort).toBe('low');

    const d2 = session.dispatches.find((d) => d.dispatchId === 'd-t2-reviewer')!;
    expect(d2.tierCalibration).toBeDefined();
    expect(d2.tierCalibration!.tier).toBe('T2');
    expect(d2.tierCalibration!.loopKind).toBe('review');

    const d3 = session.dispatches.find((d) => d.dispatchId === 'd-no-tier-qa')!;
    expect(d3.tierCalibration).toBeUndefined();
  });

  it('leaves tierCalibration undefined when tier_calibration is not a record', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-non-record',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T04:00:00Z',
        tier_calibration: 'not-a-record',
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeUndefined();
  });

  it('leaves tierCalibration undefined when tier_calibration is partial (missing model) → unknown bucket', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-partial-no-model',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T05:00:00Z',
        tier_calibration: {
          tier: 'T2',
          // model absent
          effort: 'high',
          loop_kind: 'dev L1',
        },
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeUndefined();
  });

  it('leaves tierCalibration undefined when effort is an invalid enum value', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-invalid-effort',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T06:00:00Z',
        tier_calibration: {
          tier: 'T3',
          model: 'sonnet',
          effort: 'ultra', // not in low|medium|high|xhigh|max
          loop_kind: 'dev L1',
        },
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeUndefined();
  });

  it('leaves tierCalibration undefined when loop_kind is missing (required by schema)', () => {
    const raw = makeRaw([
      {
        dispatch_id: 'd-missing-loop-kind',
        role: 'dev',
        status: 'done',
        started_at: '2026-01-01T07:00:00Z',
        tier_calibration: {
          tier: 'T3',
          model: 'sonnet',
          effort: 'high',
          // loop_kind absent — required field per dispatch-manifest.schema.json
        },
      },
    ]);
    const session = enrich(raw);
    const d = session.dispatches[0]!;
    expect(d.tierCalibration).toBeUndefined();
  });
});

describe('isTierCalibration type guard', () => {
  it('returns true for a valid TierCalibration object', () => {
    expect(isTierCalibration({ tier: 'T3', model: 'sonnet', effort: 'high', loop_kind: 'dev L1' })).toBe(true);
  });

  it('returns true for all valid tier values', () => {
    for (const tier of ['T1', 'T2', 'T3', 'T4']) {
      expect(isTierCalibration({ tier, model: 'sonnet', effort: 'high', loop_kind: 'dev L1' })).toBe(true);
    }
  });

  it('returns false when tier field is missing', () => {
    expect(isTierCalibration({ model: 'sonnet', effort: 'high', loop_kind: 'dev L1' })).toBe(false);
  });

  it('returns false when tier field is not a valid tier string', () => {
    expect(isTierCalibration({ tier: 'T5', model: 'sonnet', effort: 'high', loop_kind: 'dev L1' })).toBe(false);
  });

  it('returns false for a non-record value', () => {
    expect(isTierCalibration('not-an-object')).toBe(false);
    expect(isTierCalibration(null)).toBe(false);
    expect(isTierCalibration(42)).toBe(false);
  });

  it('returns false when model field is missing', () => {
    expect(isTierCalibration({ tier: 'T2', effort: 'high', loop_kind: 'dev L1' })).toBe(false);
  });

  it('returns false when effort field is missing', () => {
    expect(isTierCalibration({ tier: 'T2', model: 'sonnet', loop_kind: 'dev L1' })).toBe(false);
  });

  it('returns false when effort is an invalid enum value', () => {
    expect(isTierCalibration({ tier: 'T2', model: 'sonnet', effort: 'ultra', loop_kind: 'dev L1' })).toBe(false);
    expect(isTierCalibration({ tier: 'T2', model: 'sonnet', effort: 'MEDIUM', loop_kind: 'dev L1' })).toBe(false);
  });

  it('returns false when loop_kind field is missing', () => {
    expect(isTierCalibration({ tier: 'T2', model: 'sonnet', effort: 'high' })).toBe(false);
  });

  it('returns true for all valid effort values', () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
      expect(isTierCalibration({ tier: 'T1', model: 'haiku', effort, loop_kind: 'dev L1' })).toBe(true);
    }
  });
});
