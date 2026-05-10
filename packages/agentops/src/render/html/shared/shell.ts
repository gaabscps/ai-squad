/**
 * shared/shell.ts — HTML boilerplate composer.
 * Wraps body content in a complete HTML5 document with inlined CSS tokens + styles.
 * Self-contained: no external CSS files, no CDN dependencies (AC-017, AC-018).
 */

import { escape } from './escape';
import { STYLES_CSS } from './styles.css';
import { TOKENS_CSS } from './tokens.css';

interface ShellOptions {
  title: string;
  body: string;
  lang?: string;
}

/**
 * Generates a complete HTML5 document with inlined CSS.
 *
 * @param options.title - Page title (HTML-escaped)
 * @param options.body - Raw HTML body content (not escaped — caller is responsible)
 * @param options.lang - HTML lang attribute (defaults to 'pt-BR')
 */
export function shell({ title, body, lang = 'pt-BR' }: ShellOptions): string {
  return `<!DOCTYPE html>
<html lang="${escape(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escape(title)}</title>
  <style>${TOKENS_CSS}${STYLES_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}
