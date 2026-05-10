/**
 * Reset CSS: box-sizing and body margin.
 */
export const RESET_CSS = `
*, *::before, *::after {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  color: var(--fg);
  background: var(--bg);
  line-height: 1.5;
}
h1, h2, h3, h4 {
  margin: 0 0 0.5rem;
  font-weight: 600;
}
h1 { font-size: 1.5rem; }
h2 { font-size: 1.25rem; }
h3 { font-size: 1.1rem; }
a {
  color: var(--accent);
  text-decoration: none;
}
a:hover {
  text-decoration: underline;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
th, td {
  text-align: left;
  padding: 6px 10px;
  border: 1px solid var(--border);
}
th {
  background: var(--bg-muted);
  font-weight: 600;
}
code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  background: var(--bg-muted);
  padding: 1px 4px;
  border-radius: 3px;
}`;
