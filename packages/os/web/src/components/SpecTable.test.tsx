import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpecTable } from "./SpecTable";
import { makeSpec, makeProject, makeCost, makeObservedSpec } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

const items = flattenSpecs(
  [
    makeProject({
      name: "proj-a",
      specs: [
        makeSpec({
          id: "FEAT-1",
          title: "Alpha",
          cost: makeCost({ totalCostUsd: 2 }),
        }),
        makeSpec({
          id: "FEAT-2",
          title: "Beta",
          cost: makeCost({ totalCostUsd: 9 }),
        }),
      ],
    }),
  ],
  false
);

describe("SpecTable", () => {
  it("renderiza uma linha por spec com id e título", () => {
    render(<SpecTable items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("clicar numa linha chama onSelect", async () => {
    const onSelect = vi.fn();
    render(<SpecTable items={items} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("Alpha"));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it("ordena por custo ao clicar no cabeçalho de custo", async () => {
    render(<SpecTable items={items} onSelect={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /custo/i }));
    const rows = screen.getAllByRole("row").slice(1); // pula o header
    expect(within(rows[0]).getByText("FEAT-1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /custo/i }));
    const rows2 = screen.getAllByRole("row").slice(1);
    expect(within(rows2[0]).getByText("FEAT-2")).toBeInTheDocument();
  });

  it("coluna 'fase' foi renomeada para 'modo'", () => {
    render(<SpecTable items={items} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^modo/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^fase$/i })).not.toBeInTheDocument();
  });

  it("spec observada mostra 'observado' na célula de modo", () => {
    const obsItems = flattenSpecs(
      [makeProject({ name: "p", specs: [makeObservedSpec({ id: "OBS-001", title: "Obs test" })] })],
      false,
    );
    render(<SpecTable items={obsItems} onSelect={vi.fn()} />);
    expect(screen.getByText("observado")).toBeInTheDocument();
  });

  it("status cell exibe o label em pt-BR (não a string crua do enum)", () => {
    const obsItems = flattenSpecs(
      [makeProject({ name: "p", specs: [makeObservedSpec({ id: "OBS-001", status: "needs_attention" })] })],
      false,
    );
    render(<SpecTable items={obsItems} onSelect={vi.fn()} />);
    // label mapeado, não o enum cru "needs_attention"
    expect(screen.getByText("precisa de você")).toBeInTheDocument();
    expect(screen.queryByText("needs_attention")).not.toBeInTheDocument();
  });

  it("custo: source=cost_report + totalCostUsd null → exibe '$ indisponível' muted (não '—')", () => {
    const obsItems = flattenSpecs(
      [makeProject({
        name: "p",
        specs: [makeObservedSpec({
          id: "OBS-002",
          cost: makeCost({ source: "cost_report", totalCostUsd: null }),
        })],
      })],
      false,
    );
    render(<SpecTable items={obsItems} onSelect={vi.fn()} />);
    const hint = screen.getByText(/\$ indisponível/i);
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveClass("cost-unpriced");
    // não deve exibir o traço solitário como valor de custo
    expect(hint.textContent).not.toBe("—");
  });

  it("custo: source=partial com totalCostUsd disponível + status running → exibe '(em coleta)'", () => {
    const partialItems = flattenSpecs(
      [makeProject({
        name: "p",
        specs: [makeSpec({
          id: "FEAT-P",
          status: "running",
          cost: makeCost({ source: "partial", totalCostUsd: 3.5 }),
        })],
      })],
      false,
    );
    render(<SpecTable items={partialItems} onSelect={vi.fn()} />);
    expect(screen.getByText(/em coleta/i)).toBeInTheDocument();
    expect(screen.getByText(/3[.,]50/)).toBeInTheDocument();
  });

  it("custo: source=partial + status done → exibe 'custo não capturado'", () => {
    const doneItems = flattenSpecs(
      [makeProject({
        name: "p",
        specs: [makeSpec({
          id: "FEAT-D",
          status: "done",
          cost: makeCost({ source: "partial", totalCostUsd: 7.0 }),
        })],
      })],
      false,
    );
    render(<SpecTable items={doneItems} onSelect={vi.fn()} />);
    expect(screen.getByText(/custo não capturado/i)).toBeInTheDocument();
  });
});
