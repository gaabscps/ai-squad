import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { KanbanBoard } from "./KanbanBoard";
import { makeSpec, makeProject } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

const items = flattenSpecs(
  [makeProject({ specs: [
    makeSpec({ id: "R", status: "running" }),
    makeSpec({ id: "B", status: "blocked", tasks: [{ id: "T-1", state: "blocked", loops: 0 }] }),
    makeSpec({ id: "D", status: "done" }),
  ] })],
  false,
);

describe("KanbanBoard", () => {
  it("mostra as 3 colunas com seus títulos", () => {
    render(<KanbanBoard items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("Precisa de você")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
    expect(screen.getByText("Pronto")).toBeInTheDocument();
  });
  it("coloca cada spec na coluna certa", () => {
    render(<KanbanBoard items={items} onSelect={vi.fn()} />);
    expect(screen.getByText("R")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByText("D")).toBeInTheDocument();
  });
});
