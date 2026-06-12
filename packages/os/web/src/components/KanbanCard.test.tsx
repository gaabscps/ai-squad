import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanCard } from "./KanbanCard";
import { makeSpec, makeProject, makeCost, makeTask, makeObservedSpec } from "../test-utils";
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

  it("SDD sem custo: 'sem custo registrado' em vez de 'em planejamento'", () => {
    // fixture SDD: cost.source "empty"
    const sddEmptyCost = makeSpec({ cost: makeCost({ source: "empty", totalCostUsd: null }) });
    render(<KanbanCard item={item(sddEmptyCost)} onSelect={() => {}} />);
    expect(screen.getByText("sem custo registrado")).toBeTruthy();
    expect(screen.queryByText("em planejamento")).toBeNull();
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

describe("KanbanCard — modo observado", () => {
  it("NÃO renderiza o contador de tarefas N/M concluídas", () => {
    const spec = makeObservedSpec({ id: "OBS-001", title: "Refatorar auth" });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.queryByText(/concluídas/i)).not.toBeInTheDocument();
  });

  it("renderiza data-mode='observed' no article", () => {
    const spec = makeObservedSpec({ id: "OBS-001" });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    const article = screen.getByRole("article");
    expect(article).toHaveAttribute("data-mode", "observed");
  });

  it("elemento de título tem atributo title para tooltip em intents longos", () => {
    const longIntent = "Implementar novo fluxo de autenticação com SSO e 2FA completo";
    const spec = makeObservedSpec({ id: "OBS-001", title: longIntent });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    const titleEl = screen.getByText(longIntent);
    expect(titleEl).toHaveAttribute("title", longIntent);
  });

  it("custo: totalCostUsd presente → exibe fmtUsd", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "cost_report", totalCostUsd: 4.37 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/4[.,]37/)).toBeInTheDocument();
  });

  it("custo: source=cost_report + totalCostUsd null → exibe tokens como métrica primária + hint '$ indisponível'", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "cost_report", totalCostUsd: null, totalTokens: 7_700_000 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    // token total como métrica primária (7.7M tokens)
    expect(screen.getByText(/7[.,]7M/)).toBeInTheDocument();
    // hint de $ indisponível com classe cost-unpriced
    const hint = screen.getByText(/indisponível/i);
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass("cost-unpriced");
  });

  it("custo: source=cost_report + totalCostUsd null → NUNCA exibe '$0.00' nem '—' sozinho", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "cost_report", totalCostUsd: null, totalTokens: 500 }),
    });
    const { container } = render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(container.textContent).not.toMatch(/US\$\s*0[.,]00/);
    // "—" sozinho no custo é proibido; tokens devem aparecer
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it("custo: source=empty em spec observada → exibe 'sem custo ainda' (não 'em planejamento')", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "empty", totalCostUsd: null, totalTokens: 0 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/sem custo ainda/i)).toBeInTheDocument();
    expect(screen.queryByText(/em planejamento/i)).not.toBeInTheDocument();
  });

  it("custo: observed partial com tokens > 0 → exibe tokens + '(em coleta)'", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "partial", totalCostUsd: null, totalTokens: 3_400_000 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/3[.,]4M/)).toBeInTheDocument();
    expect(screen.getByText(/em coleta/i)).toBeInTheDocument();
    expect(screen.queryByText(/sem custo ainda/i)).not.toBeInTheDocument();
  });

  it("custo: observed partial com totalTokens === 0 → exibe 'sem custo ainda'", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "partial", totalCostUsd: null, totalTokens: 0 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/sem custo ainda/i)).toBeInTheDocument();
  });

  it("custo: observed source=partial + totalCostUsd não-nulo → exibe USD + '(em coleta)'", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "partial", totalCostUsd: 11.89 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/11[.,]89/)).toBeInTheDocument();
    expect(screen.getByText(/em coleta/i)).toBeInTheDocument();
  });

  it("custo: observed source=cost_report + totalCostUsd não-nulo → SEM sufixo '(em coleta)'", () => {
    const spec = makeObservedSpec({
      id: "OBS-001",
      cost: makeCost({ source: "cost_report", totalCostUsd: 22.50 }),
    });
    render(<KanbanCard item={item(spec)} onSelect={vi.fn()} />);
    expect(screen.getByText(/22[.,]50/)).toBeInTheDocument();
    expect(screen.queryByText(/em coleta/i)).not.toBeInTheDocument();
  });

  it("observado TERMINAL sem cost_report: 'custo não capturado' em vez de '(em coleta)'", () => {
    // fixture observada: status "done", cost.source "partial", totalCostUsd 5.11
    const doneObservedPartial = makeObservedSpec({
      id: "OBS-002",
      status: "done",
      cost: makeCost({ source: "partial", totalCostUsd: 5.11 }),
    });
    render(<KanbanCard item={item(doneObservedPartial)} onSelect={() => {}} />);
    expect(screen.getByText(/custo não capturado/)).toBeTruthy();
    expect(screen.queryByText(/em coleta/)).toBeNull();
  });
});
