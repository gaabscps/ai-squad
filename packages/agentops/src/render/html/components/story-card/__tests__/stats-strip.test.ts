/**
 * Unit tests for stats-strip renderer — FEAT-005 T-007.
 * AC-005, AC-007.
 */

import { renderStatsStrip } from '../parts/stats-strip';
import type { BatchData } from '../types';

function makeBatch(overrides: Partial<BatchData> = {}): BatchData {
  return {
    batchId: 'BATCH-A',
    title: 'Setup',
    state: 'done',
    durationMs: 6300000,
    costUsd: 3.41,
    tasksCovered: ['T-001', 'T-002', 'T-003'],
    acsCovered: [
      { id: 'AC-001', evidence: 'e1' },
      { id: 'AC-002', evidence: 'e2' },
    ],
    acScope: ['AC-001', 'AC-002', 'AC-003'],
    filesChanged: [
      { path: 'src/a.ts', action: 'create', tasksCovered: [] },
      { path: 'src/b.ts', action: 'modify', tasksCovered: [] },
    ],
    rolesPipeline: ['dev', 'code-reviewer', 'logic-reviewer', 'qa'],
    dispatches: [],
    summary: null,
    retryEntries: [],
    pmNote: null,
    loops: 0,
    ...overrides,
  };
}

describe('renderStatsStrip', () => {
  it('renders the stats container', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('class="story-card__stats"');
  });

  it('AC-005: renders 6 KPIs — time label present', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('>time<');
  });

  it('AC-005: renders cost label', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('>cost<');
  });

  it('AC-005: renders tasks label', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('>tasks<');
  });

  it('AC-005: renders ACs label', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('>ACs<');
  });

  it('AC-005: renders files label', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('>files<');
  });

  it('AC-005: renders pipeline span', () => {
    const html = renderStatsStrip(makeBatch());
    expect(html).toContain('story-card__pipeline');
  });

  it('AC-005: KPIs appear in correct order (time, cost, tasks, ACs, files)', () => {
    const html = renderStatsStrip(makeBatch());
    const timeIdx = html.indexOf('>time<');
    const costIdx = html.indexOf('>cost<');
    const tasksIdx = html.indexOf('>tasks<');
    const acsIdx = html.indexOf('>ACs<');
    const filesIdx = html.indexOf('>files<');
    expect(timeIdx).toBeLessThan(costIdx);
    expect(costIdx).toBeLessThan(tasksIdx);
    expect(tasksIdx).toBeLessThan(acsIdx);
    expect(acsIdx).toBeLessThan(filesIdx);
  });

  it('AC-007: formats duration as human-friendly', () => {
    const html = renderStatsStrip(makeBatch({ durationMs: 6300000 }));
    expect(html).toContain('1h45m');
  });

  it('AC-007: formats cost as $X.XX', () => {
    const html = renderStatsStrip(makeBatch({ costUsd: 3.41 }));
    expect(html).toContain('$3.41');
  });

  it('AC-007: shows — for null cost', () => {
    const html = renderStatsStrip(makeBatch({ costUsd: null }));
    expect(html).toContain('—');
  });

  it('AC-007: shows — for null duration', () => {
    const html = renderStatsStrip(makeBatch({ durationMs: null }));
    // first — is duration
    expect(html).toContain('—');
  });

  it('AC-005: renders N/M format when acScope is non-null', () => {
    const html = renderStatsStrip(
      makeBatch({ acsCovered: [{ id: 'AC-001', evidence: 'e' }], acScope: ['AC-001', 'AC-002'] }),
    );
    expect(html).toContain('1/2');
  });

  it('AC-005: renders N format when acScope is null', () => {
    const html = renderStatsStrip(
      makeBatch({ acsCovered: [{ id: 'AC-001', evidence: 'e' }], acScope: null }),
    );
    // Should show just the count, not N/M
    expect(html).toContain('>1<');
    expect(html).not.toMatch(/>\d+\/\d+</);
  });

  it('renders correct tasks count', () => {
    const html = renderStatsStrip(makeBatch({ tasksCovered: ['T-001', 'T-002'] }));
    expect(html).toContain('>2<');
  });

  it('renders correct files count', () => {
    const html = renderStatsStrip(
      makeBatch({
        filesChanged: [
          { path: 'a.ts', action: 'create', tasksCovered: [] },
          { path: 'b.ts', action: 'create', tasksCovered: [] },
          { path: 'c.ts', action: 'create', tasksCovered: [] },
        ],
      }),
    );
    // The files count should be present as a stat value
    const html2 = html;
    const filesIdx = html2.indexOf('>files<');
    const afterFiles = html2.slice(filesIdx);
    expect(afterFiles).toContain('>3<');
  });
});
