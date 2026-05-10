/**
 * flow-report/header.ts — H1, status block, and Insights section.
 * Extracted from flow-report.ts (T-013 refactor).
 */

import type { Compliance, Insight, Metrics } from '../../types';

function complianceBanner(compliance: Compliance): string | null {
  if (compliance === 'pre-standard') {
    return '> ⚠ **Pré-padrão** — flow rodou antes do contrato de observabilidade ser estabilizado (sem `usage` por dispatch / `pm_note` / `summary_for_reviewers` consistentes). Excluído de trends e health metrics.';
  }
  if (compliance === 'pm-bypass') {
    return '> ⚠ **PM-bypass** — PM autônomo skipou parte do pipeline canônico do ai-squad (decisão documentada em `handoff.md`); dispatches registrados no manifest sem persistência em `outputs/`. Excluído de trends e health metrics.';
  }
  return null;
}

export function renderHeader(
  metrics: Metrics,
  insights: Insight[],
  generatedAt: string,
  featureName: string,
  currentPhase: string,
): string {
  const sections: string[] = [];

  // H1
  sections.push(`# ${featureName} — ${metrics.taskId}`);

  // Compliance banner (apenas quando não-standard)
  const banner = complianceBanner(metrics.compliance);
  if (banner !== null) {
    sections.push(banner);
  }

  // Status block
  sections.push(
    [
      `> Feature: ${featureName}`,
      `> Task ID: ${metrics.taskId}`,
      `> Phase: ${currentPhase}`,
      `> Generated at: ${generatedAt}`,
    ].join('\n'),
  );

  // Insights
  if (insights.length === 0) {
    sections.push('## Insights\n\nNo insights triggered.');
  } else {
    const bullets = insights
      .map((i) => {
        const prefix = i.severity === 'warn' ? '⚠' : i.severity === 'error' ? '✖' : 'ℹ';
        const src = i.source ? ` _(${i.source})_` : '';
        return `- ${prefix} ${i.message}${src}`;
      })
      .join('\n');
    sections.push(`## Insights\n\n${bullets}`);
  }

  return sections.join('\n\n');
}
