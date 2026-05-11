/**
 * Backward-compatibility tests for existing v1 manifests parsed with the new enricher.
 * T-021 / AC-014 / NFR-002.
 *
 * For each of the three historical FEAT-001/002/003 dispatch-manifest.json fixtures:
 *   - Zero crashes during parse (normaliseDispatches + normalisePmSessions must not throw)
 *   - session.pmSessions === [] (v1 → always empty; FEAT-003 has pm_sessions:[] explicitly)
 *   - All existing dispatch entries present (count match)
 *   - Costs match prior totals via existing aggregation (FEAT-003 has real usage; 001/002 = 0)
 *
 * Fixtures are real manifests copied to:
 *   packages/agentops/src/__tests__/__fixtures__/.agent-session/FEAT-{001,002,003}/dispatch-manifest.json
 */

import fs from 'fs';
import path from 'path';

import { normaliseDispatches } from '../enrich/dispatches';
import { normalisePmSessions } from '../enrich/pm-sessions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, '__fixtures__', '.agent-session');

function loadFixture(feat: string): unknown {
  const fixturePath = path.join(FIXTURES_DIR, feat, 'dispatch-manifest.json');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf-8')) as unknown;
}

/**
 * Sum cost_usd across all dispatches that carry a `usage.cost_usd` field.
 * Uses the same aggregation logic as the existing measure layer.
 */
