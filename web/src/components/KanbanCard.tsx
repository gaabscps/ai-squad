import type { SpecWithProject } from "../lib/kanban";
import { columnForSpec, attentionReason } from "../lib/kanban";
import { fmtTokens, fmtUsd, fmtRelativeTime } from "../format";

/**
 * Card compacto do kanban. O conteúdo adapta-se à coluna: em "atenção" mostra o
 * MOTIVO (bloqueio/escalada/auditoria); em "andamento" mostra a fase atual. O
 * rodapé sempre traz custo + última atividade. A borda esquerda (cor por status)
 * e a tag de squad são CSS (data-status / data-squad). Só leitura; clicar abre o
 * drawer via onSelect.
 */
export function KanbanCard({
  item,
  onSelect,
}: {
  item: SpecWithProject;
  onSelect: (item: SpecWithProject) => void;
}) {
  const { spec, projectName } = item;
  const col = columnForSpec(spec);
  const reason = attentionReason(spec);
  return (
    <article
      className="kcard"
      data-status={spec.status}
      data-squad={spec.squad}
      onClick={() => onSelect(item)}
    >
      <div className="kcard-row1">
        <span className="kcard-id">{spec.id}</span>
        <span className="kcard-proj">{projectName}</span>
      </div>
      <h3 className="kcard-title">{spec.title}</h3>

      {col === "attention" && reason && (
        <div className={`kcard-why why-${reason.kind}`}>{reason.label}</div>
      )}

      {col === "running" && spec.phase && (
        <div className="kcard-phase">{spec.phase}</div>
      )}

      <div className="kcard-meta">
        <span className="kcard-cost">
          {fmtTokens(spec.cost.totalTokens)} tok · {fmtUsd(spec.cost.totalCostUsd)}
        </span>
        <time className="kcard-time">{fmtRelativeTime(spec.lastActivityAt)}</time>
      </div>
    </article>
  );
}
