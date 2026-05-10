import { STYLES_CSS } from '../shared/styles.css';

describe('STYLES_CSS', () => {
  it('is a non-empty string', () => {
    expect(typeof STYLES_CSS).toBe('string');
    expect(STYLES_CSS.length).toBeGreaterThan(0);
  });

  it('references CSS tokens via var(--*) syntax', () => {
    expect(STYLES_CSS).toMatch(/var\(--[\w-]+\)/);
  });

  it('contains .badge-pass class', () => {
    expect(STYLES_CSS).toContain('.badge-pass');
  });

  it('contains .badge-warn class', () => {
    expect(STYLES_CSS).toContain('.badge-warn');
  });

  it('contains .badge-fail class', () => {
    expect(STYLES_CSS).toContain('.badge-fail');
  });

  it('contains .kpi-bar class', () => {
    expect(STYLES_CSS).toContain('.kpi-bar');
  });

  it('contains .story-card class', () => {
    expect(STYLES_CSS).toContain('.story-card');
  });

  it('contains .flow-grid class', () => {
    expect(STYLES_CSS).toContain('.flow-grid');
  });

  it('contains .md-embed class', () => {
    expect(STYLES_CSS).toContain('.md-embed');
  });

  it('contains .badge class', () => {
    expect(STYLES_CSS).toContain('.badge');
  });

  it('contains box-sizing reset', () => {
    expect(STYLES_CSS).toContain('box-sizing: border-box');
  });

  it('contains body margin reset', () => {
    expect(STYLES_CSS).toContain('margin: 0');
  });

  it('contains sticky positioning for .kpi-bar', () => {
    expect(STYLES_CSS).toContain('position: sticky');
  });

  it('contains grid layout for .flow-grid', () => {
    expect(STYLES_CSS).toContain('display: grid');
    expect(STYLES_CSS).toContain('repeat(auto-fill, minmax(240px, 1fr))');
  });

  it('contains details/summary styling', () => {
    expect(STYLES_CSS).toContain('cursor: pointer');
  });

  it('is <= 10KB sanity check', () => {
    expect(STYLES_CSS.length).toBeLessThanOrEqual(10 * 1024);
  });
});
