/**
 * Markdown embed CSS: .md-embed, .repo-health-current, .repo-health-badges.
 */
export const MD_EMBED_CSS = `
.md-embed {
  font-size: 14px;
  line-height: 1.6;
  overflow-x: auto;
}
.md-embed h1, .md-embed h2, .md-embed h3 {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25rem;
  margin: 1rem 0 0.5rem;
}
.md-embed table {
  margin: 0.5rem 0;
}
.md-embed pre {
  background: var(--bg-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.75rem;
  overflow-x: auto;
}
.md-embed code {
  background: none;
  padding: 0;
}
.repo-health-current {
  margin-bottom: 2rem;
}
.repo-health-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}`;
