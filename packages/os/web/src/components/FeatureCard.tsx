import { useState } from "react";
import type { FeatureWithProject } from "../lib/kanbanFeatures";
import type { SpecWithProject } from "../lib/kanban";
import { StatusBadge } from "./StatusBadge";
import { fmtUsd, fmtTokens } from "../format";

// Mensagem de correção manual enviada ao servidor via WS (Task 6: feature:*).
export interface FeatureActionMsg {
  type: "feature:assign" | "feature:markDone" | "feature:setDelivery" | "feature:rename";
  projectId: string;
  sessionId?: string;
  featureId?: string | null;
  done?: boolean;
  state?: "open" | "awaiting_deploy" | "done";
  name?: string;
}

// Linha de sessão expandida com o controle "mover para outra feature".
function SessionRow({
  s,
  projectId,
  knownFeatures,
  currentFeatureId,
  onSelectSession,
  onFeatureAction,
}: {
  s: SpecWithProject;
  projectId: string;
  knownFeatures: { id: string; name: string }[];
  currentFeatureId: string;
  onSelectSession: (s: SpecWithProject) => void;
  onFeatureAction?: (msg: FeatureActionMsg) => void;
}) {
  const [moving, setMoving] = useState(false);
  const targets = knownFeatures.filter((kf) => kf.id !== currentFeatureId);

  return (
    <li>
      <button type="button" className="fcard-session" onClick={() => onSelectSession(s)}>
        <span className="fcard-session-id">{s.spec.id}</span>
        <span className="fcard-session-title">{s.spec.title}</span>
        <StatusBadge spec={s.spec} />
      </button>
      {onFeatureAction && (
        moving ? (
          <select
            aria-label={`nova feature de ${s.spec.id}`}
            defaultValue=""
            onChange={(e) => {
              const value = e.target.value;
              const featureId = value === "__none__" ? null : value;
              onFeatureAction({ type: "feature:assign", projectId, sessionId: s.spec.id, featureId });
              setMoving(false);
            }}
          >
            <option value="" disabled>escolher…</option>
            {targets.map((kf) => (
              <option key={kf.id} value={kf.id}>{kf.name}</option>
            ))}
            <option value="__none__">Sem feature</option>
          </select>
        ) : (
          <button type="button" aria-label={`mover ${s.spec.id}`} onClick={() => setMoving(true)}>
            mover
          </button>
        )
      )}
    </li>
  );
}

/**
 * Card de feature no kanban: header (nome, key, tags), métricas agregadas
 * (sessões fechadas/total, custo somado, atenção) e lista expansível das
 * sessões-membro — clicar numa sessão abre o drawer existente.
 */
export function FeatureCard({
  item,
  onSelectSession,
  onFeatureAction,
  knownFeatures = [],
}: {
  item: FeatureWithProject;
  onSelectSession: (s: SpecWithProject) => void;
  onFeatureAction?: (msg: FeatureActionMsg) => void;
  knownFeatures?: { id: string; name: string }[];
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
        {f.status === "awaiting_deploy" && <span className="fcard-tag">aguardando deploy</span>}
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
        {onFeatureAction && f.status !== "awaiting_deploy" && f.status !== "done" && (
          <button type="button" className="fcard-action"
            onClick={() => onFeatureAction({ type: "feature:setDelivery", projectId: item.projectId, featureId: f.id, state: "awaiting_deploy" })}>
            marcar aguardando deploy
          </button>
        )}
        {onFeatureAction && f.status !== "done" && (
          <button type="button" className="fcard-action"
            onClick={() => onFeatureAction({ type: "feature:setDelivery", projectId: item.projectId, featureId: f.id, state: "done" })}>
            marcar como entregue
          </button>
        )}
        {onFeatureAction && (f.status === "awaiting_deploy" || f.status === "done") && (
          <button type="button" className="fcard-action"
            onClick={() => onFeatureAction({ type: "feature:setDelivery", projectId: item.projectId, featureId: f.id, state: "open" })}>
            reabrir
          </button>
        )}
      </div>
      {open && (
        <ul className="fcard-sessions">
          {item.sessions.map((s) => (
            <SessionRow
              key={s.spec.id}
              s={s}
              projectId={item.projectId}
              knownFeatures={knownFeatures}
              currentFeatureId={f.id}
              onSelectSession={onSelectSession}
              onFeatureAction={onFeatureAction}
            />
          ))}
        </ul>
      )}
    </article>
  );
}
