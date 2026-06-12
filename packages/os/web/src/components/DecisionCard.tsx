import type { ObservedDecision } from "../../../src/store/types";

/**
 * Card de forquilha de uma decisão observada: o caminho escolhido em destaque,
 * o rejeitado esmaecido ao lado, o porquê como legenda da bifurcação e o ref
 * clicável quando aponta para um .md (abre no MarkdownViewer via onOpenRef).
 */
export function DecisionCard({
  decision,
  onOpenRef,
}: {
  decision: ObservedDecision;
  onOpenRef?: (ref: string) => void;
}) {
  const { what, why, rejected, ref } = decision;
  const refOpens = ref !== null && ref.endsWith(".md") && onOpenRef !== undefined;
  return (
    <li className="decision-fork">
      <div className="decision-chosen">
        <span className="decision-mark" aria-hidden="true">✓</span>
        <p className="decision-what">{what}</p>
      </div>
      {rejected && (
        <div className="decision-rejected">
          <span className="decision-mark" aria-hidden="true">✕</span>
          <p className="decision-rejected-text">{rejected}</p>
        </div>
      )}
      {why && <p className="decision-why">{why}</p>}
      {ref && (
        refOpens ? (
          <button type="button" className="decision-ref mono" onClick={() => onOpenRef!(ref)}>
            {ref} →
          </button>
        ) : (
          <code className="decision-ref mono">{ref}</code>
        )
      )}
    </li>
  );
}