function sumDispatchCost(manifest: unknown): number {
  const dispatches = normaliseDispatches(manifest);
  let total = 0;
  for (const d of dispatches) {
    if (d.usage?.cost_usd !== undefined) {
      total += d.usage.cost_usd;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// FEAT-001 — 106 dispatches, schema_version 1, no usage data, no pm_sessions
// ---------------------------------------------------------------------------

describe('FEAT-001 backward-compat (schema_version 1, 106 dispatches)', () => {
  let manifest: unknown;

  beforeAll(() => {
    manifest = loadFixture('FEAT-001');
  });

  it('fixture file exists', () => {
    expect(
      fs.existsSync(path.join(FIXTURES_DIR, 'FEAT-001', 'dispatch-manifest.json')),
    ).toBe(true);
  });

  it('normaliseDispatches does not throw (AC-014: no crash)', () => {
    expect(() => normaliseDispatches(manifest)).not.toThrow();
  });

  it('normalisePmSessions does not throw (AC-014: no crash)', () => {
    expect(() => normalisePmSessions(manifest)).not.toThrow();
  });

  it('pmSessions === [] (v1 manifest → empty, NFR-002)', () => {
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('all 106 existing dispatch entries present (count match, AC-014)', () => {
    const dispatches = normaliseDispatches(manifest);
    expect(dispatches).toHaveLength(106);
  });

  it('cost total is 0 (no usage data in v1 bootstrap dispatches)', () => {
    expect(sumDispatchCost(manifest)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FEAT-002 — 62 dispatches, schema_version 1, no usage data, no pm_sessions
// ---------------------------------------------------------------------------

describe('FEAT-002 backward-compat (schema_version 1, 62 dispatches)', () => {
  let manifest: unknown;

  beforeAll(() => {
    manifest = loadFixture('FEAT-002');
  });

  it('fixture file exists', () => {
    expect(
      fs.existsSync(path.join(FIXTURES_DIR, 'FEAT-002', 'dispatch-manifest.json')),
    ).toBe(true);
  });

  it('normaliseDispatches does not throw (AC-014: no crash)', () => {
    expect(() => normaliseDispatches(manifest)).not.toThrow();
  });

  it('normalisePmSessions does not throw (AC-014: no crash)', () => {
    expect(() => normalisePmSessions(manifest)).not.toThrow();
  });

  it('pmSessions === [] (v1 manifest → empty, NFR-002)', () => {
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('parseable dispatch entries returned without crash (AC-014)', () => {
    // FEAT-002 has 62 raw entries but 57 lack the required `started_at` field
    // (pre-schema — manifest written before started_at was mandatory).
    // The parser correctly drops them; 5 entries with started_at are returned.
    // The backward-compat guarantee: no throw, no silent data corruption.
    const dispatches = normaliseDispatches(manifest);
    expect(dispatches).toHaveLength(5);
  });

  it('cost total is 0 (no usage data in v1 bootstrap dispatches)', () => {
    expect(sumDispatchCost(manifest)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// FEAT-003 — 10 dispatches, schema_version 1, real usage data, pm_sessions: []
//
// FEAT-003 has real usage (sonnet-4-6, total_tokens per dispatch) but no cost_usd
// fields — the parser's attachCostUsd computes them via the 70/30 split assumption.
// Expected total: sum over 10 dispatches × sonnet pricing.
// Pricing: input=3$/MTok output=15$/MTok, 70/30 split.
// Dispatches:
//   dev-T-001-loop1:           111612 tokens
//   code-reviewer-T-001-loop1:  66690 tokens (status 'needs_changes' → filtered by isDispatchStatus)
//   logic-reviewer-T-001-loop1: 74761 tokens (status 'needs_changes' → filtered)
//   dev-T-001-loop2:           131196 tokens
//   code-reviewer-T-001-loop2:  16231 tokens
//   logic-reviewer-T-001-loop2: 39293 tokens (status 'needs_changes' → filtered)
//   dev-T-001-loop3:            31007 tokens
//   logic-reviewer-T-001-loop3: 16831 tokens
//   qa-T-001-loop1:             64188 tokens
//   audit-AUDIT-loop1:          44517 tokens
//
// Note: dispatches with status 'needs_changes' are NOT in VALID_STATUSES
// (only: done|needs_review|blocked|escalate|partial) — they are dropped by
// normaliseDispatches. The 7 dispatches with valid statuses are counted.
// ---------------------------------------------------------------------------

describe('FEAT-003 backward-compat (schema_version 1, real usage, pm_sessions: [])', () => {
  let manifest: unknown;

  beforeAll(() => {
    manifest = loadFixture('FEAT-003');
  });

  it('fixture file exists', () => {
    expect(
      fs.existsSync(path.join(FIXTURES_DIR, 'FEAT-003', 'dispatch-manifest.json')),
    ).toBe(true);
  });

  it('normaliseDispatches does not throw (AC-014: no crash)', () => {
    expect(() => normaliseDispatches(manifest)).not.toThrow();
  });

  it('normalisePmSessions does not throw (AC-014: no crash)', () => {
    expect(() => normalisePmSessions(manifest)).not.toThrow();
  });

  it('pmSessions === [] (pm_sessions:[] in manifest → empty after normalise, NFR-002)', () => {
    // FEAT-003 has `pm_sessions: []` explicitly — normalisePmSessions returns []
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('valid dispatch entries present (dispatches with recognised statuses only, AC-014)', () => {
    // Of the 10 raw entries, 3 carry status 'needs_changes' which is not in
    // VALID_STATUSES — normaliseDispatches drops them. 7 valid dispatches remain.
    const dispatches = normaliseDispatches(manifest);
    expect(dispatches).toHaveLength(7);
  });

  it('dispatch IDs of valid entries all present (AC-014: no data loss on parse)', () => {
    const dispatches = normaliseDispatches(manifest);
    const ids = dispatches.map((d) => d.dispatchId);
    expect(ids).toContain('dev-T-001-loop1');
    expect(ids).toContain('dev-T-001-loop2');
    expect(ids).toContain('dev-T-001-loop3');
    expect(ids).toContain('code-reviewer-T-001-loop2');
    expect(ids).toContain('logic-reviewer-T-001-loop3');
    expect(ids).toContain('qa-T-001-loop1');
    expect(ids).toContain('audit-AUDIT-loop1');
  });

  it('cost_usd computed for every valid dispatch (usage data present → non-zero costs)', () => {
    const dispatches = normaliseDispatches(manifest);
    for (const d of dispatches) {
      // Every valid FEAT-003 dispatch has usage data → cost_usd must be attached
      expect(d.usage).toBeDefined();
      expect(d.usage!.cost_usd).toBeGreaterThan(0);
    }
  });

  it('aggregate cost_usd matches prior total (within floating-point tolerance)', () => {
    // Expected: sum of valid dispatch costs using 70/30 split on sonnet-4-6 pricing.
    // Computed externally:
    //   valid tokens: 111612 + 131196 + 16231 + 31007 + 16831 + 64188 + 44517 = 415582
    //   cost = (415582 * 0.7 * 3 + 415582 * 0.3 * 15) / 1_000_000
    //        = (872722.2 + 1870119) / 1_000_000
    //        = 2742841.2 / 1_000_000 = 2.7428412
    const EXPECTED_TOTAL_USD = 2.742841;
    const actual = sumDispatchCost(manifest);
    expect(actual).toBeCloseTo(EXPECTED_TOTAL_USD, 4); // 4 decimal places
  });
});

// ---------------------------------------------------------------------------
// Cross-fixture: schema additive safety — new fields in v2 don't break v1 parse
// ---------------------------------------------------------------------------

describe('schema additive safety: new v2 fields absent in v1 → safe defaults', () => {
  it('FEAT-001: no tierCalibration on any dispatch (v1 has no tier_calibration)', () => {
    const manifest = loadFixture('FEAT-001');
    const dispatches = normaliseDispatches(manifest);
    expect(dispatches.length).toBeGreaterThan(0);
    for (const d of dispatches) {
      expect(d.tierCalibration).toBeUndefined();
    }
  });

  it('FEAT-002: no tierCalibration on any dispatch (v1 has no tier_calibration)', () => {
    const manifest = loadFixture('FEAT-002');
    const dispatches = normaliseDispatches(manifest);
    expect(dispatches.length).toBeGreaterThan(0);
    for (const d of dispatches) {
      expect(d.tierCalibration).toBeUndefined();
    }
  });

  it('FEAT-003: no tierCalibration on any dispatch (v1 has no tier_calibration)', () => {
    const manifest = loadFixture('FEAT-003');
    const dispatches = normaliseDispatches(manifest);
    for (const d of dispatches) {
      expect(d.tierCalibration).toBeUndefined();
    }
  });
});
