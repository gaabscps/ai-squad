import { escape } from '../shared/escape';

describe('escape', () => {
  it('returns empty string unchanged', () => {
    expect(escape('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(escape('hello world')).toBe('hello world');
  });

  it('escapes ampersand', () => {
    expect(escape('&')).toBe('&amp;');
  });

  it('escapes less-than', () => {
    expect(escape('<')).toBe('&lt;');
  });

  it('escapes greater-than', () => {
    expect(escape('>')).toBe('&gt;');
  });

  it('escapes double quote', () => {
    expect(escape('"')).toBe('&quot;');
  });

  it('escapes single quote', () => {
    expect(escape("'")).toBe('&#39;');
  });

  it('escapes injection attempt <script>alert(1)</script>', () => {
    expect(escape('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('re-escapes mixed entities without double-escaping', () => {
    // "&amp;<b>" should become "&amp;amp;&lt;b&gt;" — the & in &amp; gets re-escaped
    expect(escape('&amp;<b>')).toBe('&amp;amp;&lt;b&gt;');
  });

  it('handles ampersand before other special chars (order matters)', () => {
    const input = '&<>"\'';
    expect(escape(input)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
