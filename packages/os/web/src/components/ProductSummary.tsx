import { useProductSummary } from "../state/useProductSummary";
import type { ProductClient } from "../state/productClient";
import { productClient } from "../state/productClient";

// Render do resumo de PRODUTO (caminho work_type: product). Reaproveita as classes
// narr-* do SessionNarrative para herdar estilo. Mostra a "receita": o que ficou
// decidido / em aberto / próximo passo / entregável — sem nada de engenharia.

export function ProductSummary({
  projectId, specId, client = productClient,
}: { projectId: string; specId: string; client?: ProductClient }) {
  const n = useProductSummary(projectId, specId, client);

  if (n.state === "empty" || (n.state === "loading" && !n.summary)) {
    return (
      <div className="narr-empty">
        <button type="button" className="narr-generate" disabled={n.state === "loading"} onClick={() => n.generate()}>
          {n.state === "loading" ? "gerando resumo…" : "gerar resumo da sessão"}
        </button>
      </div>
    );
  }
  if (n.state === "error") {
    return <p className="narr-error">{n.error} · <button type="button" className="narr-retry" onClick={() => n.regenerate()}>tentar de novo</button></p>;
  }
  const data = n.summary;
  if (!data) return null;

  return (
    <div className="narr" data-testid="product-summary">
      <div className="narr-meta">
        {n.source === "sealed" && <span className="narr-sealed">selado</span>}
        {n.state === "stale" && <span className="narr-stale">desatualizado</span>}
        {n.costUsd !== null && <span className="narr-cost">${n.costUsd.toFixed(2)}</span>}
        <button type="button" className="narr-regen" onClick={() => n.regenerate()}>regerar</button>
      </div>

      {data.tldr && <p className="narr-tldr">{data.tldr}</p>}

      {data.decided.length > 0 && (
        <>
          <h5 className="narr-section">O que ficou decidido</h5>
          <ul className="narr-decisions">
            {data.decided.map((d, i) => (
              <li key={i}>
                <strong>{d.what}</strong>
                {d.why && <span className="narr-d-why"> — {d.why}</span>}
                {d.rejected && <span className="narr-d-trade"> · descartado: {d.rejected}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {data.open.length > 0 && (
        <>
          <h5 className="narr-section">Em aberto</h5>
          <ul className="narr-decisions">
            {data.open.map((q, i) => <li key={i}>{q}</li>)}
          </ul>
        </>
      )}

      {data.next.length > 0 && (
        <>
          <h5 className="narr-section">Próximo passo</h5>
          <ul className="narr-decisions">
            {data.next.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </>
      )}

      {data.deliverable && (
        <>
          <h5 className="narr-section">Entregável</h5>
          <p className="narr-why">{data.deliverable}</p>
        </>
      )}

      <p className="narr-inferred">Inferido da conversa — confira antes de usar.</p>
    </div>
  );
}
