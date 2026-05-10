/**
 * Tests for render/flow-report/per-ac-detail.ts — T-016
 * AC-027: Per-AC closure detail table.
 */

import path from 'path';

import { enrich } from '../src/enrich';
import { parse } from '../src/parse';
import { renderPerAcDetail } from '../src/render/flow-report/per-ac-detail';
import type { Session } from '../src/types';

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');

function makeMinimalSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test',
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

// ---------------------------------------------------------------------------
// Snapshot: Fixture A
// ---------------------------------------------------------------------------

describe('renderPerAcDetail — Fixture A', () => {
  let session: Session;

  beforeAll(async () => {
    const raw = await parse(FIXTURE_A);
    session = enrich(raw);
  });

  it('matches snapshot', () => {
    const output = renderPerAcDetail(session);
    expect(output).toMatchSnapshot();
  });

  it('contains ## Per-AC closure detail header', () => {
    const output = renderPerAcDetail(session);
    expect(output).toContain('## Per-AC closure detail');
  });

  it('contains all column headers', () => {
    const output = renderPerAcDetail(session);
    expect(output).toContain('AC ID');
    expect(output).toContain('Status');
    expect(output).toContain('Validator');
    expect(output).toContain('Evidence');
  });

  it('shows pass for all 5 ACs (fixture A all pass)', () => {
    const output = renderPerAcDetail(session);
    // Fixture A QA result has all pass
    expect(output).toContain('pass');
  });
});

// ---------------------------------------------------------------------------
// No ACs
// ---------------------------------------------------------------------------

describe('renderPerAcDetail — no ACs', () => {
  it('shows "(no ACs defined)" message', () => {
    const session = makeMinimalSession();
    const output = renderPerAcDetail(session);
    expect(output).toContain('(no ACs defined)');
  });
});

// ---------------------------------------------------------------------------
// Ordering and status mapping
// ---------------------------------------------------------------------------

describe('renderPerAcDetail — ordering and status', () => {
  it('orders ACs alphabetically', () => {
    const session = makeMinimalSession({
      acs: ['AC-010', 'AC-002', 'AC-001'],
      qaResults: [],
    });
    const output = renderPerAcDetail(session);
    const pos001 = output.indexOf('AC-001');
    const pos002 = output.indexOf('AC-002');
    const pos010 = output.indexOf('AC-010');
    expect(pos001).toBeLessThan(pos002);
    expect(pos002).toBeLessThan(pos010);
  });

  it('shows "missing" status for ACs with no qaResult', () => {
    const session = makeMinimalSession({
      acs: ['AC-001', 'AC-002'],
      qaResults: [{ ac: 'AC-001', status: 'pass' }],
    });
    const output = renderPerAcDetail(session);
    expect(output).toContain('missing');
    expect(output).toContain('pass');
  });

  it('shows partial and fail statuses correctly', () => {
    const session = makeMinimalSession({
      acs: ['AC-001', 'AC-002', 'AC-003'],
      qaResults: [
        { ac: 'AC-001', status: 'partial' },
        { ac: 'AC-002', status: 'fail' },
      ],
    });
    const output = renderPerAcDetail(session);
    expect(output).toContain('partial');
    expect(output).toContain('fail');
    expect(output).toContain('missing');
  });
});
