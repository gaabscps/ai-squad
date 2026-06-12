import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanCard } from "./KanbanCard";
import { makeSpec, makeProject, makeCost, makeTask } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

function item(spec = makeSpec()) {
  return flattenSpecs([makeProject({ name: "proj-a", specs: [spec] })], false)[0];
}

describe("KanbanCard", () => {
  it("mostra id, título e projeto", () => {
    render(<KanbanCard item={item(makeSpec({ id: "FEAT-9", title: "Tema" }))} onSelect={vi.fn()} />);
    expect(screen.getByText("FEAT-9")).toBeInTheDocument();
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("proj-a")).toBeInTheDocument();
  });

  it("em atenção mostra o motivo", () => {
    const spec = makeSpec({ status: "blocked", tasks: [{ id: "T-5", state: "blocked", loops: 0, dispatches: [] }] });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/T-5 bloqueada/)).toBeInTheDocument();
  });

  it("em andamento mostra a fase atual", () => {
    const spec = makeSpec({ status: "running", phase: "tasks", plannedPhases: ["specify", "plan", "tasks", "implementation"] });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/tasks/)).toBeInTheDocument();
  });

  it("clicar chama onSelect com o item", async () => {
    const onSelect = vi.fn();
    const it0 = item(makeSpec({ id: "FEAT-9" }));
    render(<KanbanCard item={it0} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("FEAT-9"));
    expect(onSelect).toHaveBeenCalledWith(it0);
  });

  it("exibe o status badge da spec", () => {
    const spec = makeSpec({ status: "running" });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText("rodando")).toBeInTheDocument();
  });

  it("exibe o status badge 'concluído' para spec done", () => {
    const spec = makeSpec({ status: "done", phase: "done", plannedPhases: ["specify", "implementation"] });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText("concluído")).toBeInTheDocument();
  });

  it("exibe custo formatado quando source é 'report'", () => {
    const spec = makeSpec({ cost: makeCost({ source: "report", totalCostUsd: 179.23 }) });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/179\.23/)).toBeInTheDocument();
  });

  it("exibe 'em planejamento' quando source é 'empty'", () => {
    const spec = makeSpec({ cost: makeCost({ source: "empty", totalCostUsd: null }) });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/em planejamento/i)).toBeInTheDocument();
  });

  it("exibe badge '(parcial)' quando source é 'partial' com custo disponível", () => {
    const spec = makeSpec({ cost: makeCost({ source: "partial", totalCostUsd: 5.5 }) });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/5\.50/)).toBeInTheDocument();
    expect(screen.getByText(/parcial/i)).toBeInTheDocument();
  });

  it("exibe '(em coleta)' sem traço quando source é 'partial' e totalCostUsd é null", () => {
    const spec = makeSpec({ cost: makeCost({ source: "partial", totalCostUsd: null }) });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    const costEl = screen.getByText(/em coleta/i);
    expect(costEl).toBeInTheDocument();
    expect(costEl.textContent).not.toContain("—");
  });

  it("exibe aviso de baixa confiança quando source é 'unreliable'", () => {
    const spec = makeSpec({ cost: makeCost({ source: "unreliable", totalCostUsd: 3.0 }) });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/baixa confiança/i)).toBeInTheDocument();
  });

  it("exibe contagem de tarefas concluídas/total corretamente", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({ id: "T-001", state: "done" }),
        makeTask({ id: "T-002", state: "done" }),
        makeTask({ id: "T-003", state: "running" }),
      ],
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/2\/3/)).toBeInTheDocument();
  });

  it("exibe 0/0 quando não há tarefas", () => {
    const spec = makeSpec({ tasks: [] });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/0\/0/)).toBeInTheDocument();
  });

  it("conta apenas tarefas com state 'done' como concluídas", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({ id: "T-001", state: "pending" }),
        makeTask({ id: "T-002", state: "running" }),
        makeTask({ id: "T-003", state: "blocked" }),
      ],
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/0\/3/)).toBeInTheDocument();
  });

  it("exibe barra de fases quando byPhase tem dados", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        byPhase: { planning: 7.92, orchestration: 142.06, implementation: 29.25 },
      }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByRole("list", { name: /fases/i })).toBeInTheDocument();
  });

  it("não exibe barra de fases quando byPhase é null", () => {
    const spec = makeSpec({ cost: makeCost({ byPhase: null }) });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.queryByRole("list", { name: /fases/i })).not.toBeInTheDocument();
  });

  it("barra de fases reflete proporção do custo por fase", () => {
    const spec = makeSpec({
      cost: makeCost({
        source: "report",
        byPhase: { planning: 10, orchestration: 70, implementation: 20 },
      }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    const items = screen.getAllByRole("listitem");
    const orchestrationItem = items.find(el => el.getAttribute("data-phase") === "orchestration");
    expect(orchestrationItem).toBeDefined();
    const style = orchestrationItem!.getAttribute("style") ?? "";
    // orchestration é 70% do total (10+70+20=100)
    expect(style).toContain("70");
  });
});
