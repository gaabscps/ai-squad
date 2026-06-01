import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanColumn } from "./KanbanColumn";
import { makeSpec, makeProject } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

const items = flattenSpecs(
  [makeProject({ specs: [makeSpec({ id: "A" }), makeSpec({ id: "B" })] })],
  false,
);

describe("KanbanColumn", () => {
  it("mostra rótulo e contagem", () => {
    render(<KanbanColumn columnKey="running" label="Em andamento" items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
  it("renderiza um card por item", () => {
    render(<KanbanColumn columnKey="running" label="Em andamento" items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });
  it("vazia mostra placeholder", () => {
    render(<KanbanColumn columnKey="done" label="Pronto" items={[]} onSelect={vi.fn()} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/nada aqui/i)).toBeInTheDocument();
  });
});
