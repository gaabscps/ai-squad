/**
 * render/html/flow-report.ts — Per-flow HTML page orchestrator.
 * Assembles a complete self-contained HTML page for a single AgentOps flow.
 * AC-001, AC-002, AC-003, AC-006, AC-009, AC-010, AC-012, AC-021, AC-022
 *
 * Structure: shell( kpiHeader + story timeline + drilldown + markdownEmbed )
 */

import type { Compliance, CostMetric, RepoHealth, Session } from '../../types';

import { costSection } from './components/cost-section';
import { drilldown } from './components/drilldown';
import { kpiHeader } from './components/kpi-header';
import { markdownEmbed } from './components/markdown-embed';
import { aggregateBatchesFromSession, storyCard } from './components/story-card';
import { shell } from './shared/shell';

function complianceNotice(compliance: Compliance): string {
  if (compliance === 'pre-standard') {
    return `<div class="compliance-notice compliance-pre-standard" role="note">
      <strong>Pré-padrão:</strong> flow rodou antes do contrato de observabilidade ser estabilizado
      (sem <code>usage</code> por dispatch / <code>pm_note</code> / <code>summary_for_reviewers</code>
      consistentes). Mantido visível como audit trail; excluído de trends e health metrics.
    </div>`;
  }
  if (compliance === 'pm-bypass') {
    return `<div class="compliance-notice compliance-pm-bypass" role="note">
      <strong>PM-bypass:</strong> PM autônomo skipou parte do pipeline canônico do ai-squad
      (decisão documentada em <code>handoff.md</code>); dispatches registrados no manifest sem
      persistência em <code>outputs/</code>. Excluído de trends e health metrics.
    </div>`;
  }
  return '';
}

/**
 * Renders a complete HTML page for a single flow.
 *
 * @param session - Enriched session data (from enrich.ts)
 * @param repoHealth - Repo health snapshot, or null if not measured
 * @param cost - Cost metric, or null if not computed
 * @param mdContent - Raw Markdown content from the same agentops:report run (AC-012)
 * @returns Self-contained HTML string
 */
export function renderFlowHtml(
  session: Session,
  repoHealth: RepoHealth | null,
  cost: CostMetric | null,
  mdContent: string,
): string {
  const batches = aggregateBatchesFromSession(session);
  const storyCards = batches.map(storyCard).join('\n');

  const body = `
    ${kpiHeader(session, repoHealth, cost)}
    ${complianceNotice(session.compliance)}
    <main>
      <section class="story">
        <h2>Story</h2>
        ${storyCards}
      </section>
      ${costSection(session, cost)}
      ${drilldown(session, repoHealth)}
      ${markdownEmbed(mdContent)}
    </main>
  `;

  return shell({
    title: `${session.featureName} — AgentOps`,
    body,
  });
}
