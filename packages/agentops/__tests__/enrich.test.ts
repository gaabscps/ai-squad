/**
 * Unit tests for enrich.ts
 * T-009: 5+ tests covering all ACs in scope.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { parse } from '../src/parse';
import type { RawSession } from '../src/types';

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');
const FIXTURE_B = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-B');
const FIXTURE_C = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-C');

describe('enrich', () => {
  it('fixture A: extracts ACs [AC-001..AC-005] from specMd', async () => {
    const raw = await parse(FIXTURE_A);
    const session = enrich(raw);
    expect(session.acs).toEqual(['AC-001', 'AC-002', 'AC-003', 'AC-004', 'AC-005']);
  });

  it('fixture A: dispatches are normalised with typed Role', async () => {
    const raw = await parse(FIXTURE_A);
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(4);
    const roles = session.dispatches.map((d) => d.role);
    expect(roles).toContain('dev');
    expect(roles).toContain('code-reviewer');
    expect(roles).toContain('qa');
    expect(roles).toContain('audit-agent');
    // All statuses are valid typed DispatchStatus
    session.dispatches.forEach((d) => {
      expect(d.status).toMatch(/^(done|needs_review|blocked|escalate|partial)$/);
    });
  });

  it('fixture A: qaResults populated from qa output packet', async () => {
    const raw = await parse(FIXTURE_A);
    const session = enrich(raw);
    expect(session.qaResults.length).toBeGreaterThan(0);
    const acSet = new Set(session.qaResults.map((r) => r.ac));
    expect(acSet).toContain('AC-001');
    expect(acSet).toContain('AC-005');
    session.qaResults.forEach((r) => {
      expect(r.status).toMatch(/^(pass|partial|fail)$/);
    });
  });

  it('fixture B: ACs extracted OK, dispatches=[], status="specify-only"', async () => {
    const raw = await parse(FIXTURE_B);
    const session = enrich(raw);
    expect(session.acs).toHaveLength(3);
    expect(session.dispatches).toHaveLength(0);
    expect(session.status).toBe('specify-only');
    expect(session.currentPhase).toBe('specify');
  });

  it('spec.md without ACs produces acs=[]', () => {
    const raw: RawSession = {
      taskId: 'FEAT-TEST',
      sessionYml: {
        task_id: 'FEAT-TEST',
        feature_name: 'Test',
        current_phase: 'specify',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [],
      specMd: '# Spec\n\nNo acceptance criteria here.',
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.acs).toEqual([]);
  });

  it('fixture C: manifest null → dispatches=[], escalated (pending_human_tasks=1)', async () => {
    const raw = await parse(FIXTURE_C);
    const session = enrich(raw);
    expect(raw.manifest).toBeNull();
    expect(session.dispatches).toHaveLength(0);
    // current_phase=implementation, pending_human_tasks=1 → escalated
    expect(session.status).toBe('escalated');
    expect(session.currentPhase).toBe('implementation');
  });

  it('fixture A: session status is "done" when current_phase=done', async () => {
    const raw = await parse(FIXTURE_A);
    const session = enrich(raw);
    expect(session.status).toBe('done');
    expect(session.currentPhase).toBe('done');
  });

  it('fixture A: output packets are attached to dispatches by dispatch_id', async () => {
    const raw = await parse(FIXTURE_A);
    const session = enrich(raw);
    const devDispatch = session.dispatches.find((d) => d.dispatchId === 'dev-1');
    expect(devDispatch).toBeDefined();
    expect(devDispatch!.outputPacket).not.toBeNull();
    expect(devDispatch!.outputPacket!['role']).toBe('dev');
  });

  it('deriving escalated status when pending_human_tasks > 0', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ESC',
      sessionYml: {
        task_id: 'FEAT-ESC',
        feature_name: 'Escalated',
        current_phase: 'implementation',
        started_at: '2026-01-01T00:00:00Z',
        escalation_metrics: {
          total_tasks: 1,
          done_tasks: 0,
          pending_human_tasks: 2,
          escalation_rate: 0,
        },
      },
      manifest: { expected_pipeline: [], actual_dispatches: [] },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake2',
    };
    const session = enrich(raw);
    expect(session.status).toBe('escalated');
  });

  it('phases are normalised from phase_history', async () => {
    const raw = await parse(FIXTURE_A);
    const session = enrich(raw);
    expect(session.phases.length).toBeGreaterThan(0);
    session.phases.forEach((p) => {
      expect(['specify', 'plan', 'tasks', 'implementation']).toContain(p.name);
      expect(typeof p.startedAt === 'string' || p.startedAt === null).toBe(true);
    });
  });

  it('normaliseDispatches: skips entries with invalid role or status', () => {
    const raw: RawSession = {
      taskId: 'FEAT-INVALID',
      sessionYml: {
        task_id: 'FEAT-INVALID',
        feature_name: 'Invalid',
        current_phase: 'implementation',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          // invalid role
          {
            dispatch_id: 'd1',
            role: 'not-a-role',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
          },
          // invalid status
          {
            dispatch_id: 'd2',
            role: 'dev',
            status: 'invalid-status',
            started_at: '2026-01-01T00:00:00Z',
          },
          // missing dispatch_id
          {
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
          },
          // non-object entry
          'not-an-object',
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(0);
  });

  it('normaliseDispatches: skips entries missing dispatch_id or started_at', () => {
    const raw: RawSession = {
      taskId: 'FEAT-MISSING',
      sessionYml: {
        task_id: 'FEAT-MISSING',
        feature_name: 'Missing',
        current_phase: 'implementation',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          // missing started_at
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(0);
  });

  it('normaliseDispatches: reads review_loop as loop fallback', () => {
    const raw: RawSession = {
      taskId: 'FEAT-LOOP',
      sessionYml: {
        task_id: 'FEAT-LOOP',
        feature_name: 'Loop',
        current_phase: 'implementation',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            review_loop: 2, // uses review_loop instead of loop
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.loop).toBe(2);
  });

  it('deriveStatus: returns "paused" for paused phase', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PAUSED',
      sessionYml: {
        task_id: 'FEAT-PAUSED',
        feature_name: 'Paused',
        current_phase: 'paused',
        started_at: '2026-01-01T00:00:00Z',
        escalation_metrics: { pending_human_tasks: 0, escalation_rate: 0 },
      },
      manifest: { expected_pipeline: [], actual_dispatches: [] },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.status).toBe('paused');
  });

  it('deriveStatus: returns "escalated" for currentPhase=escalated', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ESC2',
      sessionYml: {
        task_id: 'FEAT-ESC2',
        feature_name: 'Escalated',
        current_phase: 'escalated',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.status).toBe('escalated');
  });

  it('attachOutputPackets: dispatch with no matching output keeps outputPacket=null', () => {
    const raw: RawSession = {
      taskId: 'FEAT-NOMATCH',
      sessionYml: {
        task_id: 'FEAT-NOMATCH',
        feature_name: 'No Match',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'dev-99',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
          },
        ],
      },
      outputs: [
        // output with different dispatch_id — no match
        { filename: 'dev-1.json', data: { dispatch_id: 'dev-1', role: 'dev' } },
      ],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.outputPacket).toBeNull();
  });

  it('extractEscalationMetrics: returns null when sessionYml is not a record', () => {
    const raw: RawSession = {
      taskId: 'FEAT-NULL-YML',
      sessionYml: null,
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.escalationMetrics).toBeNull();
  });

  it('normalisePhases: skips entries with non-PhaseName names', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PHASE',
      sessionYml: {
        task_id: 'FEAT-PHASE',
        feature_name: 'Phase',
        current_phase: 'implementation',
        started_at: '2026-01-01T00:00:00Z',
        phase_history: [
          { phase: 'unknown-phase', started_at: '2026-01-01T00:00:00Z' },
          {
            phase: 'specify',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T00:15:00Z',
            artifact_status: 'approved',
          },
        ],
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    // Only specify phase passes (unknown-phase filtered out)
    expect(session.phases).toHaveLength(1);
    expect(session.phases[0]!.name).toBe('specify');
  });

  it('normaliseDispatches: manifest with non-array actual_dispatches returns []', () => {
    const raw: RawSession = {
      taskId: 'FEAT-NOARR',
      sessionYml: {
        task_id: 'FEAT-NOARR',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: { expected_pipeline: [], actual_dispatches: 'not-an-array' },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(0);
  });

  it('normaliseDispatches: reads pmNote and completedAt correctly', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PMNOTE',
      sessionYml: {
        task_id: 'FEAT-PMNOTE',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T01:00:00Z',
            pm_note: 'Important note',
            loop: 1,
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.pmNote).toBe('Important note');
    expect(session.dispatches[0]!.completedAt).toBe('2026-01-01T01:00:00Z');
    expect(session.dispatches[0]!.loop).toBe(1);
  });

  it('aggregateQaResults: skips non-qa outputs and non-record/invalid entries', () => {
    const raw: RawSession = {
      taskId: 'FEAT-QA',
      sessionYml: {
        task_id: 'FEAT-QA',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [
        // non-qa role — skipped
        {
          filename: 'dev.json',
          data: { role: 'dev', ac_coverage: [{ ac: 'AC-001', status: 'pass' }] },
        },
        // qa but ac_coverage not array — skipped
        { filename: 'qa-bad.json', data: { role: 'qa', ac_coverage: 'not-array' } },
        // qa with valid entries including non-record and invalid status
        {
          filename: 'qa-mixed.json',
          data: {
            role: 'qa',
            ac_coverage: [
              'not-a-record', // skipped
              { ac: 123, status: 'pass' }, // ac not string → skipped
              { ac: 'AC-001', status: 'invalid-status' }, // invalid status → skipped
              { ac: 'AC-002', status: 'pass' }, // valid
            ],
          },
        },
      ],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.qaResults).toHaveLength(1);
    expect(session.qaResults[0]!.ac).toBe('AC-002');
  });

  it('normalisePhases: startedAt and artifact_status use fallback when missing', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PHASE2',
      sessionYml: {
        task_id: 'FEAT-PHASE2',
        feature_name: 'Phase2',
        current_phase: 'implementation',
        started_at: '2026-01-01T00:00:00Z',
        phase_history: [
          // no started_at or artifact_status
          { phase: 'specify' },
          // non-record entry
          'not-an-object',
        ],
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    // non-record is skipped; only the specify entry
    expect(session.phases).toHaveLength(1);
    expect(session.phases[0]!.startedAt).toBeNull();
    expect(session.phases[0]!.status).toBe('unknown');
  });

  it('normaliseExpectedPipeline: handles non-record pipeline entries and missing fields', () => {
    const raw: RawSession = {
      taskId: 'FEAT-PIPELINE',
      sessionYml: {
        task_id: 'FEAT-PIPELINE',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [
          'not-a-record', // skipped
          { required_roles: ['dev', 'invalid-role'] }, // batch_id/task_id absent → undefined; filters invalid role
          { batch_id: 'B1', task_id: 'T1', required_roles: ['qa'] },
        ],
        actual_dispatches: [],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.expectedPipeline).toHaveLength(2);
    expect(session.expectedPipeline[0]!.batchId).toBeUndefined();
    expect(session.expectedPipeline[0]!.requiredRoles).toEqual(['dev']); // 'invalid-role' filtered
    expect(session.expectedPipeline[1]!.batchId).toBe('B1');
  });

  it('normaliseExpectedPipeline: handles non-array required_roles', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ROLES',
      sessionYml: {
        task_id: 'FEAT-ROLES',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [
          { batch_id: 'B1', required_roles: 'not-array' }, // required_roles not array → []
        ],
        actual_dispatches: [],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.expectedPipeline[0]!.requiredRoles).toEqual([]);
  });

  it('extractEscalationMetrics: returns null when escalation_rate is not a number', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ESCM',
      sessionYml: {
        task_id: 'FEAT-ESCM',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
        escalation_metrics: { escalation_rate: 'not-a-number', pending_human_tasks: 0 },
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.escalationMetrics).toBeNull();
  });

  it('extractEscalationMetrics: returns null when escalation_metrics is not a record', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ESCM2',
      sessionYml: {
        task_id: 'FEAT-ESCM2',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
        escalation_metrics: 'not-a-record',
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.escalationMetrics).toBeNull();
  });

  it('normaliseDispatches: reads usage field from manifest entry when valid (FEAT-003 AC-017)', () => {
    const raw: RawSession = {
      taskId: 'FEAT-USAGE',
      sessionYml: {
        task_id: 'FEAT-USAGE',
        feature_name: 'Usage',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 42000,
              tool_uses: 15,
              duration_ms: 120000,
              model: 'sonnet-4-6',
            },
          },
          // dispatch without usage — should still parse fine
          {
            dispatch_id: 'd2',
            role: 'qa',
            status: 'done',
            started_at: '2026-01-01T01:00:00Z',
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(2);
    const d1 = session.dispatches.find((d) => d.dispatchId === 'd1');
    expect(d1).toBeDefined();
    expect(d1!.usage).toBeDefined();
    expect(d1!.usage!.total_tokens).toBe(42000);
    expect(d1!.usage!.tool_uses).toBe(15);
    expect(d1!.usage!.duration_ms).toBe(120000);
    expect(d1!.usage!.model).toBe('sonnet-4-6');
    const d2 = session.dispatches.find((d) => d.dispatchId === 'd2');
    expect(d2!.usage).toBeUndefined();
  });

  it('normaliseDispatches: skips invalid usage shape (non-number total_tokens)', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BADUSAGE',
      sessionYml: {
        task_id: 'FEAT-BADUSAGE',
        feature_name: 'BadUsage',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 'not-a-number', // invalid
              tool_uses: 15,
              duration_ms: 120000,
              model: 'sonnet-4-6',
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.usage).toBeUndefined();
  });

  it('attachOutputPackets: output data that is not a record is skipped', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ATTACH',
      sessionYml: {
        task_id: 'FEAT-ATTACH',
        feature_name: 'X',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          { dispatch_id: 'd1', role: 'dev', status: 'done', started_at: '2026-01-01T00:00:00Z' },
        ],
      },
      outputs: [
        // data is not a record → isRecord returns false → skip
        { filename: 'bad.json', data: 'not-an-object' },
      ],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.outputPacket).toBeNull();
  });

  // AC-022 backfill merge tests
  it('normaliseDispatches: backfill usage applied when actual_dispatches entry has no usage (AC-022)', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BACKFILL',
      sessionYml: {
        task_id: 'FEAT-BACKFILL',
        feature_name: 'Backfill',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          // no usage field — should be filled by backfill
          {
            dispatch_id: 'batch-a-dev',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
          },
        ],
        pre_feat_001_backfilled_usage: [
          {
            dispatch_id: 'batch-a-dev',
            total_tokens: 46175,
            tool_uses: 24,
            duration_ms: 123173,
            model: 'sonnet-4-6',
            backfill_source: 'conversation_log_estimate',
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(1);
    const d = session.dispatches[0]!;
    expect(d.usage).toBeDefined();
    expect(d.usage!.total_tokens).toBe(46175);
    expect(d.usage!.tool_uses).toBe(24);
    expect(d.usage!.duration_ms).toBe(123173);
    expect(d.usage!.model).toBe('sonnet-4-6');
  });

  it('normaliseDispatches: real capture wins over backfill when both present (AC-022)', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BACKFILL2',
      sessionYml: {
        task_id: 'FEAT-BACKFILL2',
        feature_name: 'Backfill2',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          // has real usage — should NOT be overridden by backfill
          {
            dispatch_id: 'feat-003-batch-x-dev',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 99999,
              tool_uses: 50,
              duration_ms: 999999,
              model: 'opus-4-7',
            },
          },
        ],
        pre_feat_003_backfilled_usage: [
          {
            dispatch_id: 'feat-003-batch-x-dev',
            total_tokens: 11111,
            tool_uses: 5,
            duration_ms: 11111,
            model: 'haiku-4-5',
            backfill_source: 'conversation_log_estimate',
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(1);
    const d = session.dispatches[0]!;
    // real capture must win
    expect(d.usage!.total_tokens).toBe(99999);
    expect(d.usage!.model).toBe('opus-4-7');
  });

  it('normaliseDispatches: backfill entry with no matching actual dispatch is ignored (AC-022)', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BACKFILL3',
      sessionYml: {
        task_id: 'FEAT-BACKFILL3',
        feature_name: 'Backfill3',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'real-dispatch',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
          },
        ],
        pre_feat_001_backfilled_usage: [
          {
            dispatch_id: 'some-other-dispatch', // no matching actual dispatch
            total_tokens: 5000,
            tool_uses: 3,
            duration_ms: 15000,
            model: 'sonnet-4-6',
            backfill_source: 'conversation_log_estimate',
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(1);
    // the actual dispatch has no usage (backfill was for a different dispatch_id)
    expect(session.dispatches[0]!.usage).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // cost_usd auto-population (agentops-cost-tracking-patch)
  // ---------------------------------------------------------------------------

  it('enricher auto-populates cost_usd for dispatch with known model and no prior cost_usd', () => {
    const raw: RawSession = {
      taskId: 'FEAT-COST-AUTO',
      sessionYml: {
        task_id: 'FEAT-COST-AUTO',
        feature_name: 'CostAuto',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 100000,
              tool_uses: 5,
              duration_ms: 60000,
              model: 'sonnet-4-6',
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    const d1 = session.dispatches.find((d) => d.dispatchId === 'd1');
    expect(d1).toBeDefined();
    expect(d1!.usage).toBeDefined();
    // cost_usd must be populated (positive number, sonnet-4-6 = $3/$15 per MTok)
    expect(d1!.usage!.cost_usd).toBeDefined();
    expect(typeof d1!.usage!.cost_usd).toBe('number');
    expect(d1!.usage!.cost_usd).toBeGreaterThan(0);
  });

  it('enricher preserves manually-set cost_usd when already present', () => {
    const raw: RawSession = {
      taskId: 'FEAT-COST-MANUAL',
      sessionYml: {
        task_id: 'FEAT-COST-MANUAL',
        feature_name: 'CostManual',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 100000,
              tool_uses: 5,
              duration_ms: 60000,
              model: 'sonnet-4-6',
              cost_usd: 9.99,
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    const d1 = session.dispatches.find((d) => d.dispatchId === 'd1');
    expect(d1!.usage!.cost_usd).toBe(9.99);
  });

  it('enricher does not populate cost_usd when model is unknown', () => {
    const raw: RawSession = {
      taskId: 'FEAT-COST-UNKNOWN',
      sessionYml: {
        task_id: 'FEAT-COST-UNKNOWN',
        feature_name: 'CostUnknown',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 100000,
              tool_uses: 5,
              duration_ms: 60000,
              model: 'unknown',
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    const d1 = session.dispatches.find((d) => d.dispatchId === 'd1');
    expect(d1!.usage!.cost_usd).toBeUndefined();
  });

  it('enricher auto-populates cost_usd for pm-orchestrator synthesized dispatch', () => {
    const raw: RawSession = {
      taskId: 'FEAT-COST-PM',
      sessionYml: {
        task_id: 'FEAT-COST-PM',
        feature_name: 'CostPm',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [],
        pm_orchestrator_sessions: [
          {
            session_id: 'abc12345-0000-0000-0000-000000000000',
            model: 'opus-4-7',
            started_at: '2026-01-01T00:00:00Z',
            completed_at: '2026-01-01T01:00:00Z',
            note: 'PM session test',
            usage: {
              input_tokens: 10000,
              output_tokens: 5000,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              tool_uses: 3,
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    const pmDispatch = session.dispatches.find((d) => d.role === 'pm-orchestrator');
    expect(pmDispatch).toBeDefined();
    expect(pmDispatch!.usage).toBeDefined();
    // opus-4-7 = $5/$25 per MTok; 10k input = $0.05, 5k output = $0.125 → ~$0.175
    expect(pmDispatch!.usage!.cost_usd).toBeDefined();
    expect(pmDispatch!.usage!.cost_usd).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // FEAT-007 regression fixes
  // ---------------------------------------------------------------------------

  it('normaliseDispatches: normalizes long-form model "claude-sonnet-4-6" and populates cost_usd', () => {
    // Regression: manifest entries emit "claude-sonnet-4-6" but pricing table uses "sonnet-4-6"
    const raw: RawSession = {
      taskId: 'FEAT-MODEL-NORMALIZE',
      sessionYml: {
        task_id: 'FEAT-MODEL-NORMALIZE',
        feature_name: 'ModelNormalize',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd-sonnet',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 100000,
              tool_uses: 10,
              duration_ms: 60000,
              model: 'claude-sonnet-4-6',
            },
          },
          {
            dispatch_id: 'd-haiku',
            role: 'qa',
            status: 'done',
            started_at: '2026-01-01T01:00:00Z',
            usage: {
              total_tokens: 50000,
              tool_uses: 5,
              duration_ms: 30000,
              model: 'claude-haiku-4-5',
            },
          },
          {
            dispatch_id: 'd-opus',
            role: 'code-reviewer',
            status: 'done',
            started_at: '2026-01-01T02:00:00Z',
            usage: {
              total_tokens: 80000,
              tool_uses: 8,
              duration_ms: 45000,
              model: 'claude-opus-4-7',
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches).toHaveLength(3);

    const sonnet = session.dispatches.find((d) => d.dispatchId === 'd-sonnet');
    expect(sonnet!.usage!.model).toBe('sonnet-4-6');
    expect(sonnet!.usage!.cost_usd).toBeDefined();
    expect(sonnet!.usage!.cost_usd).toBeGreaterThan(0);

    const haiku = session.dispatches.find((d) => d.dispatchId === 'd-haiku');
    expect(haiku!.usage!.model).toBe('haiku-4-5');
    expect(haiku!.usage!.cost_usd).toBeDefined();
    expect(haiku!.usage!.cost_usd).toBeGreaterThan(0);

    const opus = session.dispatches.find((d) => d.dispatchId === 'd-opus');
    expect(opus!.usage!.model).toBe('opus-4-7');
    expect(opus!.usage!.cost_usd).toBeDefined();
    expect(opus!.usage!.cost_usd).toBeGreaterThan(0);
  });

  it('aggregateQaResults: handles object-map shape with status strings (FEAT-007 regression)', () => {
    // Regression: QA output packets emit ac_coverage as { "AC-001": "pass", "AC-002": "deferred" }
    const raw: RawSession = {
      taskId: 'FEAT-QA-OBJMAP',
      sessionYml: {
        task_id: 'FEAT-QA-OBJMAP',
        feature_name: 'QaObjMap',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [
        {
          filename: 'qa-obj.json',
          data: {
            role: 'qa',
            ac_coverage: {
              'AC-001': 'pass',
              'AC-002': 'fail',
              'AC-003': 'partial',
              'AC-004': 'deferred', // maps to 'partial'
              'AC-005': '', // empty string → skip
            },
          },
        },
      ],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.qaResults).toHaveLength(4);
    const byAc = Object.fromEntries(session.qaResults.map((r) => [r.ac, r.status]));
    expect(byAc['AC-001']).toBe('pass');
    expect(byAc['AC-002']).toBe('fail');
    expect(byAc['AC-003']).toBe('partial');
    expect(byAc['AC-004']).toBe('partial'); // deferred → partial
    expect(byAc['AC-005']).toBeUndefined(); // empty string skipped
  });

  it('aggregateQaResults: handles object-map shape with evidence-ID arrays (FEAT-007 regression)', () => {
    // Regression: QA output packets emit ac_coverage as { "AC-002": ["ev-001", "ev-002"] }
    const raw: RawSession = {
      taskId: 'FEAT-QA-EVARRAY',
      sessionYml: {
        task_id: 'FEAT-QA-EVARRAY',
        feature_name: 'QaEvArray',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [
        {
          filename: 'qa-ev.json',
          data: {
            role: 'qa',
            ac_coverage: {
              'AC-002': ['ev-001', 'ev-002'], // non-empty array → 'pass'
              'AC-003': ['ev-001'], // non-empty array → 'pass'
              'AC-099': [], // empty array → skip
            },
          },
        },
      ],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.qaResults).toHaveLength(2);
    const byAc = Object.fromEntries(session.qaResults.map((r) => [r.ac, r.status]));
    expect(byAc['AC-002']).toBe('pass');
    expect(byAc['AC-003']).toBe('pass');
    expect(byAc['AC-099']).toBeUndefined(); // empty array skipped
  });

  it('aggregateQaResults: legacy array shape still works alongside new object-map support', () => {
    // Ensure the old format (array of {ac, status}) is not broken
    const raw: RawSession = {
      taskId: 'FEAT-QA-LEGACY',
      sessionYml: {
        task_id: 'FEAT-QA-LEGACY',
        feature_name: 'QaLegacy',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [
        {
          filename: 'qa-legacy.json',
          data: {
            role: 'qa',
            ac_coverage: [
              { ac: 'AC-010', status: 'pass' },
              { ac: 'AC-011', status: 'fail' },
            ],
          },
        },
      ],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.qaResults).toHaveLength(2);
    expect(session.qaResults[0]!.ac).toBe('AC-010');
    expect(session.qaResults[0]!.status).toBe('pass');
    expect(session.qaResults[1]!.ac).toBe('AC-011');
    expect(session.qaResults[1]!.status).toBe('fail');
  });

  it('normalizeModel: fuzzy matches model strings containing "opus"', () => {
    const raw: RawSession = {
      taskId: 'FEAT-FUZZY-OPUS',
      sessionYml: {
        task_id: 'FEAT-FUZZY-OPUS',
        feature_name: 'FuzzyOpus',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 1000,
              tool_uses: 1,
              duration_ms: 1000,
              model: 'anthropic-opus-model',
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.usage!.model).toBe('opus-4-7');
  });

  it('normalizeModel: fuzzy matches model strings containing "haiku"', () => {
    const raw: RawSession = {
      taskId: 'FEAT-FUZZY-HAIKU',
      sessionYml: {
        task_id: 'FEAT-FUZZY-HAIKU',
        feature_name: 'FuzzyHaiku',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          {
            dispatch_id: 'd1',
            role: 'dev',
            status: 'done',
            started_at: '2026-01-01T00:00:00Z',
            usage: {
              total_tokens: 1000,
              tool_uses: 1,
              duration_ms: 1000,
              model: 'anthropic-haiku-model',
            },
          },
        ],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.usage!.model).toBe('haiku-4-5');
  });

  it('buildBackfillLookup: skips backfill entries with non-array value', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BF-NONARR',
      sessionYml: {
        task_id: 'FEAT-BF-NONARR',
        feature_name: 'BfNonArr',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          { dispatch_id: 'd1', role: 'dev', status: 'done', started_at: '2026-01-01T00:00:00Z' },
        ],
        pre_feat_001_backfilled_usage: 'not-an-array',
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.usage).toBeUndefined();
  });

  it('buildBackfillLookup: skips backfill entries that are not records', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BF-NONREC',
      sessionYml: {
        task_id: 'FEAT-BF-NONREC',
        feature_name: 'BfNonRec',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          { dispatch_id: 'd1', role: 'dev', status: 'done', started_at: '2026-01-01T00:00:00Z' },
        ],
        pre_feat_001_backfilled_usage: ['not-a-record', 42, null],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.usage).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // AC-002: priorFlows / bypassFlows injection (T-006)
  // ---------------------------------------------------------------------------

  it('AC-002: compliance=pre-standard when taskId is in priorFlows', () => {
    const raw: RawSession = {
      taskId: 'FEAT-OLD',
      sessionYml: {
        task_id: 'FEAT-OLD',
        feature_name: 'OldFlow',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw, ['FEAT-OLD'], []);
    expect(session.compliance).toBe('pre-standard');
  });

  it('AC-002: compliance=pm-bypass when taskId is in bypassFlows', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BYPASS',
      sessionYml: {
        task_id: 'FEAT-BYPASS',
        feature_name: 'BypassFlow',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw, [], ['FEAT-BYPASS']);
    expect(session.compliance).toBe('pm-bypass');
  });

  it('AC-002: compliance=standard when taskId not in any flow list', () => {
    const raw: RawSession = {
      taskId: 'FEAT-NEW',
      sessionYml: {
        task_id: 'FEAT-NEW',
        feature_name: 'NewFlow',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw, ['FEAT-OLD'], ['FEAT-BYPASS']);
    expect(session.compliance).toBe('standard');
  });

  it('AC-002: compliance=standard by default (empty arrays) when no priorFlows/bypassFlows passed', () => {
    const raw: RawSession = {
      taskId: 'FEAT-ANY',
      sessionYml: {
        task_id: 'FEAT-ANY',
        feature_name: 'AnyFlow',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: null,
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    // called with no priorFlows/bypassFlows — defaults to []
    const session = enrich(raw);
    expect(session.compliance).toBe('standard');
  });

  it('buildBackfillLookup: skips backfill entries without string dispatch_id', () => {
    const raw: RawSession = {
      taskId: 'FEAT-BF-NOID',
      sessionYml: {
        task_id: 'FEAT-BF-NOID',
        feature_name: 'BfNoId',
        current_phase: 'done',
        started_at: '2026-01-01T00:00:00Z',
      },
      manifest: {
        expected_pipeline: [],
        actual_dispatches: [
          { dispatch_id: 'd1', role: 'dev', status: 'done', started_at: '2026-01-01T00:00:00Z' },
        ],
        pre_feat_001_backfilled_usage: [{ dispatch_id: 123, total_tokens: 1000 }],
      },
      outputs: [],
      specMd: null,
      sessionDirPath: '/tmp/fake',
    };
    const session = enrich(raw);
    expect(session.dispatches[0]!.usage).toBeUndefined();
  });
});
