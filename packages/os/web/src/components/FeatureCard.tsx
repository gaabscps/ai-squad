import { useState } from "react";
import type { FeatureWithProject } from "../lib/kanbanFeatures";
import type { SpecWithProject } from "../lib/kanban";
import { StatusBadge } from "./StatusBadge";
import { fmtUsd, fmtTokens } from "../format";

/**
 * Card de feature no kanban: header (nome, key, tags), métricas agregadas
 * (sessões fechadas/total, custo somado, atenção) e lista expansível das
 * sessões-membro — clicar numa sessão abre o drawer existente.
 */
export function FeatureCard({
  item,
  onSelectSession,
}: {
  item: FeatureWithProject;
  onSelectSession: (s: SpecWithProject) => void;
}) {
  const [open, setOpen] = useState(false);
  const f = item.feature;
  const cost =
    f.cost.totalCostUsd !== null ? fmtUsd(f.cost.totalCostUsd)
    : f.cost.totalTokens > 0 ? `${fmtTokens(f.cost.totalTokens)} tokens`
    : null;

  return (
    <article className={`fcard${f.status === "needs_attention" ? " fcard-attention" : ""}`}>
      <button type="button" className="fcard-head" onClick={() => setOpen((v) => !v)}
        aria-expanded={open}>
        <span className="fcard-name">{f.name}</span>
        {f.key && <span className="fcard-key">{f.key}</span>}
        {f.orphan && <span className="fcard-tag">sem feature</span>}
        {f.jira?.status && <span className="fcard-jira">{f.jira.status}</span>}
        {f.status === "done" && f.doneSource && (
          <span className="fcard-tag">entregue · {f.doneSource === "jira" ? "Jira" : "manual"}</span>
        )}
      </button>
      <div className="fcard-meta">
        <span>{f.delivery.sessionsClosed}/{f.delivery.sessionsTotal} sessões</span>
        {cost && <span>{cost}{f.cost.incomplete ? " (parcial)" : ""}</span>}
        {f.attention.count > 0 && (
          <span className="fcard-attention-count">{f.attention.count} aguardando você</span>
        )}
        {f.status === "idle" && <span className="fcard-hint">sessões fechadas — marcar entregue?</span>}
      </div>
      {open && (
        <ul className="fcard-sessions">
          {item.sessions.map((s) => (
            <li key={s.spec.id}>
              <button type="button" className="fcard-session" onClick={() => onSelectSession(s)}>
                <span className="fcard-session-id">{s.spec.id}</span>
                <span className="fcard-session-title">{s.spec.title}</span>
                <StatusBadge spec={s.spec} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
