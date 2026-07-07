import type { OverviewData, AttentionItem, FeatureRow, WindowKey } from "../lib/overview";
import { WINDOWS } from "../lib/overview";
import { fmtUsd, fmtRelativeTime } from "../format";

/** Callbacks de drill-down: cada número/linha clicável desce pro recorte que o compõe. */
export interface OverviewDrill {
  attentionSession: (item: AttentionItem) => void;
  feature: (row: FeatureRow) => void;
  toTable: () => void;
}

/** Sparkline de 1 série (custo por período na janela); endpoint enfatizado, sem legenda (série única). */
function Sparkline({ points }: { points: { at: string; costUsd: number }[] }) {
  if (points.length === 0) return <span className="ov-spark-empty">sem dados na janela</span>;
  const W = 200, Hh = 56, pad = 4;
  const max = Math.max(...points.map((p) => p.costUsd), 1);
  const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i) => [pad + i * step, Hh - pad - (p.costUsd / max) * (Hh - pad * 2)] as const);
  const d = xy.map(([x, y]) => `${x},${y}`).join(" ");
  const [ex, ey] = xy[xy.length - 1];
  return (
    <svg className="ov-spark" width={W} height={Hh} viewBox={`0 0 ${W} ${Hh}`} role="img"
      aria-label={`custo por período na janela, ${points.length} pontos`}>
      <polyline points={d} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      <circle cx={ex} cy={ey} r="3.5" fill="var(--accent)" />
    </svg>
  );
}

/** Card "Precisa de você": contagem + fila clicável (uma linha por sessão travada). */
function AttentionCard({ attention, onDrill }: { attention: OverviewData["attention"]; onDrill: OverviewDrill }) {
  return (
    <div className="ov-card">
      <h2><span className="ov-dot ov-dot-blocked" />PRECISA DE VOCÊ</h2>
      <div className="ov-kpi ov-kpi-blocked">{attention.count}</div>
      <div className="ov-kpi-sub">sessões travadas esperando resposta</div>
      <div className="ov-queue">
        {attention.items.map((item) => (
          <button
            key={item.sessionId}
            type="button"
            className="ov-qrow"
            onClick={() => onDrill.attentionSession(item)}
          >
            <span className="ov-qrow-id">{item.sessionId}</span>
            <span className="ov-qrow-what">{item.what}</span>
            <span className="ov-qrow-why">{item.whyLabel}</span>
            <span className="ov-qrow-age">{fmtRelativeTime(item.since)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Card "Entrega": placar features/sessões fechadas + lista de features tocadas na janela. */
function DeliveryCard({ delivery }: { delivery: OverviewData["delivery"] }) {
  return (
    <div className="ov-card">
      <h2><span className="ov-dot ov-dot-done" />ENTREGA</h2>
      <div className="ov-kpi">
        <span className="ov-drill">{delivery.featuresDelivered}</span> <small>feature{delivery.featuresDelivered === 1 ? "" : "s"}</small>{" "}
        <span className="ov-kpi-sep">·</span>{" "}
        <span className="ov-drill">{delivery.sessionsClosed}</span> <small>sessões fechadas</small>
      </div>
      <div className="ov-kpi-sub">de {delivery.featuresTouched} features tocadas na janela</div>
      <div className="ov-ship-list">
        {delivery.items.map((item) => (
          <div key={item.featureId} className="ov-srow">
            <span className="ov-srow-check">{item.status === "done" ? "✓" : "◔"}</span>
            <span className="ov-srow-name">{item.name}</span>
            <span className="ov-srow-meta">
              {item.sessionsClosed}/{item.sessionsTotal} sessão{item.sessionsTotal === 1 ? "" : "es"} · {fmtUsd(item.costUsd)}{item.costIncomplete ? " (parcial)" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Card "Eficiência": custo médio por sessão + seta de tendência + sparkline + P50/P95. */
function EfficiencyCard({ efficiency, onDrill }: { efficiency: OverviewData["efficiency"]; onDrill: OverviewDrill }) {
  const trendDown = efficiency.trendPct !== null && efficiency.trendPct < 0;
  const trendUp = efficiency.trendPct !== null && efficiency.trendPct > 0;
  return (
    <div className="ov-card">
      <h2><span className="ov-dot ov-dot-accent" />EFICIÊNCIA</h2>
      <div className="ov-trend">
        <div>
          <div className="ov-kpi ov-kpi-sm">{fmtUsd(efficiency.avgCostPerSession)} <small>/ sessão</small></div>
          <div className="ov-kpi-sub">
            custo médio
            {efficiency.trendPct !== null && (
              <span className={`ov-delta ${trendUp ? "ov-delta-up" : ""}`}>
                {" "}· {trendDown ? "▼" : "▲"} {Math.abs(efficiency.trendPct * 100).toFixed(0)}% vs período anterior
              </span>
            )}
          </div>
        </div>
        <Sparkline points={efficiency.spark} />
      </div>
      <div className="ov-kpi-sub ov-p50p95" onClick={onDrill.toTable} role="button" tabIndex={0}>
        P50 <b className="ov-drill">{fmtUsd(efficiency.p50)}</b> · P95 <b className="ov-drill">{fmtUsd(efficiency.p95)}</b>
      </div>
    </div>
  );
}

/** Card "Gasto": total (honesto — "(parcial)" se incompleto) + barras por projeto. */
function SpendCard({ spend, onDrill }: { spend: OverviewData["spend"]; onDrill: OverviewDrill }) {
  const max = Math.max(...spend.byProject.map((p) => p.costUsd), 1);
  return (
    <div className="ov-card">
      <h2><span className="ov-dot ov-dot-amber" />GASTO</h2>
      <div className="ov-kpi ov-kpi-sm ov-drill" onClick={onDrill.toTable} role="button" tabIndex={0}>
        {fmtUsd(spend.totalUsd)}{spend.incomplete ? " (parcial)" : ""}
      </div>
      <div className="ov-kpi-sub">{spend.activeProjects} projeto{spend.activeProjects === 1 ? "" : "s"} ativo{spend.activeProjects === 1 ? "" : "s"} na janela</div>
      <div className="ov-bars">
        {spend.byProject.map((p) => (
          <div className="ov-brow" key={p.projectName}>
            <span className="ov-brow-lbl">{p.projectName}</span>
            <span className="ov-brow-bar" style={{ width: `${(p.costUsd / max) * 100}%` }} />
            <span className="ov-brow-val">{p.costUsd.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Overview: cabeçalho com seletor de janela + grid primário (Atenção, Entrega) +
 * grid secundário (Eficiência, Gasto). Faixa daily + tabela de features vêm na Task 5.
 */
export function OverviewPage({ data, window, onWindow, onDrill }: {
  data: OverviewData;
  window: WindowKey;
  onWindow: (w: WindowKey) => void;
  onDrill: OverviewDrill;
}) {
  return (
    <div className="ov-page">
      <div className="ov-range">
        {Object.values(WINDOWS).map((w) => (
          <button
            key={w.key}
            type="button"
            className={w.key === window ? "on" : ""}
            onClick={() => onWindow(w.key)}
          >
            {w.label}
          </button>
        ))}
      </div>

      <div className="ov-grid ov-grid-primary">
        <AttentionCard attention={data.attention} onDrill={onDrill} />
        <DeliveryCard delivery={data.delivery} />
      </div>

      <div className="ov-grid ov-grid-secondary">
        <EfficiencyCard efficiency={data.efficiency} onDrill={onDrill} />
        <SpendCard spend={data.spend} onDrill={onDrill} />
      </div>
    </div>
  );
}
