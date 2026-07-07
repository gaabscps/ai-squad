import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OverviewPage } from "./OverviewPage";
import type { OverviewData } from "../lib/overview";

function make(over: Partial<OverviewData> = {}): OverviewData {
  return {
    window: "7d", attention: { count: 0, items: [] },
    delivery: { featuresDelivered: 0, sessionsClosed: 0, featuresTouched: 0, items: [] },
    efficiency: { avgCostPerSession: null, sessionsWithCost: 0, trendPct: null, p50: null, p95: null, spark: [] },
    spend: { totalUsd: null, incomplete: false, byProject: [], activeProjects: 0 },
    dailyLine: "Na janela: entregou 1 feature (Export).",
    featureRows: [{ projectId: "P", featureId: "F1", name: "Export de fatura", projectName: "p", key: "PAY-1", orphan: false, status: "running", doneSource: null, sessionsClosed: 0, sessionsTotal: 1, costUsd: 12, costIncomplete: false, lastActivityAt: null }],
    ...over,
  };
}

describe("OverviewPage — daily + janela + tabela", () => {
  it("mostra a dailyLine e a tabela de features", () => {
    render(<OverviewPage data={make()} window="7d" onWindow={() => {}} onDrill={{ attentionSession: () => {}, feature: () => {}, toTable: () => {} }} />);
    expect(screen.getByText(/entregou 1 feature/)).toBeInTheDocument();
    expect(screen.getByText("Export de fatura")).toBeInTheDocument();
  });

  it("seletor de janela chama onWindow", () => {
    const onWindow = vi.fn();
    render(<OverviewPage data={make()} window="7d" onWindow={onWindow} onDrill={{ attentionSession: () => {}, feature: () => {}, toTable: () => {} }} />);
    fireEvent.click(screen.getByText("30 dias"));
    expect(onWindow).toHaveBeenCalledWith("30d");
  });

  it("clique na linha da feature chama onDrill.feature", () => {
    const feature = vi.fn();
    render(<OverviewPage data={make()} window="7d" onWindow={() => {}} onDrill={{ attentionSession: () => {}, feature, toTable: () => {} }} />);
    fireEvent.click(screen.getByText("Export de fatura"));
    expect(feature).toHaveBeenCalled();
  });

  it("botão copiar da daily escreve no clipboard e mostra 'copiado' no sucesso", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const dailyLine = "Na janela: entregou 1 feature (Export).";
    render(<OverviewPage data={make()} window="7d" onWindow={() => {}} onDrill={{ attentionSession: () => {}, feature: () => {}, toTable: () => {} }} />);

    fireEvent.click(screen.getByRole("button", { name: /copiar/i }));
    expect(writeText).toHaveBeenCalledWith(dailyLine);
    expect(await screen.findByRole("button", { name: /copiado/i })).toBeTruthy();
  });

  it("botão copiar da daily não mostra 'copiado' se writeText rejeita", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OverviewPage data={make()} window="7d" onWindow={() => {}} onDrill={{ attentionSession: () => {}, feature: () => {}, toTable: () => {} }} />);

    fireEvent.click(screen.getByRole("button", { name: /copiar/i }));
    // Small tick to allow promise rejection to settle
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Assert the success text is absent and button still shows "copiar"
    expect(screen.queryByRole("button", { name: /copiado/i })).toBeNull();
    expect(screen.getByRole("button", { name: /copiar/i })).toBeTruthy();
  });
});
