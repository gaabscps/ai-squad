import { markdownEmbed } from '../components/markdown-embed';

describe('markdownEmbed', () => {
  it('renders raw-data section', () => {
    const result = markdownEmbed('# Hello');
    expect(result).toContain('<section class="raw-data">');
    expect(result).toContain('</section>');
  });

  it('renders h2 Raw data heading', () => {
    const result = markdownEmbed('# Hello');
    expect(result).toContain('<h2>Raw data</h2>');
  });

  it('renders details element (collapsed by default, no open attr)', () => {
    const result = markdownEmbed('# Hello');
    expect(result).toContain('<details>');
    expect(result).not.toContain('<details open');
  });

  it('renders summary with "View raw Markdown report"', () => {
    const result = markdownEmbed('# Hello');
    expect(result).toContain('<summary>View raw Markdown report</summary>');
  });

  it('renders md-embed div inside details', () => {
    const result = markdownEmbed('# Hello');
    expect(result).toContain('<div class="md-embed">');
  });

  it('converts h2 markdown to HTML h2', () => {
    const result = markdownEmbed('## Section Title');
    expect(result).toContain('<h2>Section Title</h2>');
  });

  it('converts h3 markdown to HTML h3', () => {
    const result = markdownEmbed('### Sub Section');
    expect(result).toContain('<h3>Sub Section</h3>');
  });

  it('converts markdown list to HTML ul', () => {
    const result = markdownEmbed('- item 1\n- item 2');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>item 1</li>');
    expect(result).toContain('<li>item 2</li>');
  });

  it('converts markdown table to HTML table', () => {
    const md = '| Col A | Col B |\n| --- | --- |\n| val 1 | val 2 |';
    const result = markdownEmbed(md);
    expect(result).toContain('<table>');
    expect(result).toContain('<td>val 1</td>');
  });

  it('empty markdown still renders details structure', () => {
    const result = markdownEmbed('');
    expect(result).toContain('<details>');
    expect(result).toContain('<summary>View raw Markdown report</summary>');
  });

  it('escapes or removes <script> tags in markdown', () => {
    // marked escapes raw HTML by default in safe mode / or strips it
    const result = markdownEmbed('<script>alert(1)</script>');
    // The script tag should not be executable — either escaped or removed
    expect(result).not.toContain('<script>alert(1)</script>');
  });

  it('converts code blocks', () => {
    const result = markdownEmbed('```\nconst x = 1;\n```');
    expect(result).toContain('<code>');
  });

  it('renders paragraph text', () => {
    const result = markdownEmbed('Simple paragraph text here.');
    expect(result).toContain('<p>Simple paragraph text here.</p>');
  });
});
