/**
 * Tests for T-008 / AC-005..010: warn-on-unknown + deprecation handling.
 *
 * Fixture: dispatch-manifest with 1 entry per canonical status (8) +
 * 1 entry with unknown status "completed" + 1 entry with deprecated "partial".
 *
 * Total input: 10 dispatches (8 canonical + 1 unknown + 1 deprecated).
 */

import { normaliseDispatchesWithWarnings } from '../src/enrich/dispatches';
import { VALID_STATUSES } from '../src/enrich/guards';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const CANONICAL_STATUSES = [...VALID_STATUSES]; // e.g. ["pending","running","done",...]

function makeDispatch(
  dispatchId: string,
  role: string,
  status: string,
  taskId = 'T-TEST',
): Record<string, unknown> {
  return {
    dispatch_id: dispatchId,
    task_id: taskId,
    role,
    status,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: null,
  };
}

function makeManifest(dispatches: Record<string, unknown>[]): unknown {
  return {
    schema_version: 1,
    task_id: 'FEAT-TEST-006',
    plan_generated_at: '2026-01-01T00:00:00Z',
    expected_pipeline: [],
    actual_dispatches: dispatches,
  };
}

// Build the fixture: 1 per canonical status + "completed" (unknown) + "partial" (deprecated)
const canonicalDispatches = CANONICAL_STATUSES.map((status, i) =>
  makeDispatch(`d-canonical-${i}`, 'dev', status),
);
const unknownStatusDispatch = makeDispatch('d-unknown', 'dev', 'completed');
const deprecatedStatusDispatch = makeDispatch('d-deprecated', 'dev', 'partial');

const ALL_DISPATCHES = [...canonicalDispatches, unknownStatusDispatch, deprecatedStatusDispatch];
const FIXTURE_MANIFEST = makeManifest(ALL_DISPATCHES);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('feat-006 no-silent-drop (T-008 / AC-005..010)', () => {
  let result: ReturnType<typeof normaliseDispatchesWithWarnings>;

  beforeAll(() => {
    result = normaliseDispatchesWithWarnings(FIXTURE_MANIFEST);
  });

  // AC-006: each canonical status appears in dispatches
  it('AC-006: all 8 canonical status dispatches appear in output dispatches', () => {
    const outputStatuses = result.dispatches.map((d) => d.status);
    for (const status of CANONICAL_STATUSES) {
      expect(outputStatuses).toContain(status);
    }
  });

  // AC-007: warning emitted for unknown status "completed"
  it('AC-007: warning emitted for unknown status "completed" with required fields', () => {
    const warn = result.warnings.find(
      (w) => w.kind === 'unknown_status' && w.dispatch_id === 'd-unknown',
    );
    expect(warn).toBeDefined();
    expect(warn!.dispatch_id).toBe('d-unknown');
    expect(warn!.task_id).toBe('T-TEST');
    expect(warn!.role).toBe('dev');
    expect(warn!.status).toBe('completed');
    expect(Array.isArray(warn!.valid)).toBe(true);
    expect(warn!.valid).toEqual(expect.arrayContaining(CANONICAL_STATUSES));
  });

  // AC-007 (deprecated): warning emitted for deprecated "partial"
  it('AC-007 (deprecated): warning emitted for deprecated "partial" status', () => {
    const warn = result.warnings.find(
      (w) => w.kind === 'deprecated_status' && w.dispatch_id === 'd-deprecated',
    );
    expect(warn).toBeDefined();
    expect(warn!.dispatch_id).toBe('d-deprecated');
    expect(warn!.task_id).toBe('T-TEST');
    expect(warn!.status).toBe('partial');
    expect(typeof warn!.note).toBe('string');
    expect(warn!.note).toMatch(/deprecated/i);
  });

  // AC-008: unknown status dispatch appears in dispatches (not silently dropped)
  it('AC-008: dispatch with unknown status "completed" appears in dispatches (not silently dropped)', () => {
    const found = result.dispatches.find((d) => d.dispatchId === 'd-unknown');
    expect(found).toBeDefined();
    // It must appear with an "unknown_status" status marker
    expect(found!.status).toBe('unknown_status');
  });

  // AC-009: count invariant — input count == dispatches + dropped (unknown_role warnings)
  it('AC-009: count(input dispatches) == count(dispatches in output) + count(unknown_role drops)', () => {
    const unknownRoleDropCount = result.warnings.filter((w) => w.kind === 'unknown_role').length;
    // Total input = 10 (8 canonical + 1 unknown_status + 1 deprecated)
    const totalInput = ALL_DISPATCHES.length;
    const totalOutput = result.dispatches.length + unknownRoleDropCount;
    expect(totalOutput).toBe(totalInput);
  });

  // AC-010: deprecated "partial" dispatch is processed normally (appears in dispatches)
  it('AC-010: deprecated "partial" dispatch processed normally (appears in dispatches)', () => {
    const found = result.dispatches.find((d) => d.dispatchId === 'd-deprecated');
    expect(found).toBeDefined();
    // partial is a deprecated status but still processed normally
    expect(found!.status).toBe('partial');
  });

  // AC-005: "partial" gets a deprecated_status warning, not unknown_status
  it('AC-005: "partial" gets deprecated_status warning (not unknown_status)', () => {
    const deprecatedWarning = result.warnings.find(
      (w) => w.kind === 'deprecated_status' && w.status === 'partial',
    );
    const unknownWarning = result.warnings.find(
      (w) => w.kind === 'unknown_status' && w.dispatch_id === 'd-deprecated',
    );
    expect(deprecatedWarning).toBeDefined();
    expect(unknownWarning).toBeUndefined();
  });

  // Invalid role: emits unknown_role warning and drops dispatch
  it('unknown_role dispatch is dropped with warning', () => {
    const manifest = makeManifest([makeDispatch('d-badrole', 'not-a-role', 'done')]);
    const r = normaliseDispatchesWithWarnings(manifest);
    expect(r.dispatches).toHaveLength(0);
    const warn = r.warnings.find((w) => w.kind === 'unknown_role');
    expect(warn).toBeDefined();
    expect(warn!.dispatch_id).toBe('d-badrole');
    expect(warn!.role).toBe('not-a-role');
    expect(Array.isArray(warn!.valid)).toBe(true);
  });

  // Backward-compat: normaliseDispatches still returns plain array
  it('normaliseDispatches (legacy export) still returns Session dispatches array', async () => {
    const { normaliseDispatches } = await import('../src/enrich/dispatches');
    const dispatches = normaliseDispatches(FIXTURE_MANIFEST);
    expect(Array.isArray(dispatches)).toBe(true);
    // Should include canonical + unknown_status + deprecated — 10 total minus 0 unknown_role drops
    expect(dispatches.length).toBe(ALL_DISPATCHES.length);
  });
});
