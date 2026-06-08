import { useState } from "react";
import type { Task, Dispatch, DispatchFinding } from "../../../src/store/types";
import { taskTotalTokens } from "../lib/taskTokens";
import { fmtTokens, fmtUsd } from "../format";
import { STATE_LABEL } from "../lib/taskState";
import { useTaskSummary } from "../state/useTaskSummary";
import { useTypewriter } from "../state/useTypewriter";
import { MarkdownText } from "../lib/markdown";
import { ModelSelector } from "./ModelSelector";
import { modelLabel } from "../lib/modelLabel";
import type { ModelAlias } from "../state/summaryClient";

const SEVERITY_CLASS: Record<string, string> = { error: "finding-error", warning: "finding-warning", info: "finding-info" };

function FindingRow({ finding }: { finding: DispatchFinding }) {
  const loc = finding.file ? `${finding.file}${finding.line != null ? `:${finding.line}` : ""}` : null;
  return (
    <li className={`finding-item ${SEVERITY_CLASS[finding.severity] ?? ""}`}>
      <span className="finding-severity">{finding.severity}</span>
      {loc && <span className="finding-loc mono">{loc}</span>}
      <span className="finding-text">{finding.text}</span>
    </li>
  );
}

/** Bloco de resumo de ensino, gerado por IA sob demanda (nunca automático). */
function SummaryBlock({ projectId, specId, task }: { projectId: string; specId: string; task: Task }) {
  const [model, setModel] = useState<ModelAlias>("sonnet");
  const s = useTaskSummary(projectId, specId, task.id);
  const hasDispatches = task.dispatches.length > 0;
  // Anima a revelação só quando o texto veio do stream (cache → instantâneo).
  const animate = s.streamed && (s.state === "streaming" || s.state === "ready");
  const display = useTypewriter(s.text, animate);
  const typing = s.state === "streaming" || (animate && display.length < s.text.length);
  const label = modelLabel(s.modelId);
  return (
    <section className="task-summary" data-state={s.state}>
      <header className="task-summary-head">
        <span className="task-summary-label">✨ Resumo</span>
        {s.state === "ready" && s.generatedAt && (
          <span className="task-summary-meta">
            gerado {new Date(s.generatedAt).toLocaleTimeString()}
            {label && <> · {label}</>}
          </span>
        )}
        {(s.state === "ready" || s.state === "stale") && (
          <button type="button" className="task-summary-btn" onClick={() => s.regenerate(model)}>↻ regerar</button>
        )}
        {(s.state === "empty" || s.state === "error") && (
          <>
            <ModelSelector storageKey="aios-model-task" defaultValue="sonnet" onChange={setModel} />
            <button type="button" className="task-summary-btn primary" onClick={() => s.generate(model)} disabled={!hasDispatches}>
              gerar resumo
            </button>
          </>
        )}
      </header>
      {s.state === "empty" && (
        <p className="task-summary-hint">{hasDispatches ? "clique para gerar uma explicação do que foi feito nesta task" : "sem dados para resumir"}</p>
      )}
      {s.state === "loading" && <p className="task-summary-hint">gerando…</p>}
      {s.state === "stale" && <p className="task-summary-warn">desatualizado — regerar para refletir o progresso recente</p>}
      {s.state === "error" && <p className="task-summary-warn">{s.error}</p>}
      {(s.state === "streaming" || s.state === "ready" || s.state === "stale") && s.text && (
        <div className="task-summary-text">
          <MarkdownText source={display} />
          {typing && <span className="task-summary-cursor" aria-hidden="true">▋</span>}
        </div>
      )}
      {s.costUsd != null && !typing && (s.state === "ready" || s.state === "stale") && (
        <p className="task-summary-cost" title="custo real reportado pelo Claude CLI (inclui o overhead de contexto dos hooks locais)">
          custo desta geração · {fmtUsd(s.costUsd)}
        </p>
      )}
    </section>
  );
}

