import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DetailDrawer } from "./DetailDrawer";
import { makeSpec, makeProject, makeCost, makeTask, makeDispatch } from "../test-utils";
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
        makeTask({ id: "T-1", state: "done", loops: 0 }),
        makeTask({ id: "T-2", state: "blocked", loops: 2 }),
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
    const spec = makeSpec({ tasks: [makeTask({ id: "T-9", state: "done", loops: 1 })] });
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

// ─── AC-015: tarefas renderizadas via TaskItem (colapsadas por padrão) ────────

describe("AC-015: tarefas via TaskItem — colapsadas por padrão no drawer", () => {
  it("cada tarefa renderiza como botão colapsado (aria-expanded=false)", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({ id: "T-1", state: "done", loops: 0 }),
        makeTask({ id: "T-2", state: "blocked", loops: 2 }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const taskButtons = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(taskButtons).toHaveLength(2);
    taskButtons.forEach((btn) =>
      expect(btn).toHaveAttribute("aria-expanded", "false")
    );
  });

  it("tarefa com tokens no dispatch exibe o total de tokens na linha colapsada", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-3",
          state: "done",
          loops: 0,
          dispatches: [makeDispatch({ tokens: 2000 })],
        }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText(/2K.*tok|tok.*2K/)).toBeInTheDocument();
  });

  it("tarefa com todos dispatches de tokens null omite total de tokens", () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-4",
          state: "pending",
          dispatches: [makeDispatch({ tokens: null })],
        }),
      ],
    });
    const { container } = render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(container.querySelector(".task-item-tokens")).toBeNull();
  });

  it("clique numa tarefa no drawer a expande — conteúdo rico fica visível", async () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-5",
          state: "done",
          dispatches: [makeDispatch({ summary: "resumo da tarefa T-5" })],
        }),
      ],
    });
    render(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    const [taskBtn] = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    await userEvent.click(taskBtn);
    expect(screen.getByText("resumo da tarefa T-5")).toBeInTheDocument();
  });
});

// ─── AC-021: re-render por push WS não lança erro ────────────────────────────

describe("AC-021: push WebSocket re-renderiza sem erro; expansão é efêmera", () => {
  it("estado de expansão sobrevive a re-render normal (mesmas props)", async () => {
    const spec = makeSpec({
      tasks: [
        makeTask({
          id: "T-6",
          state: "done",
          dispatches: [makeDispatch({ summary: "conteúdo expandido" })],
        }),
      ],
    });
    const { rerender } = render(
      <DetailDrawer item={item(spec)} onClose={vi.fn()} />
    );
    const [taskBtn] = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    await userEvent.click(taskBtn);
    expect(screen.getByText("conteúdo expandido")).toBeInTheDocument();

    // re-render normal com as mesmas props — expansão sobrevive
    rerender(<DetailDrawer item={item(spec)} onClose={vi.fn()} />);
    expect(screen.getByText("conteúdo expandido")).toBeInTheDocument();
  });

  it("push WS com Project[] novo causa re-render sem lançar erro", async () => {
    const spec1 = makeSpec({
      tasks: [
        makeTask({
          id: "T-7",
          state: "running",
          dispatches: [makeDispatch({ summary: "em progresso" })],
        }),
      ],
    });
    const spec2 = makeSpec({
      tasks: [
        makeTask({
          id: "T-7",
          state: "done",
          dispatches: [makeDispatch({ summary: "concluída agora" })],
        }),
      ],
    });
    const { rerender } = render(
      <DetailDrawer item={item(spec1)} onClose={vi.fn()} />
    );

    const [taskBtn] = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    await userEvent.click(taskBtn);
    expect(taskBtn).toHaveAttribute("aria-expanded", "true");

    // simula push WS: novo Project[] => novo item com spec atualizada; não deve lançar
    expect(() =>
      rerender(<DetailDrawer item={item(spec2)} onClose={vi.fn()} />)
    ).not.toThrow();

    // estado de expansão é efêmero — pode recolher no push (AC-021, documentado como válido);
    // com mesmo task.id a reconciliação React preserva o estado local (comportamento atual)
    const taskBtns = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-expanded") !== null);
    expect(taskBtns).toHaveLength(1);
    expect(taskBtns[0]).toHaveAttribute("aria-expanded", "true");
    // novo estado da spec2 ("done" → "concluída") visível — prova que o rerender rodou
    expect(screen.getByText("concluída")).toBeInTheDocument();
  });

  it("push WS com spec sem tarefas não quebra o render", () => {
    const spec = makeSpec({ tasks: [] });
    const { rerender } = render(
      <DetailDrawer item={item(spec)} onClose={vi.fn()} />
    );
    expect(() =>
      rerender(<DetailDrawer item={item(makeSpec({ tasks: [] }))} onClose={vi.fn()} />)
    ).not.toThrow();
    expect(screen.getByText(/sem tarefas registradas/i)).toBeInTheDocument();
  });
});
