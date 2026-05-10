/**
 * components/markdown-embed.ts — Raw Markdown content embedded as last section.
 * Converts Markdown to HTML using marked@^14 (D4).
 * Content is rendered inside a collapsed <details> panel.
 * marked@^14: no headerIds/mangle options (deprecated in v8+).
 * D8 security: raw HTML in MD is escaped via custom renderer.html hook.
 */

import { Marked, Renderer } from 'marked';

/** Scoped marked instance with HTML sanitization (D8 security) */
const markedInstance = new Marked({
  breaks: false,
  gfm: true,
});

// Override html rendering to escape raw HTML blocks (prevents XSS from embedded HTML)
const renderer = new Renderer();
renderer.html = (token: { text: string }) => token.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
markedInstance.use({ renderer });

/**
 * Renders a raw Markdown string as an embedded HTML section.
 * The section is collapsed by default via <details>/<summary>.
 *
 * @param mdContent - Raw Markdown content (from the same agentops:report execution)
 * @returns HTML string for the raw-data section
 */
export function markdownEmbed(mdContent: string): string {
  const renderedHtml = markedInstance.parse(mdContent) as string;

  return `<section class="raw-data">
  <h2>Raw data</h2>
  <details>
    <summary>View raw Markdown report</summary>
    <div class="md-embed">${renderedHtml}</div>
  </details>
</section>`;
}
