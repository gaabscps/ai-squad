import { shell } from '../shared/shell';

describe('shell', () => {
  it('starts with HTML5 doctype', () => {
    const result = shell({ title: 'Test', body: '<p>body</p>' });
    expect(result).toMatch(/^<!DOCTYPE html>/i);
  });

  it('includes html element with default lang pt-BR', () => {
    const result = shell({ title: 'Test', body: '' });
    expect(result).toContain('<html lang="pt-BR">');
  });

  it('respects custom lang attribute', () => {
    const result = shell({ title: 'Test', body: '', lang: 'en' });
    expect(result).toContain('<html lang="en">');
  });

  it('includes charset meta tag', () => {
    const result = shell({ title: 'Test', body: '' });
    expect(result).toContain('<meta charset="UTF-8">');
  });

  it('includes viewport meta tag', () => {
    const result = shell({ title: 'Test', body: '' });
    expect(result).toContain('name="viewport"');
    expect(result).toContain('width=device-width');
    expect(result).toContain('initial-scale=1');
  });

  it('includes title element with escaped content', () => {
    const result = shell({ title: '<Test> & More', body: '' });
    expect(result).toContain('<title>&lt;Test&gt; &amp; More</title>');
  });

  it('escapes title to prevent XSS', () => {
    const result = shell({ title: '<script>alert(1)</script>', body: '' });
    expect(result).not.toContain('<script>alert(1)</script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('includes style tag with TOKENS_CSS', () => {
    const result = shell({ title: 'Test', body: '' });
    expect(result).toContain('<style>');
    // TOKENS_CSS contains :root
    expect(result).toContain(':root');
  });

  it('includes STYLES_CSS content', () => {
    const result = shell({ title: 'Test', body: '' });
    // STYLES_CSS contains body { margin: 0 }
    expect(result).toContain('margin: 0');
  });

  it('includes dark mode media query from TOKENS_CSS', () => {
    const result = shell({ title: 'Test', body: '' });
    expect(result).toContain('@media (prefers-color-scheme: dark)');
  });

  it('renders body content inside body tags', () => {
    const result = shell({ title: 'Test', body: '<main>Hello World</main>' });
    expect(result).toContain('<body><main>Hello World</main></body>');
  });

  it('includes closing html tag', () => {
    const result = shell({ title: 'Test', body: '' });
    expect(result).toContain('</html>');
  });

  it('tokens and styles are inlined in a single style tag', () => {
    const result = shell({ title: 'Test', body: '' });
    // Count style tags — should be exactly 1
    const styleOpenCount = (result.match(/<style>/g) ?? []).length;
    expect(styleOpenCount).toBe(1);
  });
});