/** Detalhes de dispatches agrupados em `<details>`, recolhidos por padrão. */
function TechDetails({ dispatches }: { dispatches: Dispatch[] }) {
  if (dispatches.length === 0) {
    return <p className="task-empty-dispatches">sem dispatches registrados</p>;
  }
  const summaries = dispatches.filter((d) => d.summary != null).map((d) => ({ role: d.role, loop: d.loop, summary: d.summary as string }));
  const uniqueFiles = Array.from(new Set(dispatches.flatMap((d) => d.filesChanged)));
  const allFindings = dispatches.flatMap((d) => d.findings);
  const allTestEvidence = dispatches.flatMap((d) => d.testEvidence);
  const loopMap = new Map<number, Dispatch[]>();
  for (const d of dispatches) loopMap.set(d.loop, [...(loopMap.get(d.loop) ?? []), d]);
  const sortedLoops = Array.from(loopMap.entries()).sort(([a], [b]) => a - b);

  return (
    <details className="task-details">
      <summary className="task-details-summary">Detalhes técnicos</summary>
      <div className="task-details-body">
        {summaries.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">O que foi feito ({summaries.length})</h5>
            <ul className="task-summaries">
              {summaries.map((s, i) => (
                <li key={i} className="task-summary-item">
                  <span className="mono task-dispatch-tag">{s.role} · loop {s.loop}</span>
                  <span>{s.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {uniqueFiles.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">Arquivos mudados ({uniqueFiles.length})</h5>
            <ul className="task-files mono">{uniqueFiles.map((f) => <li key={f}>{f}</li>)}</ul>
          </section>
        )}
        {allFindings.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">Findings de review ({allFindings.length})</h5>
            <ul className="task-findings">{allFindings.map((f, i) => <FindingRow key={i} finding={f} />)}</ul>
          </section>
        )}
        {allTestEvidence.length > 0 && (
          <section className="task-block">
            <h5 className="task-block-label">Testes ({allTestEvidence.length})</h5>
            <ul className="task-tests mono">
              {allTestEvidence.map((te, i) => (
                <li key={i} className={`test-item ${te.passed ? "test-pass" : te.passed === false ? "test-fail" : "test-unknown"}`}>
                  <span className="test-status">{te.passed ? "✓" : te.passed === false ? "✗" : "?"}</span>
                  <span className="test-command mono">{te.command}</span>
                  {te.detail && <span className="test-detail">{te.detail}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className="task-block">
          <h5 className="task-block-label">Histórico de loops</h5>
          <div className="task-loops-history">
            {sortedLoops.map(([loop, ds]) => (
              <div key={loop} className="task-loop-group">
                <span className="task-loop-num mono">loop {loop}</span>
                <ul className="task-loop-dispatches">
                  {ds.map((d, i) => (
                    <li key={i} className={`task-loop-dispatch task-loop-${d.role}`}>
                      <span className="mono">{d.role}</span>
                      <span className={`loop-status loop-status-${d.status}`}>{d.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </details>
  );
}

export function TaskItem({ task, projectId, specId }: { task: Task; projectId: string; specId: string }) {
  const [expanded, setExpanded] = useState(false);
  const totalTokens = taskTotalTokens(task);
  return (
    <li className="task-item" data-state={task.state} data-expanded={expanded ? "true" : "false"}>
      <button type="button" className="task-item-header" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <span className="mono task-item-id">{task.id}</span>
        <span className="task-item-state">{STATE_LABEL[task.state] ?? task.state}</span>
        {task.loops > 1 && <span className="task-item-loops">↻ {task.loops} loops</span>}
        <span className="task-item-tokens">{totalTokens != null ? `${fmtTokens(totalTokens)} tok` : "—"}</span>
        <span className="task-item-chevron" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="task-expanded">
          <SummaryBlock projectId={projectId} specId={specId} task={task} />
          <TechDetails dispatches={task.dispatches} />
        </div>
      )}
    </li>
  );
}
