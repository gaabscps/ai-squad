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
});
