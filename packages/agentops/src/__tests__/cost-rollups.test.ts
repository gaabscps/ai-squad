/**
 * Cost-rollup tests for renderCostByTier + renderCostByPmSession (T-022).
 * AC-015: agentops report renders ## Cost by tier and ## Cost by PM session.
 * AC-016: tier_calibration used for cost-by-tier rollup; absent → 'unknown' bucket.
 *
 * All fixtures are synthesized inline — no external fixture files needed.
 */

import { normaliseDispatches } from '../enrich/dispatches';
import { normalisePmSessions } from '../enrich/pm-sessions';
import { renderCostByTier, renderCostByPmSession } from '../render/report';
import type { Session, PmSession } from '../types';

// ---------------------------------------------------------------------------
// Inline v2 manifest fixture — mixed tier_calibration + pm_sessions
// ---------------------------------------------------------------------------

/**
 * Synthesized v2 dispatch-manifest.json with:
 *   - 4 dispatches with tier_calibration (T1, T2, T3, T4)
 *   - 2 dispatches WITHOUT tier_calibration (→ unknown bucket)
 *   - 2 pm_sessions entries (one platform_captured, one self_reported)
 */
const V2_MANIFEST = {
  schema_version: 2,
  task_id: 'T-COST-TEST',
  started_at: '2026-05-11T00:00:00Z',
  pm_sessions: [
    {
      session_id: 'pm-sess-aaa',
      started_at: '2026-05-11T00:00:00Z',
      completed_at: '2026-05-11T01:00:00Z',
      source: 'platform_captured',
      usage: {
        input_tokens: 50000,
        output_tokens: 20000,
        total_tokens: 70000,
        cost_usd: 0.45,
      },
    },
    {
      session_id: 'pm-sess-bbb',
      started_at: '2026-05-11T02:00:00Z',
      completed_at: '2026-05-11T03:00:00Z',
      source: 'self_reported',
      usage: {
        input_tokens: 30000,
        output_tokens: 10000,
        total_tokens: 40000,
        cost_usd: 0.27,
      },
    },
  ],
  actual_dispatches: [
    // T1 dispatch
    {
      dispatch_id: 'dev-T-001-loop1',
      role: 'dev',
      status: 'done',
      started_at: '2026-05-11T00:01:00Z',
      completed_at: '2026-05-11T00:10:00Z',
      tier_calibration: { tier: 'T1', model: 'haiku', effort: 'low', loop_kind: 'dev L1' },
      usage: { total_tokens: 10000, tool_uses: 5, duration_ms: 540000, model: 'haiku-4-5', cost_usd: 0.10 },
    },
    // T2 dispatch
    {
      dispatch_id: 'code-reviewer-T-001-loop1',
      role: 'code-reviewer',
      status: 'done',
      started_at: '2026-05-11T00:11:00Z',
      completed_at: '2026-05-11T00:20:00Z',
      tier_calibration: { tier: 'T2', model: 'sonnet', effort: 'medium', loop_kind: 'review' },
      usage: { total_tokens: 20000, tool_uses: 3, duration_ms: 540000, model: 'sonnet-4-6', cost_usd: 0.20 },
    },
    // T3 dispatch
    {
      dispatch_id: 'logic-reviewer-T-001-loop1',
      role: 'logic-reviewer',
      status: 'done',
      started_at: '2026-05-11T00:21:00Z',
      completed_at: '2026-05-11T00:30:00Z',
      tier_calibration: { tier: 'T3', model: 'sonnet', effort: 'high', loop_kind: 'review' },
      usage: { total_tokens: 30000, tool_uses: 4, duration_ms: 540000, model: 'sonnet-4-6', cost_usd: 0.30 },
    },
    // T4 dispatch
    {
      dispatch_id: 'dev-T-002-loop1',
      role: 'dev',
      status: 'done',
      started_at: '2026-05-11T00:31:00Z',
      completed_at: '2026-05-11T00:50:00Z',
      tier_calibration: { tier: 'T4', model: 'opus', effort: 'high', loop_kind: 'dev L1' },
      usage: { total_tokens: 40000, tool_uses: 8, duration_ms: 1140000, model: 'opus-4-7', cost_usd: 0.40 },
    },
    // NO tier_calibration → unknown bucket
    {
      dispatch_id: 'qa-T-001-loop1',
      role: 'qa',
      status: 'done',
      started_at: '2026-05-11T00:51:00Z',
      completed_at: '2026-05-11T01:00:00Z',
      // tier_calibration intentionally absent
      usage: { total_tokens: 15000, tool_uses: 2, duration_ms: 540000, model: 'sonnet-4-6', cost_usd: 0.15 },
    },
    // NO tier_calibration → unknown bucket (second entry)
    {
      dispatch_id: 'audit-AUDIT-loop1',
      role: 'audit-agent',
      status: 'done',
      started_at: '2026-05-11T01:01:00Z',
      completed_at: '2026-05-11T01:10:00Z',
      // tier_calibration intentionally absent
      usage: { total_tokens: 12000, tool_uses: 1, duration_ms: 540000, model: 'sonnet-4-6', cost_usd: 0.12 },
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadDispatches(manifest: unknown): Session['dispatches'] {
  return normaliseDispatches(manifest);
}

function loadPmSessions(manifest: unknown): PmSession[] {
  return normalisePmSessions(manifest);
}

// ---------------------------------------------------------------------------
// normaliseDispatches — tier_calibration parsing (AC-016)
// ---------------------------------------------------------------------------

describe('normaliseDispatches: tier_calibration parsing (AC-016)', () => {
  let dispatches: Session['dispatches'];

  beforeAll(() => {
    dispatches = loadDispatches(V2_MANIFEST);
  });

  it('parses 6 valid dispatches from v2 manifest', () => {
    expect(dispatches).toHaveLength(6);
  });

  it('T1 dispatch has tierCalibration.tier === "T1"', () => {
    const d = dispatches.find((x) => x.dispatchId === 'dev-T-001-loop1');
    expect(d?.tierCalibration?.tier).toBe('T1');
  });

  it('T2 dispatch has tierCalibration.tier === "T2"', () => {
    const d = dispatches.find((x) => x.dispatchId === 'code-reviewer-T-001-loop1');
    expect(d?.tierCalibration?.tier).toBe('T2');
  });

  it('T3 dispatch has tierCalibration.tier === "T3"', () => {
    const d = dispatches.find((x) => x.dispatchId === 'logic-reviewer-T-001-loop1');
    expect(d?.tierCalibration?.tier).toBe('T3');
  });

  it('T4 dispatch has tierCalibration.tier === "T4"', () => {
    const d = dispatches.find((x) => x.dispatchId === 'dev-T-002-loop1');
    expect(d?.tierCalibration?.tier).toBe('T4');
  });

  it('qa dispatch has no tierCalibration (→ unknown bucket)', () => {
    const d = dispatches.find((x) => x.dispatchId === 'qa-T-001-loop1');
    expect(d?.tierCalibration).toBeUndefined();
  });

  it('audit dispatch has no tierCalibration (→ unknown bucket)', () => {
    const d = dispatches.find((x) => x.dispatchId === 'audit-AUDIT-loop1');
    expect(d?.tierCalibration).toBeUndefined();
  });

  it('pre-computed cost_usd is preserved (not overwritten by attachCostUsd)', () => {
    const d = dispatches.find((x) => x.dispatchId === 'dev-T-001-loop1');
    // cost_usd was explicit in fixture → attachCostUsd returns early
    expect(d?.usage?.cost_usd).toBe(0.10);
  });
});

// ---------------------------------------------------------------------------
// normalisePmSessions — v2 manifest (AC-015)
// ---------------------------------------------------------------------------

describe('normalisePmSessions: v2 manifest parsing (AC-015)', () => {
  let pmSessions: PmSession[];

  beforeAll(() => {
    pmSessions = loadPmSessions(V2_MANIFEST);
  });

  it('returns 2 PM session entries', () => {
    expect(pmSessions).toHaveLength(2);
  });

  it('first session is platform_captured', () => {
    expect(pmSessions[0]?.source).toBe('platform_captured');
    expect(pmSessions[0]?.sessionId).toBe('pm-sess-aaa');
  });

  it('second session is self_reported', () => {
    expect(pmSessions[1]?.source).toBe('self_reported');
    expect(pmSessions[1]?.sessionId).toBe('pm-sess-bbb');
  });

  it('usage fields are correctly mapped (camelCase)', () => {
    const s = pmSessions[0]!;
    expect(s.usage.inputTokens).toBe(50000);
    expect(s.usage.outputTokens).toBe(20000);
    expect(s.usage.totalTokens).toBe(70000);
    expect(s.usage.costUsd).toBe(0.45);
  });
});

// ---------------------------------------------------------------------------
// renderCostByTier — section rendered correctly (AC-015, AC-016)
// ---------------------------------------------------------------------------

describe('renderCostByTier: report section (AC-015, AC-016)', () => {
  let report: string;
  let dispatches: Session['dispatches'];

  beforeAll(() => {
    dispatches = loadDispatches(V2_MANIFEST);
    report = renderCostByTier(dispatches);
  });

  it('renders ## Cost by tier heading (AC-015)', () => {
    expect(report).toMatch(/^## Cost by tier/);
  });

  it('includes T1 row', () => {
    expect(report).toContain('T1');
  });

  it('includes T2 row', () => {
    expect(report).toContain('T2');
  });

  it('includes T3 row', () => {
    expect(report).toContain('T3');
  });

  it('includes T4 row', () => {
    expect(report).toContain('T4');
  });

  it('includes unknown bucket for dispatches missing tier_calibration (AC-016)', () => {
    expect(report).toContain('unknown');
  });

  it('T1 cost arithmetic: $0.1000', () => {
    // T1 dispatch has cost_usd=0.10
    expect(report).toContain('$0.1000');
  });

  it('T2 cost arithmetic: $0.2000', () => {
    expect(report).toContain('$0.2000');
  });

  it('T3 cost arithmetic: $0.3000', () => {
    expect(report).toContain('$0.3000');
  });

  it('T4 cost arithmetic: $0.4000', () => {
    expect(report).toContain('$0.4000');
  });

  it('unknown bucket cost = T1-missing sum = $0.2700 (0.15 + 0.12)', () => {
    // Two dispatches without tierCalibration: qa ($0.15) + audit ($0.12) = $0.27
    expect(report).toContain('$0.2700');
  });

  it('grand total arithmetic correct: 0.10+0.20+0.30+0.40+0.15+0.12 = $1.27', () => {
    // All 6 dispatches sum to $1.27; percentages should add to ~100%
    // Validate grand-total implied by the T1 percentage: 0.10/1.27 ≈ 7.9%
    expect(report).toContain('7.9%');
  });

  it('renders markdown table separator (AC-015: table format)', () => {
    expect(report).toMatch(/\|.*---.*\|/);
  });

  it('tiers appear in canonical order T1 before T4 before unknown', () => {
    const t1Pos = report.indexOf('| T1 |');
    const t4Pos = report.indexOf('| T4 |');
    const unknownPos = report.indexOf('| unknown |');
    expect(t1Pos).toBeLessThan(t4Pos);
    expect(t4Pos).toBeLessThan(unknownPos);
  });
});

// ---------------------------------------------------------------------------
// renderCostByPmSession — section rendered correctly (AC-015, AC-013)
// ---------------------------------------------------------------------------

describe('renderCostByPmSession: report section (AC-015)', () => {
  let report: string;
  let pmSessions: PmSession[];

  beforeAll(() => {
    pmSessions = loadPmSessions(V2_MANIFEST);
    report = renderCostByPmSession(pmSessions);
  });

  it('renders ## Cost by PM session heading (AC-015)', () => {
    expect(report).toMatch(/^## Cost by PM session/);
  });

  it('includes pm-sess-aaa session ID', () => {
    expect(report).toContain('pm-sess-aaa');
  });

  it('includes pm-sess-bbb session ID', () => {
    expect(report).toContain('pm-sess-bbb');
  });

  it('renders (platform-captured) source flag for first session (AC-013)', () => {
    expect(report).toContain('(platform-captured)');
  });

  it('renders (self-reported) source flag for second session (AC-013)', () => {
    expect(report).toContain('(self-reported)');
  });

  it('cost_usd for platform_captured session: $0.4500', () => {
    expect(report).toContain('$0.4500');
  });

  it('cost_usd for self_reported session: $0.2700', () => {
    expect(report).toContain('$0.2700');
  });

  it('total PM cost = $0.72 (0.45 + 0.27)', () => {
    expect(report).toContain('$0.7200');
  });

  it('renders markdown table separator', () => {
    expect(report).toMatch(/\|.*---.*\|/);
  });
});

// ---------------------------------------------------------------------------
// renderCostByTier — empty / no-cost-data guard (AC-015)
// ---------------------------------------------------------------------------

describe('renderCostByTier: no cost data fallback (AC-015)', () => {
  it('renders no-data message when all dispatches lack cost_usd', () => {
    const dispatches: Session['dispatches'] = [
      {
        dispatchId: 'dev-T-001-loop1',
        role: 'dev',
        status: 'done',
        startedAt: '2026-05-11T00:00:00Z',
        completedAt: null,
        outputPacket: null,
        loop: null,
        pmNote: null,
        // no usage → no cost_usd
      },
    ];
    const report = renderCostByTier(dispatches);
    expect(report).toContain('## Cost by tier');
    expect(report).toContain('_No cost data available._');
  });

  it('renders no-data message for empty dispatch array', () => {
    const report = renderCostByTier([]);
    expect(report).toContain('## Cost by tier');
    expect(report).toContain('_No cost data available._');
  });
});

// ---------------------------------------------------------------------------
// renderCostByPmSession — empty / no-data guard (AC-015)
// ---------------------------------------------------------------------------

describe('renderCostByPmSession: no PM session data fallback (AC-015)', () => {
  it('renders no-data message when pmSessions is undefined', () => {
    const report = renderCostByPmSession(undefined);
    expect(report).toContain('## Cost by PM session');
    expect(report).toContain('_No PM session data available._');
  });

  it('renders no-data message when pmSessions is empty array', () => {
    const report = renderCostByPmSession([]);
    expect(report).toContain('## Cost by PM session');
    expect(report).toContain('_No PM session data available._');
  });
});

// ---------------------------------------------------------------------------
// unknown bucket only: all dispatches missing tierCalibration (AC-016)
// ---------------------------------------------------------------------------

describe('renderCostByTier: all-unknown manifest (AC-016)', () => {
  it('places all cost in unknown bucket when no dispatch has tier_calibration', () => {
    const manifest = {
      schema_version: 1,
      task_id: 'T-OLD',
      started_at: '2026-05-10T00:00:00Z',
      actual_dispatches: [
        {
          dispatch_id: 'dev-old-loop1',
          role: 'dev',
          status: 'done',
          started_at: '2026-05-10T00:01:00Z',
          completed_at: '2026-05-10T00:10:00Z',
          usage: { total_tokens: 10000, tool_uses: 2, duration_ms: 540000, model: 'sonnet-4-6', cost_usd: 0.05 },
        },
        {
          dispatch_id: 'qa-old-loop1',
          role: 'qa',
          status: 'done',
          started_at: '2026-05-10T00:11:00Z',
          completed_at: '2026-05-10T00:20:00Z',
          usage: { total_tokens: 8000, tool_uses: 1, duration_ms: 540000, model: 'sonnet-4-6', cost_usd: 0.04 },
        },
      ],
    };
    const dispatches = loadDispatches(manifest);
    const report = renderCostByTier(dispatches);

    // Only unknown bucket should appear
    expect(report).toContain('unknown');
    expect(report).not.toContain('| T1 |');
    expect(report).not.toContain('| T2 |');
    expect(report).not.toContain('| T3 |');
    expect(report).not.toContain('| T4 |');

    // Total: 0.05 + 0.04 = $0.09
    expect(report).toContain('$0.0900');
  });
});

// ---------------------------------------------------------------------------
// Single-session PM: only one entry (AC-015)
// ---------------------------------------------------------------------------

describe('renderCostByPmSession: single platform_captured entry (AC-015)', () => {
  it('renders one row with correct source flag and cost', () => {
    const sessions: PmSession[] = [
      {
        sessionId: 'pm-sess-solo',
        startedAt: '2026-05-11T10:00:00Z',
        completedAt: '2026-05-11T11:00:00Z',
        source: 'platform_captured',
        usage: {
          inputTokens: 100000,
          outputTokens: 40000,
          totalTokens: 140000,
          costUsd: 1.25,
        },
      },
    ];
    const report = renderCostByPmSession(sessions);

    expect(report).toContain('pm-sess-solo');
    expect(report).toContain('(platform-captured)');
    expect(report).toContain('$1.2500');
    // Total == same as single entry
    expect(report).toMatch(/Total PM cost: \$1\.2500/);
  });
});
