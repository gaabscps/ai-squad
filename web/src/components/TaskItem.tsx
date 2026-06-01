import { useState } from "react";
import type { Task, Dispatch, DispatchFinding } from "../../../src/store/types";
import { taskTotalTokens } from "../lib/taskTokens";
import { fmtTokens } from "../format";
import { STATE_LABEL } from "../lib/taskState";

const SEVERITY_CLASS: Record<string, string> = {
  error: "finding-error",
  warning: "finding-warning",
  info: "finding-info",
};

function FindingRow({ finding }: { finding: DispatchFinding }) {
  const loc =
    finding.file
      ? `${finding.file}${finding.line != null ? `:${finding.line}` : ""}`
      : null;

  return (
    <li className={`finding-item ${SEVERITY_CLASS[finding.severity] ?? ""}`}>
      <span className="finding-severity">{finding.severity}</span>
      {loc && <span className="finding-loc mono">{loc}</span>}
      <span className="finding-text">{finding.text}</span>
    </li>
  );
}

function ExpandedContent({ dispatches }: { dispatches: Dispatch[] }) {
  if (dispatches.length === 0) {
    return <p className="task-empty-dispatches">sem dispatches registrados</p>;
  }

  const summaries = dispatches
    .filter((d) => d.summary != null)
    .map((d) => ({ role: d.role, loop: d.loop, summary: d.summary as string }));

  const allFiles = dispatches.flatMap((d) => d.filesChanged);
  const uniqueFiles = Array.from(new Set(allFiles));

  const allFindings = dispatches.flatMap((d) => d.findings);

  const allTestEvidence = dispatches.flatMap((d) => d.testEvidence);

  const loopMap = new Map<number, Dispatch[]>();
  for (const d of dispatches) {
    const existing = loopMap.get(d.loop) ?? [];
    loopMap.set(d.loop, [...existing, d]);
  }
  const sortedLoops = Array.from(loopMap.entries()).sort(([a], [b]) => a - b);

  return (
    <div className="task-expanded">
      {summaries.length > 0 && (
        <section className="task-block">
          <h5 className="task-block-label">O que foi feito</h5>
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
          <h5 className="task-block-label">Arquivos mudados</h5>
          <ul className="task-files mono">
            {uniqueFiles.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </section>
      )}

      {allFindings.length > 0 && (
        <section className="task-block">
          <h5 className="task-block-label">Findings de review</h5>
          <ul className="task-findings">
            {allFindings.map((f, i) => (
              <FindingRow key={i} finding={f} />
            ))}
          </ul>
        </section>
      )}

      {allTestEvidence.length > 0 && (
        <section className="task-block">
          <h5 className="task-block-label">Testes</h5>
          <ul className="task-tests mono">
            {allTestEvidence.map((te, i) => (
              <li key={i} className={`test-item ${te.passed ? "test-pass" : te.passed === false ? "test-fail" : "test-unknown"}`}>
                <span className="test-status">{te.passed ? "✓" : te.passed === false ? "✗" : "?"}</span>
                <span className="test-command">{te.command}</span>
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
  );
}

export function TaskItem({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false);
  const totalTokens = taskTotalTokens(task);

  return (
    <li className="task-item" data-state={task.state} data-expanded={expanded ? "true" : "false"}>
      <button
        type="button"
        className="task-item-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="mono task-item-id">{task.id}</span>
        <span className="task-item-state">{STATE_LABEL[task.state] ?? task.state}</span>
        {task.loops > 1 && (
          <span className="task-item-loops">↻ {task.loops} loops</span>
        )}
        {totalTokens != null && (
          <span className="task-item-tokens">{fmtTokens(totalTokens)} tok</span>
        )}
        <span className="task-item-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
      </button>

      {expanded && <ExpandedContent dispatches={task.dispatches} />}
    </li>
  );
}
