import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeatureCard } from "./FeatureCard";
import type { FeatureWithProject } from "../lib/kanbanFeatures";

function makeItem(over: Partial<FeatureWithProject> = {}, featureOver: Partial<FeatureWithProject["feature"]> = {}): FeatureWithProject {
  return {
    projectId: "P", projectName: "p",
    feature: {
      id: "PAY-1", key: "PAY-1", name: "Export de fatura", orphan: false, projectId: "P",
      sessionIds: ["OBS-001"], status: "running", doneSource: null,
      attention: { count: 0, items: [] },
      delivery: { sessionsClosed: 0, sessionsTotal: 1, deliverables: [] },
      cost: { totalCostUsd: 2.5, totalTokens: 10, tokens: { input: 5, output: 5, cacheRead: 0, cacheCreation: 0 }, incomplete: false },
      time: { firstOpenedAt: null, lastClosedAt: null, spanMs: null, engagedMs: null },
      lastActivityAt: null, jira: null,
      ...featureOver,
    },
    sessions: [{
      projectId: "P", projectName: "p", projectPath: "/p",
      spec: {
        id: "OBS-001", title: "sessão 1", status: "running", observed: {},
        health: { pendingHuman: 0, escalationRate: 0, auditException: false },
      } as never,
    }],
    ...over,
  };
}

const base = makeItem();

describe("FeatureCard", () => {
  it("mostra nome, key e contagem de sessões", () => {
    render(<FeatureCard item={base} onSelectSession={() => {}} />);
    expect(screen.getByText("Export de fatura")).toBeInTheDocument();
    expect(screen.getByText("PAY-1")).toBeInTheDocument();
    expect(screen.getByText("0/1 sessões")).toBeInTheDocument();
  });

  it("sessões-membro NÃO aparecem antes de expandir o card", () => {
    render(<FeatureCard item={base} onSelectSession={() => {}} />);
    expect(screen.queryByText("OBS-001")).not.toBeInTheDocument();
  });

  it("expande e clique na sessão chama onSelectSession com a sessão certa", async () => {
    const onSelect = vi.fn();
    render(<FeatureCard item={base} onSelectSession={onSelect} />);
    await userEvent.click(screen.getByText("Export de fatura"));
    await userEvent.click(screen.getByText("OBS-001"));
    expect(onSelect).toHaveBeenCalledWith(base.sessions[0]);
  });

  it("custo parcial mostra sufixo '(parcial)'", async () => {
    const item = makeItem({}, { cost: { totalCostUsd: 3, totalTokens: 10, tokens: { input: 5, output: 5, cacheRead: 0, cacheCreation: 0 }, incomplete: true } });
    render(<FeatureCard item={item} onSelectSession={() => {}} />);
    expect(screen.getByText(/parcial/)).toBeInTheDocument();
  });

  it("feature sem custo completo (incomplete=false) NÃO mostra '(parcial)'", () => {
    render(<FeatureCard item={base} onSelectSession={() => {}} />);
    expect(screen.queryByText(/parcial/)).not.toBeInTheDocument();
  });

  it("mostra contagem de atenção quando attention.count > 0", () => {
    const item = makeItem({}, { attention: { count: 2, items: [] } });
    render(<FeatureCard item={item} onSelectSession={() => {}} />);
    expect(screen.getByText(/2 aguardando você/)).toBeInTheDocument();
  });

  it("sem itens de atenção não mostra a contagem", () => {
    render(<FeatureCard item={base} onSelectSession={() => {}} />);
    expect(screen.queryByText(/aguardando você/)).not.toBeInTheDocument();
  });

  it("feature órfã mostra a tag 'sem feature'", () => {
    const item = makeItem({}, { orphan: true });
    render(<FeatureCard item={item} onSelectSession={() => {}} />);
    expect(screen.getByText("sem feature")).toBeInTheDocument();
  });

  it("feature idle mostra dica de marcar entregue", () => {
    const item = makeItem({}, { status: "idle" });
    render(<FeatureCard item={item} onSelectSession={() => {}} />);
    expect(screen.getByText(/marcar entregue/i)).toBeInTheDocument();
  });

  it("feature done com doneSource jira mostra tag 'entregue · Jira'", () => {
    const item = makeItem({}, { status: "done", doneSource: "jira" });
    render(<FeatureCard item={item} onSelectSession={() => {}} />);
    expect(screen.getByText(/entregue · Jira/)).toBeInTheDocument();
  });

  it("feature awaiting_deploy mostra a tag 'aguardando deploy'", () => {
    const item = makeItem({}, { status: "awaiting_deploy" });
    render(<FeatureCard item={item} onSelectSession={() => {}} />);
    expect(screen.getByText("aguardando deploy")).toBeInTheDocument();
  });
});
