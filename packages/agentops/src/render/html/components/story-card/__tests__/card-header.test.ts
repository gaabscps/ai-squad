/**
 * Unit tests for card-header renderer — FEAT-005 T-006.
 * AC-001, AC-002, AC-019.
 */

import { renderCardHeader } from '../parts/card-header';
import type { BatchData } from '../types';

function makeBatch(overrides: Partial<BatchData> = {}): BatchData {
  return {
    batchId: 'BATCH-A',
    title: 'Setup + Foundational configs',
    state: 'done',
    durationMs: 6300000,
    costUsd: 1.23,
    tasksCovered: ['T-001', 'T-002'],
    acsCovered: [{ id: 'AC-001', evidence: 'done' }],
    acScope: ['AC-001'],
    filesChanged: [],
    rolesPipeline: ['dev'],
    dispatches: [],
    summary: null,
    retryEntries: [],
    pmNote: null,
    loops: 0,
    ...overrides,
  };
}

describe('renderCardHeader', () => {
  it('renders human title with dot separator', () => {
    const html = renderCardHeader(makeBatch());
    expect(html).toContain('<header>');
    expect(html).toContain('BATCH-A');
    expect(html).toContain('Setup + Foundational configs');
    expect(html).toContain('<span class="dot">·</span>');
  });

  it('AC-001: omits title when title equals batchId (case-insensitive)', () => {
    const html = renderCardHeader(makeBatch({ title: 'BATCH-A', batchId: 'BATCH-A' }));
    expect(html).not.toContain('<span class="dot">·</span>');
    expect(html).toContain('BATCH-A');
  });

  it('AC-001: case-insensitive compare triggers dedup for lowercase title', () => {
    const html = renderCardHeader(makeBatch({ title: 'batch-a', batchId: 'BATCH-A' }));
    expect(html).not.toContain('<span class="dot">·</span>');
  });

  it('AC-002/AC-019: renders badge with aria-label for done state', () => {
    const html = renderCardHeader(makeBatch({ state: 'done' }));
    expect(html).toContain('aria-label="status: done"');
    expect(html).toContain('badge-pass');
    expect(html).toContain('✓ done');
  });

  it('AC-002: badge for done-retried state', () => {
    const html = renderCardHeader(makeBatch({ state: 'done-retried' }));
    expect(html).toContain('badge-warn');
    expect(html).toContain('↻ done (retried)');
    expect(html).toContain('aria-label="status: done with retries"');
  });

  it('AC-002: badge for escalated state', () => {
    const html = renderCardHeader(makeBatch({ state: 'escalated' }));
    expect(html).toContain('badge-fail');
    expect(html).toContain('✗ escalated');
  });

  it('AC-002: badge for blocked state', () => {
    const html = renderCardHeader(makeBatch({ state: 'blocked' }));
    expect(html).toContain('badge-fail');
    expect(html).toContain('⏸ blocked');
  });

  it('AC-002: badge for running state', () => {
    const html = renderCardHeader(makeBatch({ state: 'running' }));
    expect(html).toContain('badge-neutral');
    expect(html).toContain('◌ running');
  });

  it('XSS regression: escapes script tags in title', () => {
    const html = renderCardHeader(
      makeBatch({ title: '<script>alert("xss")</script>', batchId: 'BATCH-X' }),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS regression: escapes special chars in batchId', () => {
    const html = renderCardHeader(makeBatch({ batchId: '<B>', title: '<B>' }));
    expect(html).not.toContain('<B>');
    expect(html).toContain('&lt;B&gt;');
  });

  it('AC-019: output is wrapped in <header>', () => {
    const html = renderCardHeader(makeBatch());
    expect(html).toMatch(/^<header>/);
    expect(html).toMatch(/<\/header>$/);
  });
});
