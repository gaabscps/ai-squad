import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FeatureCard } from "./FeatureCard";
import type { FeatureWithProject } from "../lib/kanbanFeatures";

// Mesmo fixture de FeatureCard.test.tsx (não há test-utils compartilhado na
// suíte web ainda, então duplica aqui — ver brief Task 10).
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

describe("ações de correção manual", () => {
  it("feature aberta (com key) mostra os dois botões e emite feature:setDelivery certo", () => {
    const onAction = vi.fn();
    const item = { ...base, feature: { ...base.feature, status: "idle" as const } }; // base.feature tem key "PAY-1"
    render(<FeatureCard item={item} onSelectSession={() => {}} onFeatureAction={onAction}
      knownFeatures={[]} />);

    expect(screen.queryByText("reabrir")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("marcar aguardando deploy"));
    expect(onAction).toHaveBeenCalledWith({
      type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "awaiting_deploy",
    });

    fireEvent.click(screen.getByText("marcar como entregue"));
    expect(onAction).toHaveBeenCalledWith({
      type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "done",
    });
  });

  it("feature aguardando deploy mostra a tag, 'marcar como entregue' e 'reabrir' (sem repetir o botão de entrar em deploy)", () => {
    const onAction = vi.fn();
    const item = { ...base, feature: { ...base.feature, status: "awaiting_deploy" as const } };
    render(<FeatureCard item={item} onSelectSession={() => {}} onFeatureAction={onAction}
      knownFeatures={[]} />);

    expect(screen.getByText("aguardando deploy")).toBeInTheDocument();
    expect(screen.queryByText("marcar aguardando deploy")).not.toBeInTheDocument();
    expect(screen.getByText("marcar como entregue")).toBeInTheDocument();

    fireEvent.click(screen.getByText("reabrir"));
    expect(onAction).toHaveBeenCalledWith({
      type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "open",
    });
  });

  it("feature entregue mostra só 'reabrir'", () => {
    const onAction = vi.fn();
    const item = { ...base, feature: { ...base.feature, status: "done" as const, doneSource: "manual" as const } };
    render(<FeatureCard item={item} onSelectSession={() => {}} onFeatureAction={onAction}
      knownFeatures={[]} />);

    expect(screen.queryByText("marcar aguardando deploy")).not.toBeInTheDocument();
    expect(screen.queryByText("marcar como entregue")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("reabrir"));
    expect(onAction).toHaveBeenCalledWith({
      type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "open",
    });
  });

  it("mover sessão envia feature:assign com a feature escolhida", () => {
    const onAction = vi.fn();
    render(<FeatureCard item={base} onSelectSession={() => {}} onFeatureAction={onAction}
      knownFeatures={[{ id: "AUTH-9", name: "Login" }]} />);
    fireEvent.click(screen.getByText("Export de fatura")); // expande
    fireEvent.click(screen.getByLabelText("mover OBS-001"));
    fireEvent.change(screen.getByLabelText("nova feature de OBS-001"), { target: { value: "AUTH-9" } });
    expect(onAction).toHaveBeenCalledWith({
      type: "feature:assign", projectId: "P", sessionId: "OBS-001", featureId: "AUTH-9",
    });
  });

  it("escolher 'Sem feature' envia feature:assign com featureId: null", () => {
    const onAction = vi.fn();
    render(<FeatureCard item={base} onSelectSession={() => {}} onFeatureAction={onAction}
      knownFeatures={[{ id: "AUTH-9", name: "Login" }]} />);
    fireEvent.click(screen.getByText("Export de fatura")); // expande
    fireEvent.click(screen.getByLabelText("mover OBS-001"));
    fireEvent.change(screen.getByLabelText("nova feature de OBS-001"), { target: { value: "__none__" } });
    expect(onAction).toHaveBeenCalledWith({
      type: "feature:assign", projectId: "P", sessionId: "OBS-001", featureId: null,
    });
  });
});
