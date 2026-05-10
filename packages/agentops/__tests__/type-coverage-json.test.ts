/**
 * Tests for type-coverage-json.ts — parseTypeCoverageOutput
 */

import { parseTypeCoverageOutput } from '../src/type-coverage-json';

describe('parseTypeCoverageOutput', () => {
  it('returns zeros and empty arrays for empty string', () => {
    const result = parseTypeCoverageOutput('');
    expect(result.percent).toBe(0);
    expect(result.total).toBe(0);
    expect(result.correct).toBe(0);
    expect(result.anyCount).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('parses summary line in format "(2816 / 2841) 99.12%"', () => {
    const result = parseTypeCoverageOutput('(2816 / 2841) 99.12%');
    expect(result.correct).toBe(2816);
    expect(result.total).toBe(2841);
    expect(result.percent).toBeCloseTo(99.12);
  });

  it('parses summary line in format "123/456 80.00%"', () => {
    const result = parseTypeCoverageOutput('123/456 80.00%');
    expect(result.correct).toBe(123);
    expect(result.total).toBe(456);
    expect(result.percent).toBeCloseTo(80.0);
  });

  it('parses absolute path location line', () => {
    const result = parseTypeCoverageOutput('/abs/path/to/file.ts:10:5: someIdentifier');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      path: '/abs/path/to/file.ts',
      line: 10,
      col: 5,
      identifier: 'someIdentifier',
    });
    expect(result.anyCount).toBe(1);
  });

  it('parses relative path location line', () => {
    const result = parseTypeCoverageOutput('./src/foo.ts:3:7: bar');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({
      path: './src/foo.ts',
      line: 3,
      col: 7,
      identifier: 'bar',
    });
  });

  it('parses a mix of summary and location lines', () => {
    const stdout = ['(100 / 200) 50.00%', '/some/file.ts:1:2: x', '/other/file.ts:5:10: y'].join(
      '\n',
    );
    const result = parseTypeCoverageOutput(stdout);
    expect(result.correct).toBe(100);
    expect(result.total).toBe(200);
    expect(result.percent).toBeCloseTo(50.0);
    expect(result.files).toHaveLength(2);
    expect(result.anyCount).toBe(2);
  });

  it('ignores blank lines', () => {
    const stdout = '\n\n(10 / 20) 50.00%\n\n';
    const result = parseTypeCoverageOutput(stdout);
    expect(result.correct).toBe(10);
    expect(result.total).toBe(20);
    expect(result.files).toHaveLength(0);
  });

  it('ignores lines that match neither pattern', () => {
    const stdout = 'some random text\nanother unrelated line\n(5 / 10) 50.00%';
    const result = parseTypeCoverageOutput(stdout);
    expect(result.correct).toBe(5);
    expect(result.total).toBe(10);
    expect(result.files).toHaveLength(0);
  });
});
