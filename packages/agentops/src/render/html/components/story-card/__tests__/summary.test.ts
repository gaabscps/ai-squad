/**
 * Unit tests for summary renderer — FEAT-005 T-009.
 * AC-009.
 */

import { renderSummary } from '../parts/summary';

describe('renderSummary', () => {
  it('renders summary paragraph with text', () => {
    const html = renderSummary('ESLint flat config uses spread-reduce. It works well.');
    expect(html).toContain('class="story-card__summary"');
    expect(html).toContain('ESLint flat config uses spread-reduce.');
    expect(html).not.toContain('story-card__summary--empty');
  });

  it('AC-009: renders fallback when null', () => {
    const html = renderSummary(null);
    expect(html).toContain('story-card__summary--empty');
    expect(html).toContain('(no summary)');
  });

  it('AC-009: renders fallback for empty string', () => {
    const html = renderSummary('');
    expect(html).toContain('story-card__summary--empty');
    expect(html).toContain('(no summary)');
  });

  it('XSS regression: escapes HTML in summary text', () => {
    const html = renderSummary('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes ampersands', () => {
    const html = renderSummary('A & B');
    expect(html).toContain('A &amp; B');
  });
});
