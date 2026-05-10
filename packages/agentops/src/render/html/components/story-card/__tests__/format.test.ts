/**
 * Unit tests for story-card format utilities — FEAT-005 T-002.
 * AC-007: formatDuration, formatCost, truncate.
 */

import { formatDuration, formatCost, truncate } from '../format';

describe('formatDuration', () => {
  it('returns — for null', () => {
    expect(formatDuration(null)).toBe('—');
  });

  it('returns 0ms for 0', () => {
    expect(formatDuration(0)).toBe('0ms');
  });

  it('returns Xms for values under 1000ms', () => {
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(500)).toBe('500ms');
  });

  it('returns Xs for exactly 1000ms', () => {
    expect(formatDuration(1000)).toBe('1s');
  });

  it('returns Xs for values under 60s', () => {
    expect(formatDuration(59000)).toBe('59s');
    expect(formatDuration(30000)).toBe('30s');
  });

  it('returns Xm for exact minutes', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(120000)).toBe('2m');
  });

  it('returns Xm Ys for minutes with remainder seconds', () => {
    expect(formatDuration(65000)).toBe('1m 5s');
    expect(formatDuration(90000)).toBe('1m 30s');
  });

  it('returns Xh for exact hours', () => {
    expect(formatDuration(3600000)).toBe('1h');
    expect(formatDuration(7200000)).toBe('2h');
  });

  it('returns XhYm for hours with remainder minutes', () => {
    expect(formatDuration(6300000)).toBe('1h45m');
    expect(formatDuration(5400000)).toBe('1h30m');
  });
});

describe('formatCost', () => {
  it('returns — for null', () => {
    expect(formatCost(null)).toBe('—');
  });

  it('returns $0.00 for 0', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('rounds to 2 decimal places', () => {
    expect(formatCost(3.4066)).toBe('$3.41');
    expect(formatCost(1.006)).toBe('$1.01');
    expect(formatCost(0.1)).toBe('$0.10');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 10)).toBe('hello');
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('truncates long strings with ellipsis', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
    expect(truncate('abcde', 4)).toBe('abc…');
  });

  it('handles max=1 edge case', () => {
    expect(truncate('abc', 1)).toBe('…');
  });

  it('handles empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});
