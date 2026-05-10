import { badge, statusBadgeFromBatchState } from '../components/badge';

describe('badge', () => {
  it('returns span with badge and kind class', () => {
    const result = badge('✓', 'pass');
    expect(result).toBe('<span class="badge badge-pass">✓</span>');
  });

  it('escapes label to prevent XSS', () => {
    const result = badge('<script>alert(1)</script>', 'fail');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });

  it('uses badge-pass class for pass kind', () => {
    expect(badge('✓', 'pass')).toContain('badge-pass');
  });

  it('uses badge-warn class for warn kind', () => {
    expect(badge('⚠', 'warn')).toContain('badge-warn');
  });

  it('uses badge-fail class for fail kind', () => {
    expect(badge('✗', 'fail')).toContain('badge-fail');
  });

  it('uses badge-neutral class for neutral kind', () => {
    expect(badge('…', 'neutral')).toContain('badge-neutral');
  });

  it('escapes double-quotes in label', () => {
    expect(badge('"quoted"', 'neutral')).toContain('&quot;quoted&quot;');
  });

  it('escapes ampersand in label', () => {
    expect(badge('a & b', 'pass')).toContain('a &amp; b');
  });
});

describe('statusBadgeFromBatchState', () => {
  it('done with 0 loops → pass/✓', () => {
    const result = statusBadgeFromBatchState('done', 0);
    expect(result.kind).toBe('pass');
    expect(result.label).toBe('✓');
  });

  it('done with loops > 0 → warn/⚠', () => {
    const result = statusBadgeFromBatchState('done', 2);
    expect(result.kind).toBe('warn');
    expect(result.label).toBe('⚠');
  });

  it('pending_human → fail/✗', () => {
    const result = statusBadgeFromBatchState('pending_human', 0);
    expect(result.kind).toBe('fail');
    expect(result.label).toBe('✗');
  });

  it('failed → fail/✗', () => {
    const result = statusBadgeFromBatchState('failed', 0);
    expect(result.kind).toBe('fail');
    expect(result.label).toBe('✗');
  });

  it('running → neutral/…', () => {
    const result = statusBadgeFromBatchState('running', 0);
    expect(result.kind).toBe('neutral');
    expect(result.label).toBe('…');
  });

  it('pending → neutral/…', () => {
    const result = statusBadgeFromBatchState('pending', 0);
    expect(result.kind).toBe('neutral');
    expect(result.label).toBe('…');
  });

  it('unknown state → neutral/…', () => {
    const result = statusBadgeFromBatchState('unknown_state', 0);
    expect(result.kind).toBe('neutral');
    expect(result.label).toBe('…');
  });
});
