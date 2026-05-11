/**
 * TDD tests for normalisePmSessions enricher (T-019, dev L2).
 * Covers AC-014 (backward compat: v1 manifest → []) and AC-015 (pm_sessions array parsing).
 *
 * New in L2 (logic-reviewer findings):
 * - f2: negative tokens/cost rejected (entry dropped)
 * - f3: missing usage subfields rejected (entry dropped, not defaulted to 0)
 * - f4: total_tokens < 0 rejected (same rule as f2)
 * - f6: duplicate session_id deduped (first occurrence wins)
 */

import path from 'path';
import fs from 'fs';

import { normalisePmSessions } from '../src/enrich/pm-sessions';
import type { PmSession } from '../src/enrich/pm-sessions';

// ---------------------------------------------------------------------------
// Case (a): v1 manifest — no pm_sessions field → returns []
// ---------------------------------------------------------------------------

describe('normalisePmSessions: v1 manifest (no pm_sessions field)', () => {
  it('returns [] when manifest has no pm_sessions key', () => {
    const manifest = {
      schema_version: 1,
      task_id: 'FEAT-001',
      actual_dispatches: [],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('returns [] when manifest is null', () => {
    expect(normalisePmSessions(null)).toEqual([]);
  });

  it('returns [] when manifest is a non-object (string)', () => {
    expect(normalisePmSessions('not-an-object')).toEqual([]);
  });

  it('returns [] when pm_sessions is present but not an array', () => {
    const manifest = { pm_sessions: { bad: 'shape' } };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('returns [] when pm_sessions is null', () => {
    const manifest = { pm_sessions: null };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Case (b): v2 manifest with 2 valid entries → returns 2 entries
// ---------------------------------------------------------------------------

describe('normalisePmSessions: v2 manifest with valid entries', () => {
  const platformEntry = {
    session_id: 'sess-platform-001',
    started_at: '2026-05-11T00:00:00Z',
    completed_at: '2026-05-11T01:00:00Z',
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      cost_usd: 0.012,
    },
    source: 'platform_captured',
  };

  const selfReportedEntry = {
    session_id: 'sess-self-002',
    started_at: '2026-05-11T01:00:00Z',
    completed_at: null,
    usage: {
      input_tokens: 200,
      output_tokens: 100,
      total_tokens: 300,
      cost_usd: 0.003,
    },
    source: 'self_reported',
  };

  const manifest = {
    schema_version: 2,
    task_id: 'FEAT-004',
    actual_dispatches: [],
    pm_sessions: [platformEntry, selfReportedEntry],
  };

  let result: PmSession[];

  beforeAll(() => {
    result = normalisePmSessions(manifest);
  });

  it('returns 2 entries', () => {
    expect(result).toHaveLength(2);
  });

  it('first entry has source platform_captured', () => {
    expect(result[0]!.source).toBe('platform_captured');
  });

  it('second entry has source self_reported', () => {
    expect(result[1]!.source).toBe('self_reported');
  });

  it('preserves sessionId on both entries', () => {
    expect(result[0]!.sessionId).toBe('sess-platform-001');
    expect(result[1]!.sessionId).toBe('sess-self-002');
  });

  it('preserves startedAt and completedAt', () => {
    expect(result[0]!.startedAt).toBe('2026-05-11T00:00:00Z');
    expect(result[0]!.completedAt).toBe('2026-05-11T01:00:00Z');
    expect(result[1]!.completedAt).toBeNull();
  });

  it('maps usage fields: inputTokens, outputTokens, totalTokens, costUsd', () => {
    const u = result[0]!.usage;
    expect(u.inputTokens).toBe(1000);
    expect(u.outputTokens).toBe(500);
    expect(u.totalTokens).toBe(1500);
    expect(u.costUsd).toBe(0.012);
  });

  it('second entry cost_usd=0.003 preserved exactly', () => {
    expect(result[1]!.usage.costUsd).toBe(0.003);
  });
});

// ---------------------------------------------------------------------------
// Case (c): malformed entry → silently dropped, valid entries returned
// ---------------------------------------------------------------------------

describe('normalisePmSessions: malformed entries silently dropped', () => {
  it('drops entry missing session_id, returns only valid entries', () => {
    const manifest = {
      pm_sessions: [
        {
          // missing session_id
          started_at: '2026-05-11T00:00:00Z',
          completed_at: null,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: 0 },
          source: 'platform_captured',
        },
        {
          session_id: 'sess-valid-001',
          started_at: '2026-05-11T01:00:00Z',
          completed_at: null,
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_usd: 0.001 },
          source: 'self_reported',
        },
      ],
    };
    const result = normalisePmSessions(manifest);
    expect(result).toHaveLength(1);
    expect(result[0]!.sessionId).toBe('sess-valid-001');
  });

  it('drops entry missing started_at', () => {
    const manifest = {
      pm_sessions: [
        {
          session_id: 'sess-bad',
          // missing started_at
          completed_at: null,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: 0 },
          source: 'platform_captured',
        },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with invalid source value', () => {
    const manifest = {
      pm_sessions: [
        {
          session_id: 'sess-bad-source',
          started_at: '2026-05-11T00:00:00Z',
          completed_at: null,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: 0 },
          source: 'unknown_source',
        },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops non-object entries in pm_sessions array', () => {
    const manifest = {
      pm_sessions: [null, 42, 'bad', true],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with non-object usage', () => {
    const manifest = {
      pm_sessions: [
        {
          session_id: 'sess-bad-usage',
          started_at: '2026-05-11T00:00:00Z',
          completed_at: null,
          usage: 'not-an-object',
          source: 'platform_captured',
        },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with completed_at that is neither string nor null', () => {
    const manifest = {
      pm_sessions: [
        {
          session_id: 'sess-bad-completed',
          started_at: '2026-05-11T00:00:00Z',
          completed_at: 12345, // number — invalid
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: 0 },
          source: 'platform_captured',
        },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Case (d): backward compat — parse existing FEAT-001 fixture manifest
// ---------------------------------------------------------------------------

describe('normalisePmSessions: backward compat with FEAT-001 fixture', () => {
  const FIXTURE_PATH = path.resolve(
    __dirname,
    '../__fixtures__/.agent-session/FEAT-FIXTURE-A/dispatch-manifest.json',
  );

  it('fixture file exists', () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
  });

  it('parses FEAT-FIXTURE-A (v1 manifest) without crash and returns []', () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf-8')) as unknown;
    const result = normalisePmSessions(raw);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Case (e): negative values — logic-reviewer f2/f3 — drop entry
// ---------------------------------------------------------------------------

describe('normalisePmSessions: negative token/cost values rejected (logic-reviewer f2/f3)', () => {
  const baseEntry = {
    session_id: 'sess-neg-base',
    started_at: '2026-05-11T00:00:00Z',
    completed_at: null,
    source: 'platform_captured',
  };

  it('drops entry with negative input_tokens', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: -1, output_tokens: 100, total_tokens: 99, cost_usd: 0.001 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with negative output_tokens', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: 100, output_tokens: -5, total_tokens: 95, cost_usd: 0.001 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with negative total_tokens', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: 100, output_tokens: 50, total_tokens: -1, cost_usd: 0.001 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with negative cost_usd', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_usd: -0.001 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('accepts entry with all-zero usage (zero cost is valid)', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost_usd: 0 } },
      ],
    };
    const result = normalisePmSessions(manifest);
    expect(result).toHaveLength(1);
    expect(result[0]!.usage.costUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Case (f): empty/incomplete usage — logic-reviewer f3 — drop entry
// ---------------------------------------------------------------------------

describe('normalisePmSessions: incomplete usage subfields rejected (logic-reviewer f3)', () => {
  const baseEntry = {
    session_id: 'sess-empty-usage',
    started_at: '2026-05-11T00:00:00Z',
    completed_at: null,
    source: 'platform_captured',
  };

  it('drops entry with empty usage object (all fields missing)', () => {
    const manifest = {
      pm_sessions: [{ ...baseEntry, usage: {} }],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with usage missing cost_usd', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with usage missing total_tokens', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.001 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });

  it('drops entry with non-numeric usage field (string instead of number)', () => {
    const manifest = {
      pm_sessions: [
        { ...baseEntry, usage: { input_tokens: '100', output_tokens: 50, total_tokens: 150, cost_usd: 0.001 } },
      ],
    };
    expect(normalisePmSessions(manifest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Case (g): dedup on session_id — logic-reviewer f6
// ---------------------------------------------------------------------------

describe('normalisePmSessions: session_id deduplication (logic-reviewer f6)', () => {
  it('first occurrence wins when session_id is duplicated', () => {
    const manifest = {
      pm_sessions: [
        {
          session_id: 'sess-dup',
          started_at: '2026-05-11T00:00:00Z',
          completed_at: null,
          usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150, cost_usd: 0.001 },
          source: 'platform_captured',
        },
        {
          session_id: 'sess-dup', // duplicate
          started_at: '2026-05-11T02:00:00Z',
          completed_at: null,
          usage: { input_tokens: 999, output_tokens: 999, total_tokens: 1998, cost_usd: 9.999 },
          source: 'self_reported',
        },
      ],
    };
    const result = normalisePmSessions(manifest);
    expect(result).toHaveLength(1);
    // First occurrence wins
    expect(result[0]!.source).toBe('platform_captured');
    expect(result[0]!.usage.inputTokens).toBe(100);
  });

  it('unique session_ids all retained', () => {
    const manifest = {
      pm_sessions: [
        {
          session_id: 'sess-a',
          started_at: '2026-05-11T00:00:00Z',
          completed_at: null,
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: 0.001 },
          source: 'platform_captured',
        },
        {
          session_id: 'sess-b',
          started_at: '2026-05-11T01:00:00Z',
          completed_at: null,
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, cost_usd: 0.002 },
          source: 'self_reported',
        },
      ],
    };
    const result = normalisePmSessions(manifest);
    expect(result).toHaveLength(2);
  });
});
