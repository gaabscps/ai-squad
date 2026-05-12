/**
 * flow-report/utils.ts — Shared formatting helpers.
 * Single source of truth for fmtUsd and mdTable used across flow-report modules.
 */

/** Formats a USD amount with leading $. Defaults to 4 decimal places. */
export function fmtUsd(value: number, digits = 4): string {
  return `$${value.toFixed(digits)}`;
}

/** Builds a Markdown table from headers and rows. */
export function mdTable(headers: string[], rows: string[][]): string {
  const sep = headers.map(() => '---');
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
  return lines.join('\n');
}
