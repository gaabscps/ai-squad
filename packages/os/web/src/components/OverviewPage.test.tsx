import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverviewPage } from "./OverviewPage";
import type { OverviewData } from "../lib/overview";

const data: OverviewData = {
  window: "7d",
  attention: { count: 1, items: [{ projectId: "P", projectName: "p", sessionId: "OBS-9", what: "validar CNPJ", whyLabel: "aguardando sua resposta", since: null }] },
  delivery: { featuresDelivered: 1, sessionsClosed: 3, featuresTouched: 2, items: [{ featureId: "F1", name: "Export", projectName: "p", status: "done", sessionsClosed: 1, sessionsTotal: 1, costUsd: 73.31, costIncomplete: false, lastActivityAt: null }] },
  efficiency: { avgCostPerSession: 8.4, sessionsWithCost: 5, trendPct: -0.12, p50: 3.1, p95: 41, spark: [{ at: "2026-07-06", costUsd: 5 }] },
  spend: { totalUsd: 96.2, incomplete: false, byProject: [{ projectName: "p", costUsd: 96.2 }], activeProjects: 1 },
  dailyLine: "Na janela: entregou 1 feature (Export). Agora 1 sessão esperam você.",
  featureRows: [],
};

describe("OverviewPage — 4 cards", () => {
  it("mostra atenção, entrega, eficiência e gasto", () => {
    render(<OverviewPage data={data} window="7d" onWindow={() => {}} onDrill={{ attentionSession: () => {}, feature: () => {}, toTable: () => {} }} />);
    expect(screen.getByText("validar CNPJ")).toBeInTheDocument();
    expect(screen.getByText(/US\$ 8\.40/)).toBeInTheDocument();
    // total de gasto + a barra do único projeto mostram o mesmo valor formatado (fmtUsd) — duas ocorrências.
    expect(screen.getAllByText(/US\$ 96\.20/)).toHaveLength(2);
  });

  it("clicar numa linha da fila chama onDrill.attentionSession", () => {
    const attentionSession = vi.fn();
    render(<OverviewPage data={data} window="7d" onWindow={() => {}} onDrill={{ attentionSession, feature: () => {}, toTable: () => {} }} />);
    fireEvent.click(screen.getByText("validar CNPJ"));
    expect(attentionSession).toHaveBeenCalledWith(data.attention.items[0]);
  });

  it("DeliveryCard mostra plural correto 'sessões' com sessionsTotal >= 2", () => {
    const dataWithMultipleSessions: OverviewData = {
      ...data,
      delivery: {
        ...data.delivery,
        items: [
          {
            featureId: "F2",
            name: "Dashboard",
            projectName: "p",
            status: "running",
            sessionsClosed: 2,
            sessionsTotal: 2,
            costUsd: 150.0,
            costIncomplete: false,
            lastActivityAt: null,
          },
        ],
      },
    };
    render(
      <OverviewPage
        data={dataWithMultipleSessions}
        window="7d"
        onWindow={() => {}}
        onDrill={{ attentionSession: () => {}, feature: () => {}, toTable: () => {} }}
      />
    );
    // Verificar que o texto contém "sessões" (correto) e não "sessãoes" (incorreto)
    expect(screen.getByText(/2\/2 sessões/)).toBeInTheDocument();
    expect(screen.queryByText(/sessãoes/)).not.toBeInTheDocument();
  });
});
