import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanCard } from "./KanbanCard";
import { makeSpec, makeProject } from "../test-utils";
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
});
