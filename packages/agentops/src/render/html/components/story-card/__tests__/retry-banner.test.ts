/**
 * Unit tests for retry-banner renderer — FEAT-005 T-010.
 * AC-010, AC-011, AC-012.
 */

import { renderRetryBanner } from '../parts/retry-banner';
import type { BatchData } from '../types';

type RetryEntries = BatchData['retryEntries'];

describe('renderRetryBanner', () => {
  it('AC-012: returns empty string for empty retryEntries', () => {
    expect(renderRetryBanner([])).toBe('');
  });

  it('AC-010: renders aside for a single retry', () => {
    const entries: RetryEntries = [{ role: 'dev', loop: 2, reason: 'lint failed' }];
    const html = renderRetryBanner(entries);
    expect(html).toContain('<aside');
    expect(html).toContain('story-card__retry');
    expect(html).toContain('role="status"');
    expect(html).toContain('⚠');
    expect(html).toContain('dev retried 1×');
    expect(html).toContain('loop 2: lint failed');
  });

  it('AC-010: renders two loop entries in one aside for same role', () => {
    const entries: RetryEntries = [
      { role: 'dev', loop: 2, reason: 'lint failed' },
      { role: 'dev', loop: 3, reason: 'typecheck failed' },
    ];
    const html = renderRetryBanner(entries);
    // One aside for dev with both entries
    const asideCount = (html.match(/<aside/g) ?? []).length;
    expect(asideCount).toBe(1);
    expect(html).toContain('dev retried 2×');
    expect(html).toContain('loop 2: lint failed');
    expect(html).toContain('loop 3: typecheck failed');
  });

  it('AC-010: renders separate asides for different roles', () => {
    const entries: RetryEntries = [
      { role: 'dev', loop: 2, reason: 'lint failed' },
      { role: 'qa', loop: 2, reason: 'test failed' },
    ];
    const html = renderRetryBanner(entries);
    const asideCount = (html.match(/<aside/g) ?? []).length;
    expect(asideCount).toBe(2);
    expect(html).toContain('dev retried 1×');
    expect(html).toContain('qa retried 1×');
  });

  it('AC-011: escapes HTML in reason', () => {
    const entries: RetryEntries = [
      { role: 'dev', loop: 2, reason: '<script>alert("xss")</script>' },
    ];
    const html = renderRetryBanner(entries);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes role name in output', () => {
    // roles are typed but escape is applied defensively
    const entries: RetryEntries = [{ role: 'dev', loop: 2, reason: 'reason' }];
    const html = renderRetryBanner(entries);
    expect(html).toContain('dev retried');
  });

  it('loop entries sorted ascending by loop number', () => {
    const entries: RetryEntries = [
      { role: 'dev', loop: 3, reason: 'third' },
      { role: 'dev', loop: 2, reason: 'second' },
    ];
    const html = renderRetryBanner(entries);
    const loop2Idx = html.indexOf('loop 2:');
    const loop3Idx = html.indexOf('loop 3:');
    expect(loop2Idx).toBeLessThan(loop3Idx);
  });
});
