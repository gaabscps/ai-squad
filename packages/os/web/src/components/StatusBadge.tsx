import type { Spec } from "../../../src/store/types";
import { STATUS_LABEL } from "../lib/statusLabels";

/**
 * Status colorido (a cor vem da classe status-<status> no CSS) + flag de
 * audit_exception, que pode coexistir com qualquer status. blocked/paused já
 * são status próprios; audit é a flag extra do §6.
 */
export function StatusBadge({ spec }: { spec: Spec }) {
  return (
    <div className="status-badge">
      <span className={`status status-${spec.status}`}>{STATUS_LABEL[spec.status]}</span>
      {spec.health.auditException && (
        <span className="flag flag-audit" title="exceção de auditoria">
          ⚠ audit
        </span>
      )}
    </div>
  );
}
