/**
 * story-card/index.ts integration tests — FEAT-005 T-013.
 * Tests the storyCard() composer that assembles all parts.
 * Covers: AC-001, AC-002, AC-003, AC-004, AC-005, AC-006, AC-007, AC-009, AC-010,
 *         AC-012, AC-013, AC-018, AC-019.
 */

import type { Role } from '../../../../../types';
import { storyCard } from '../index';
import type { BatchData, BatchState } from '../index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBatch(overrides: Partial<BatchData> = {}): BatchData {
  return {
    batchId: 'BATCH-A',
    title: 'Setup + Foundational configs',
    state: 'done',
    durationMs: 6300000, // 1h45m
    costUsd: 1.23,
    tasksCovered: ['T-001', 'T-002', 'T-003'],
    acsCovered: [
      { id: 'AC-001', evidence: 'src/foo.ts:42' },
      { id: 'AC-002', evidence: 'src/bar.ts:10' },
    ],
    acScope: ['AC-001', 'AC-002', 'AC-003'],
    filesChanged: [
      { path: 'src/foo.ts', action: 'modified', tasksCovered: ['T-001'] },
      { path: 'src/bar.ts', action: 'created', tasksCovered: ['T-002'] },
    ],
    rolesPipeline: ['dev', 'code-reviewer', 'logic-reviewer', 'qa'] as Role[],
    dispatches: [
      {
        dispatchId: 'feat-001-batch-a-dev',
        role: 'dev',
        loop: 0,
        durationMs: 3600000,
        totalTokens: 12000,
        status: 'done',
      },
      {
        dispatchId: 'feat-001-batch-a-qa',
        role: 'qa',
        loop: 0,
        durationMs: 2700000,
        totalTokens: 5000,
        status: 'done',
      },
    ],
    summary: 'ESLint flat config v9 uses spread-reduce pattern. All 3 tasks complete.',
    retryEntries: [],
    pmNote: 'BATCH-A complete. Foundation established.',
    loops: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural tests (no snapshot lock-in on every byte)
// ---------------------------------------------------------------------------

describe('storyCard — structure', () => {
  it('wraps content in <article> with story-card classes (AC-019)', () => {
    const html = storyCard(makeBatch());
    expect(html).toMatch(/^<article class="story-card story-card--done"/);
  });

  it('article has aria-label with batchId (AC-019)', () => {
    const html = storyCard(makeBatch());
    expect(html).toContain('aria-label="batch BATCH-A"');
  });

  it('contains <header> with h3 and badge (AC-001, AC-002)', () => {
    const html = storyCard(makeBatch());
    expect(html).toContain('<header>');
    expect(html).toContain('<h3>');
    expect(html).toContain('BATCH-A');
    expect(html).toContain('Setup + Foundational configs');
    // Badge present
    expect(html).toContain('class="badge badge-pass"');
    expect(html).toContain('aria-label="status: done"');
  });

  it('contains stats strip with 6 KPIs (AC-005, AC-007)', () => {
    const html = storyCard(makeBatch());
    expect(html).toContain('class="story-card__stats"');
    // Duration
    expect(html).toContain('1h45m');
    // Cost
    expect(html).toContain('$1.23');
    // Tasks
    expect(html).toContain('>3<');
    // ACs — N/M because acScope provided
    expect(html).toContain('>2/3<');
    // Files
    expect(html).toContain('>2<');
    // Pipeline roles
    expect(html).toContain('story-card__pipeline');
  });

  it('contains summary paragraph (AC-009)', () => {
    const html = storyCard(makeBatch());
    expect(html).toContain('class="story-card__summary"');
    expect(html).toContain('ESLint flat config v9');
  });

  it('contains 4 drilldown <details> elements in fixed order (AC-013, AC-018)', () => {
    const html = storyCard(makeBatch());
    const detailsMatches = html.match(/<details>/g);
    expect(detailsMatches).not.toBeNull();
    expect(detailsMatches!.length).toBeGreaterThanOrEqual(4);
    // Order: Files, ACs, Pipeline, PM note
    const filesIdx = html.indexOf('Files changed');
    const acsIdx = html.indexOf('ACs covered');
    const pipelineIdx = html.indexOf('Pipeline trace');
    const pmIdx = html.indexOf('PM note');
    expect(filesIdx).toBeLessThan(acsIdx);
    expect(acsIdx).toBeLessThan(pipelineIdx);
    expect(pipelineIdx).toBeLessThan(pmIdx);
  });

  it('no <details open> — all drilldowns collapsed by default (AC-018)', () => {
    const html = storyCard(makeBatch());
    expect(html).not.toContain('<details open');
  });

  it('closes with </article>', () => {
    const html = storyCard(makeBatch());
    expect(html.trimEnd().endsWith('</article>')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-001: title dedup guard (title === batchId → no " · BATCH-A · BATCH-A")
// ---------------------------------------------------------------------------

describe('storyCard — AC-001 title dedup', () => {
  it('shows only batchId when title equals batchId (case-insensitive)', () => {
    const html = storyCard(makeBatch({ title: 'BATCH-A' }));
    // Should not show "BATCH-A · BATCH-A"
    expect(html).not.toContain('BATCH-A<span class="dot">');
    expect(html).toContain('BATCH-A');
  });

  it('shows batchId · title when title differs', () => {
    const html = storyCard(makeBatch({ title: 'My custom title' }));
    expect(html).toContain('class="dot"');
    expect(html).toContain('My custom title');
  });
});

// ---------------------------------------------------------------------------
// AC-002 / AC-004: status badge correctness
// ---------------------------------------------------------------------------

describe('storyCard — badge states (AC-002)', () => {
  const cases: { state: BatchState; expectedClass: string; expectedLabel: string }[] = [
    { state: 'done', expectedClass: 'badge-pass', expectedLabel: '✓ done' },
    { state: 'done-retried', expectedClass: 'badge-warn', expectedLabel: '↻ done (retried)' },
    { state: 'escalated', expectedClass: 'badge-fail', expectedLabel: '✗ escalated' },
    { state: 'blocked', expectedClass: 'badge-fail', expectedLabel: '⏸ blocked' },
    { state: 'running', expectedClass: 'badge-neutral', expectedLabel: '◌ running' },
  ];

  for (const { state, expectedClass, expectedLabel } of cases) {
    it(`state=${state} → article class story-card--${state}, badge ${expectedClass}`, () => {
      const html = storyCard(makeBatch({ state }));
      expect(html).toContain(`story-card--${state}`);
      expect(html).toContain(expectedClass);
      expect(html).toContain(expectedLabel);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-010 / AC-012: retry banner — conditional rendering
// ---------------------------------------------------------------------------

describe('storyCard — retry banner (AC-010, AC-012)', () => {
  it('omits retry banner entirely when retryEntries is empty (AC-012)', () => {
    const html = storyCard(makeBatch({ retryEntries: [] }));
    expect(html).not.toContain('story-card__retry');
    expect(html).not.toContain('⚠');
  });

  it('renders retry banner when retryEntries present (AC-010)', () => {
    const html = storyCard(
      makeBatch({
        state: 'done-retried',
        retryEntries: [
          { role: 'dev', loop: 2, reason: 'typecheck failed on missing import' },
          { role: 'dev', loop: 3, reason: 'lint error in generated file' },
        ],
      }),
    );
    expect(html).toContain('story-card__retry');
    expect(html).toContain('⚠');
    expect(html).toContain('dev retried 2×');
    expect(html).toContain('loop 2: typecheck failed on missing import');
    expect(html).toContain('loop 3: lint error in generated file');
  });
});

// ---------------------------------------------------------------------------
// AC-003: needs_review treated as intermediate (via state=done-retried)
// ---------------------------------------------------------------------------

describe('storyCard — AC-003 needs_review as intermediate', () => {
  it('state done when only needs_review and done dispatches → no badge-fail', () => {
    // State is computed by aggregator; here we test renderer respects the state value
    const html = storyCard(makeBatch({ state: 'done' }));
    expect(html).not.toContain('badge-fail');
    expect(html).toContain('badge-pass');
  });
});

// ---------------------------------------------------------------------------
// Snapshot tests — canonical cards
// ---------------------------------------------------------------------------

describe('storyCard — snapshots', () => {
  it('canonical done card (no retry banner)', () => {
    expect(storyCard(makeBatch())).toMatchSnapshot();
  });

  it('done-retried card with retry banner', () => {
    expect(
      storyCard(
        makeBatch({
          state: 'done-retried',
          loops: 2,
          retryEntries: [{ role: 'dev', loop: 2, reason: 'fixed typecheck' }],
        }),
      ),
    ).toMatchSnapshot();
  });

  it('escalated card (badge-fail)', () => {
    expect(storyCard(makeBatch({ state: 'escalated' }))).toMatchSnapshot();
  });

  it('running card (badge-neutral)', () => {
    expect(
      storyCard(makeBatch({ state: 'running', durationMs: null, costUsd: null })),
    ).toMatchSnapshot();
  });
});
