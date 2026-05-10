import { TOKENS_CSS } from '../shared/tokens.css';

describe('TOKENS_CSS', () => {
  it('is a string', () => {
    expect(typeof TOKENS_CSS).toBe('string');
  });

  it('contains :root {', () => {
    expect(TOKENS_CSS).toContain(':root {');
  });

  it('contains @media (prefers-color-scheme: dark)', () => {
    expect(TOKENS_CSS).toContain('@media (prefers-color-scheme: dark)');
  });

  it('light and dark modes define the same set of CSS variables', () => {
    // Extract variable names from light mode (:root block before @media)
    const lightBlockMatch = TOKENS_CSS.match(/:root\s*\{([^}]+)\}/);
    expect(lightBlockMatch).not.toBeNull();
    const lightVars = extractVarNames(lightBlockMatch![1]);

    // Extract variable names from dark mode (:root block inside @media)
    const darkMediaMatch = TOKENS_CSS.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^{]*:root\s*\{([^}]+)\}/,
    );
    expect(darkMediaMatch).not.toBeNull();
    const darkVars = extractVarNames(darkMediaMatch![1]);

    // Both sets must be identical (set diff = 0)
    const lightSet = new Set(lightVars);
    const darkSet = new Set(darkVars);

    const onlyInLight = lightVars.filter((v) => !darkSet.has(v));
    const onlyInDark = darkVars.filter((v) => !lightSet.has(v));

    expect(onlyInLight).toEqual([]);
    expect(onlyInDark).toEqual([]);
  });

  it('contains all expected light-mode token values', () => {
    const lightBlockMatch = TOKENS_CSS.match(/:root\s*\{([^}]+)\}/);
    const block = lightBlockMatch![1];
    expect(block).toContain('#fff');
    expect(block).toContain('#f7f7f9');
    expect(block).toContain('#1a1a1a');
    expect(block).toContain('#6b7280');
    expect(block).toContain('#e5e7eb');
    expect(block).toContain('#2563eb');
    expect(block).toContain('#16a34a');
    expect(block).toContain('#ca8a04');
    expect(block).toContain('#dc2626');
  });

  it('contains all expected dark-mode token values', () => {
    const darkMediaMatch = TOKENS_CSS.match(
      /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{[^{]*:root\s*\{([^}]+)\}/,
    );
    const block = darkMediaMatch![1];
    expect(block).toContain('#0d1117');
    expect(block).toContain('#161b22');
    expect(block).toContain('#c9d1d9');
    expect(block).toContain('#8b949e');
    expect(block).toContain('#30363d');
    expect(block).toContain('#58a6ff');
    expect(block).toContain('#3fb950');
    expect(block).toContain('#d29922');
    expect(block).toContain('#f85149');
  });
});

function extractVarNames(block: string): string[] {
  const matches = block.match(/--[\w-]+/g);
  return matches ?? [];
}
