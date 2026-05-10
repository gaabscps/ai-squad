/**
 * Unit tests for drilldowns renderer — FEAT-005 T-011.
 * AC-013, AC-014, AC-015, AC-016, AC-017, AC-018.
 */

import { renderDrilldowns } from '../parts/drilldowns';
import type { BatchData } from '../types';

function makeBatch(overrides: Partial<BatchData> = {}): BatchData {
  return {
    batchId: 'BATCH-A',
    title: 'Setup',
    state: 'done',
    durationMs: 6300000,
    costUsd: 1.0,
    tasksCovered: ['T-001'],
    acsCovered: [
      { id: 'AC-001', evidence: 'implemented in src/x.ts' },
      { id: 'AC-002', evidence: 'verified via test' },
    ],
    acScope: ['AC-001', 'AC-002'],
    filesChanged: [
      { path: 'src/a.ts', action: 'create', tasksCovered: ['T-001'] },
      { path: 'src/b.ts', action: 'modify', tasksCovered: ['T-001'] },
    ],
    rolesPipeline: ['dev', 'qa'],
    dispatches: [
      {
        dispatchId: 'batch-a-dev',
        role: 'dev',
        loop: null,
        durationMs: 5000,
        totalTokens: 1234,
        status: 'done',
      },
      {
        dispatchId: 'batch-a-qa',
        role: 'qa',
        loop: null,
        durationMs: 2000,
        totalTokens: null,
        status: 'done',
      },
    ],
    summary: null,
    retryEntries: [],
    pmNote: 'All good.',
    loops: 0,
    ...overrides,
  };
}

describe('renderDrilldowns', () => {
  it('AC-013: renders wrapper div', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('class="story-card__drilldowns"');
  });

  it('AC-013: renders exactly 4 details elements', () => {
    const html = renderDrilldowns(makeBatch());
    const count = (html.match(/<details>/g) ?? []).length;
    expect(count).toBe(4);
  });

  it('AC-013: 4 details in correct order: Files → ACs → Pipeline → PM note', () => {
    const html = renderDrilldowns(makeBatch());
    const filesIdx = html.indexOf('Files changed');
    const acsIdx = html.indexOf('ACs covered');
    const pipelineIdx = html.indexOf('Pipeline trace');
    const pmIdx = html.indexOf('PM note');
    expect(filesIdx).toBeLessThan(acsIdx);
    expect(acsIdx).toBeLessThan(pipelineIdx);
    expect(pipelineIdx).toBeLessThan(pmIdx);
  });

  it('AC-013: each summary includes count', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('Files changed (2)');
    expect(html).toContain('ACs covered (2)');
    expect(html).toContain('Pipeline trace (2 dispatches)');
    expect(html).toContain('PM note');
  });

  it('AC-014: files table has thead with path/action/tasks', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('<th>path</th>');
    expect(html).toContain('<th>action</th>');
    expect(html).toContain('<th>tasks</th>');
  });

  it('AC-014: files table rows render path and action', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('src/a.ts');
    expect(html).toContain('create');
    expect(html).toContain('src/b.ts');
    expect(html).toContain('modify');
  });

  it('AC-014: long paths are truncated to 60 chars', () => {
    const longPath = 'a'.repeat(70);
    const html = renderDrilldowns(
      makeBatch({ filesChanged: [{ path: longPath, action: 'create', tasksCovered: [] }] }),
    );
    // truncated at 60: 59 chars + ellipsis
    expect(html).toContain('a'.repeat(59) + '…');
    expect(html).not.toContain('a'.repeat(70));
  });

  it('AC-015: ACs list renders id and evidence', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('<strong>AC-001</strong>');
    expect(html).toContain('implemented in src/x.ts');
    expect(html).toContain('<strong>AC-002</strong>');
    expect(html).toContain('verified via test');
  });

  it('AC-015: evidence truncated at 160 chars', () => {
    const longEvidence = 'e'.repeat(200);
    const html = renderDrilldowns(
      makeBatch({ acsCovered: [{ id: 'AC-001', evidence: longEvidence }] }),
    );
    expect(html).toContain('e'.repeat(159) + '…');
    expect(html).not.toContain('e'.repeat(200));
  });

  it('AC-016: pipeline trace table headers', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('<th>role</th>');
    expect(html).toContain('<th>dispatch_id</th>');
    expect(html).toContain('<th>loop</th>');
    expect(html).toContain('<th>duration</th>');
    expect(html).toContain('<th>tokens</th>');
    expect(html).toContain('<th>status</th>');
  });

  it('AC-016: dispatch rows render role and id', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).toContain('batch-a-dev');
    expect(html).toContain('batch-a-qa');
  });

  it('AC-016: loop null renders as —', () => {
    const html = renderDrilldowns(makeBatch());
    // Both dispatches have loop: null → each row has —
    const pipelineSection = html.slice(html.indexOf('Pipeline trace'));
    expect(pipelineSection).toContain('—');
  });

  it('AC-016: loop number renders when set', () => {
    const batch = makeBatch({
      dispatches: [
        {
          dispatchId: 'batch-a-dev-loop2',
          role: 'dev',
          loop: 2,
          durationMs: 1000,
          totalTokens: 500,
          status: 'done',
        },
      ],
    });
    const html = renderDrilldowns(batch);
    const pipelineSection = html.slice(html.indexOf('Pipeline trace'));
    expect(pipelineSection).toContain('>2<');
  });

  it('AC-016: tokens null renders as —', () => {
    const html = renderDrilldowns(makeBatch());
    // qa dispatch has totalTokens: null
    const pipelineSection = html.slice(html.indexOf('Pipeline trace'));
    // At least one — in tokens column
    expect(pipelineSection).toContain('—');
  });

  it('AC-016: dispatch_id truncated to 24 chars', () => {
    const longId = 'x'.repeat(30);
    const batch = makeBatch({
      dispatches: [
        {
          dispatchId: longId,
          role: 'dev',
          loop: null,
          durationMs: 1000,
          totalTokens: null,
          status: 'done',
        },
      ],
    });
    const html = renderDrilldowns(batch);
    expect(html).toContain('x'.repeat(23) + '…');
    expect(html).not.toContain('x'.repeat(30));
  });

  it('AC-017: PM note renders when set', () => {
    const html = renderDrilldowns(makeBatch({ pmNote: 'All checks pass.' }));
    const pmSection = html.slice(html.indexOf('PM note'));
    expect(pmSection).toContain('All checks pass.');
    expect(pmSection).toContain('story-card__pmnote');
  });

  it('AC-017: PM note fallback when null', () => {
    const html = renderDrilldowns(makeBatch({ pmNote: null }));
    const pmSection = html.slice(html.indexOf('PM note'));
    expect(pmSection).toContain('(no PM note)');
  });

  it('AC-018: no script tags in output (pure HTML details/summary)', () => {
    const html = renderDrilldowns(makeBatch());
    expect(html).not.toContain('<script');
  });

  it('XSS regression: escapes HTML in PM note', () => {
    const html = renderDrilldowns(makeBatch({ pmNote: '<script>evil()</script>' }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('XSS regression: escapes HTML in file path', () => {
    const html = renderDrilldowns(
      makeBatch({ filesChanged: [{ path: '<img src=x>', action: 'create', tasksCovered: [] }] }),
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('XSS regression: escapes HTML in AC evidence', () => {
    const html = renderDrilldowns(
      makeBatch({ acsCovered: [{ id: 'AC-001', evidence: '<b>bold</b>' }] }),
    );
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });
});
