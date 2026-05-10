/**
 * Escapes HTML special characters to prevent XSS.
 * Order matters: & must be replaced first to avoid double-escaping.
 */
export function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
