import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailDrawer } from "./DetailDrawer";
import { makeSpec, makeProject, makeCost } from "../test-utils";
import { flattenSpecs } from "../lib/kanban";

function item(spec = makeSpec()) {
  return flattenSpecs([makeProject({ name: "proj-a", path: "/a", specs: [spec] })], false)[0];
}

describe("DetailDrawer", () => {
  it("fechado (item null) não renderiza conteúdo", () => {
    render(<DetailDrawer item={null} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("aberto mostra id, título e tarefas", () => {
    const spec = makeSpec({
      id: "FEAT-7",
      title: "Checkout",
      tasks: [
        { id: "T-1", state: "done", loops: 0 },
        { id: "T-2", state: "blocked", loops: 2 },
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("FEAT-7")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("T-2")).toBeInTheDocument();
    expect(screen.getByText(/2 loops/)).toBeInTheDocument();
  });

  it("loops=1 (passada normal) não conta como retrabalho", () => {
    const spec = makeSpec({ tasks: [{ id: "T-9", state: "done", loops: 1 }] });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("T-9")).toBeInTheDocument();
    expect(screen.queryByText(/loops/)).toBeNull(); // só >1 mostra ↻ N loops
  });

  it("mostra o breakdown de custo por tipo de token", () => {
    const spec = makeSpec({
      cost: makeCost({ tokens: { input: 1400, output: 220, cacheRead: 480, cacheCreation: 30 } }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/input/i)).toBeInTheDocument();
    expect(screen.getByText(/cache read/i)).toBeInTheDocument();
  });

  it("mostra o link do report quando há reportPath", () => {
    const spec = makeSpec({
      cost: makeCost({ reportPath: "/a/.agent-session/FEAT-7/report.html" }),
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const link = screen.getByRole("link", { name: /report/i });
    expect(link).toHaveAttribute("href", expect.stringContaining("report.html"));
  });

  it("sem reportPath não mostra link de report", () => {
    render(<DetailDrawer item={item(makeSpec({ cost: makeCost({ reportPath: null }) }))} onClose={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /report/i })).toBeNull();
  });

  it("botão fechar chama onClose", async () => {
    const onClose = vi.fn();
    render(<DetailDrawer item={item()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
