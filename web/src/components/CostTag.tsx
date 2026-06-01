import type { CostRollup } from "../../../src/store/types";
import { fmtTokens, fmtUsd } from "../format";

/**
 * Exibe SÓ o que veio no CostRollup (invariante §5): nunca soma, multiplica nem
 * estima. totalCostUsd null → "—"; partial → marca "$ parcial"; reportPath → link
 * que abre o report.html servido pela rota /file. O número já vem somado do Store.
 */
export function CostTag({ cost }: { cost: CostRollup }) {
  return (
    <div className="cost-tag">
      <span className="cost-usd">{fmtUsd(cost.totalCostUsd)}</span>
      {cost.partial && (
        <span className="cost-partial" title="modelo sem preço — soma parcial">
          $ parcial
        </span>
      )}
      <span className="cost-tokens">{fmtTokens(cost.totalTokens)} tok</span>
      {cost.reportPath && (
        <a
          className="cost-report"
          href={`/file?path=${encodeURIComponent(cost.reportPath)}`}
          target="_blank"
          rel="noreferrer"
        >
          report
        </a>
      )}
    </div>
  );
}
