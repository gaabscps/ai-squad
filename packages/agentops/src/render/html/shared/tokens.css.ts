/**
 * CSS custom properties (design tokens) for the AgentOps HTML dashboard.
 * GitHub Primer-inspired palette with AA contrast for both light and dark modes.
 * Dark mode via @media (prefers-color-scheme: dark) — no manual switcher in MVP.
 */
export const TOKENS_CSS = `
:root {
  --bg: #fff;
  --bg-muted: #f7f7f9;
  --fg: #1a1a1a;
  --fg-muted: #6b7280;
  --border: #e5e7eb;
  --accent: #2563eb;
  --status-pass: #16a34a;
  --status-warn: #ca8a04;
  --status-fail: #dc2626;
  /* Semantic aliases for story-card fact-sheet (FEAT-005 T-012) */
  --color-surface: var(--bg-muted);
  --color-border: var(--border);
  --color-text-primary: var(--fg);
  --color-text-secondary: var(--fg-muted);
  --color-text-tertiary: #9ca3af;
  --color-warn: var(--status-warn);
  --color-warn-bg: rgba(255, 200, 0, 0.08);
  /* Spacing scale */
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  /* Radius scale */
  --radius-sm: 4px;
  --radius-md: 6px;
  /* Typography scale */
  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 1rem;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --bg-muted: #161b22;
    --fg: #c9d1d9;
    --fg-muted: #8b949e;
    --border: #30363d;
    --accent: #58a6ff;
    --status-pass: #3fb950;
    --status-warn: #d29922;
    --status-fail: #f85149;
    /* Semantic aliases (same var() refs, resolve to dark-mode primitives above) */
    --color-surface: var(--bg-muted);
    --color-border: var(--border);
    --color-text-primary: var(--fg);
    --color-text-secondary: var(--fg-muted);
    --color-text-tertiary: #6b7280;
    --color-warn: var(--status-warn);
    --color-warn-bg: rgba(255, 200, 0, 0.14);
    /* Scale tokens — same in both modes */
    --space-2: 0.5rem;
    --space-3: 0.75rem;
    --space-4: 1rem;
    --radius-sm: 4px;
    --radius-md: 6px;
    --text-xs: 11px;
    --text-sm: 13px;
    --text-base: 1rem;
  }
}
`;
