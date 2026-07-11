import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "./KanbanBoard";
import { makeSpec, makeProject, makeFeature } from "../test-utils";
import { flattenFeatures } from "../lib/kanbanFeatures";

const items = flattenFeatures(
  [makeProject({
    specs: [
      makeSpec({ id: "R", status: "running" }),
      makeSpec({ id: "B", status: "needs_attention" }),
      makeSpec({ id: "W", status: "done" }),
      makeSpec({ id: "D", status: "done" }),
    ],
    features: [
      makeFeature({ id: "ft-R", name: "Feature R", sessionIds: ["R"], status: "running" }),
      makeFeature({ id: "ft-B", name: "Feature B", sessionIds: ["B"], status: "needs_attention" }),
      makeFeature({ id: "ft-W", name: "Feature W", sessionIds: ["W"], status: "awaiting_deploy" }),
      makeFeature({ id: "ft-D", name: "Feature D", sessionIds: ["D"], status: "done" }),
    ],
  })],
  false,
);

describe("KanbanBoard", () => {
  it("mostra as 4 colunas com seus títulos", () => {
    render(<KanbanBoard items={items} onSelectSession={vi.fn()} />);
    expect(screen.getByText("Precisa de você")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
    expect(screen.getByText("Aguardando deploy")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();
  });

  it("coloca cada feature na coluna certa (derivada do status da feature, não da sessão)", () => {
    render(<KanbanBoard items={items} onSelectSession={vi.fn()} />);
    const attentionCol = screen.getByText("Precisa de você").closest("section")!;
    const runningCol = screen.getByText("Em andamento").closest("section")!;
    const deployCol = screen.getByText("Aguardando deploy").closest("section")!;
    const doneCol = screen.getByText("Pronto").closest("section")!;
    expect(attentionCol.textContent).toContain("Feature B");
    expect(runningCol.textContent).toContain("Feature R");
    expect(deployCol.textContent).toContain("Feature W");
    expect(doneCol.textContent).toContain("Feature D");
  });

  it("expandir o card de feature revela a sessão-membro; clicar nela chama onSelectSession com a sessão certa", async () => {
    const onSelectSession = vi.fn();
    render(<KanbanBoard items={items} onSelectSession={onSelectSession} />);
    await userEvent.click(screen.getByText("Feature R"));
    await userEvent.click(screen.getByText("R"));
    expect(onSelectSession).toHaveBeenCalledWith(
      expect.objectContaining({ spec: expect.objectContaining({ id: "R" }) }),
    );
  });

  it("coluna vazia mostra o placeholder 'nada aqui'", () => {
    const onlyDone = flattenFeatures(
      [makeProject({
        specs: [makeSpec({ id: "D", status: "done" })],
        features: [makeFeature({ id: "ft-D", name: "Feature D", sessionIds: ["D"], status: "done" })],
      })],
      false,
    );
    render(<KanbanBoard items={onlyDone} onSelectSession={vi.fn()} />);
    const attentionCol = screen.getByText("Precisa de você").closest("section")!;
    expect(attentionCol.textContent).toContain("nada aqui");
  });
});
