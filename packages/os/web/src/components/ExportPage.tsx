// web/src/components/ExportPage.tsx
import { useMemo } from "react";
import { useProjects } from "../state/projects";
import { flattenSpecs } from "../lib/kanban";
import type { SpecWithProject } from "../lib/kanbanObserved";
import { useProductSummary } from "../state/useProductSummary";
import { useObservedNarrative } from "../state/useObservedNarrative";
import { productClient, type ProductClient } from "../state/productClient";
import { narrativeClient, type NarrativeClient } from "../state/narrativeClient";
import { ProductSummary } from "./ProductSummary";
import { SessionNarrative } from "./SessionNarrative";
import { ObservedTimeline } from "./ObservedTimeline";
import { CopyJiraPanel } from "./CopyJiraPanel";
import { productSummaryToJira, narrativeToJira, type JiraMeta } from "../lib/jiraMarkdown";
import { fmtUsd, fmtTokens, fmtDate, fmtDurationBetween } from "../format";

// Página de export em tela cheia de uma sessão observada (produto ou dev).
// Reusa os blocos do drawer sem o overlay e anexa o painel "copiar pro Jira".
export function ExportPage({
  projectId,
  specId,
  productClientArg = productClient,
  narrativeClientArg = narrativeClient,
}: {
  projectId: string;
  specId: string;
  productClientArg?: ProductClient;
  narrativeClientArg?: NarrativeClient;
}) {
  const { projects } = useProjects();
  const item: SpecWithProject | null = useMemo(
    () => flattenSpecs(projects, true).find((sp) => sp.projectId === projectId && sp.spec.id === specId) ?? null,
    [projects, projectId, specId],
  );

  // Hooks chamados sempre (regras dos hooks); o modo inativo fica vazio sem custo.
  const prod = useProductSummary(projectId, specId, productClientArg);
  const narr = useObservedNarrative(projectId, specId, narrativeClientArg);

  if (!item) return <div className="export-loading" data-testid="export-loading">carregando…</div>;

  const { spec, projectName } = item;
  const obs = spec.observed;
  if (!obs) return <div className="export-error" data-testid="export-error">sessão não observada</div>;

  const isProduct = obs.workType === "product";
  const labels = [
    `work-type:${isProduct ? "product" : "dev"}`,
    ...(obs.outputLocale ? [`lang:${obs.outputLocale}`] : []),
    ...(obs.attentionKind ? [`attention:${obs.attentionKind}`] : []),
  ];
  const meta: JiraMeta = { title: spec.title, specId: spec.id, labels };

  const jiraBody = isProduct
    ? prod.summary ? productSummaryToJira(prod.summary, meta) : null
    : narr.narrative ? narrativeToJira(narr.narrative, meta) : null;
  const summaryLine = isProduct ? prod.summary?.tldr ?? null : narr.narrative?.tldr ?? null;
  const duration = fmtDurationBetween(obs.createdAt, obs.closedAt);

  return (
    <div className="export-page" data-testid="export-page">
      <header className="export-head">
        <span className="export-id">{spec.id}</span>
        <h1 className="export-title">{spec.title}</h1>
        <span className="export-proj">{projectName} · {isProduct ? "PRODUTO" : "OBSERVADO"}</span>
        <button type="button" className="export-print" onClick={() => window.print()}>
          imprimir / salvar PDF
        </button>
      </header>

      <dl className="export-facts">
        <div>
          <dt>custo</dt>
          <dd>{spec.cost.totalCostUsd !== null ? fmtUsd(spec.cost.totalCostUsd) : `${fmtTokens(spec.cost.totalTokens)} tokens`}</dd>
        </div>
        <div><dt>aberto</dt><dd>{fmtDate(obs.createdAt)}</dd></div>
        {obs.closedAt && <div><dt>fechado</dt><dd>{fmtDate(obs.closedAt)}</dd></div>}
        {duration && <div><dt>duração</dt><dd>{duration}</dd></div>}
      </dl>

      <h4 className="drawer-section">Linha do tempo</h4>
      <ObservedTimeline markers={obs.markers} outputLocale={obs.outputLocale} workType={obs.workType} />

      {isProduct ? (
        <>
          <h4 className="drawer-section">Resumo da sessão</h4>
          <ProductSummary projectId={projectId} specId={specId} client={productClientArg} />
        </>
      ) : (
        <>
          <h4 className="drawer-section">Apresentação da sessão</h4>
          <SessionNarrative projectId={projectId} specId={specId} observed={obs} client={narrativeClientArg} />
        </>
      )}

      {jiraBody && summaryLine !== null && <CopyJiraPanel summaryLine={summaryLine} body={jiraBody} />}
    </div>
  );
}
