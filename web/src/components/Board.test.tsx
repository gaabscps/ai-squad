import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { ProjectsProvider } from "../state/projects";
import { makeProject, makeSpec } from "../test-utils";

function renderBoard(
  projects: Parameters<typeof makeProject>[0][] = [],
  onHide = vi.fn(),
  archiveAfterDays = 7,
) {
  const built = projects.map((p) => makeProject(p));
  return {
    onHide,
    ...render(
      <ProjectsProvider initial={built} initialArchiveAfterDays={archiveAfterDays}>
        <Board onHide={onHide} />
      </ProjectsProvider>,
    ),
  };
}

describe("Board", () => {
  it("mostra os cards das specs no kanban por padrão", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", status: "running", tasks: [{ id: "T-1", state: "running", loops: 0, dispatches: [] }] })] }]);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("Em andamento")).toBeInTheDocument();
  });

  it("filtra por projeto", async () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull();
  });

  it("busca filtra por texto", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [
      makeSpec({ id: "FEAT-1", title: "Exportar PDF" }),
      makeSpec({ id: "FEAT-2", title: "Login social" }),
    ] }]);
    await userEvent.type(screen.getByPlaceholderText(/buscar/i), "pdf");
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull();
  });

  it("alterna pra tabela", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] }]);
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("clicar num card abre o drawer; fechar o esconde", async () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", title: "Checkout" })] }]);
    await userEvent.click(screen.getByText("FEAT-1"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ocultar manda o id estável e reseta o filtro do projeto oculto", async () => {
    const { onHide } = renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "proj-xyz", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" })); // filtra proj-a
    await userEvent.click(screen.getByRole("button", { name: /ocultar proj-a/i }));
    expect(onHide).toHaveBeenCalledWith("proj-abc", true);
    expect(screen.getByText("FEAT-2")).toBeInTheDocument(); // filtro resetou
  });

  it("desligar 'mostrar ocultos' reseta o filtro de um projeto oculto (não deixa o board vazio)", async () => {
    renderBoard([
      { id: "proj-abc", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "proj-xyz", name: "proj-b", hidden: true, specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i)); // revela proj-b
    await userEvent.click(screen.getByRole("button", { name: "proj-b" })); // filtra o oculto
    expect(screen.queryByText("FEAT-1")).toBeNull(); // só proj-b
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i)); // desliga de novo
    expect(screen.getByText("FEAT-1")).toBeInTheDocument(); // filtro resetou, board não ficou vazio
  });
});

describe("Board — arquivamento", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  // "now" = 2026-06-10; limite = 7 dias
  // doneVelha: lastActivityAt = 2026-06-01 → 9 dias atrás → arquivada
  // doneNova:  lastActivityAt = 2026-06-09 → 1 dia atrás → NÃO arquivada
  const doneVelha = () =>
    makeSpec({ id: "FEAT-OLD", status: "done", lastActivityAt: "2026-06-01T00:00:00Z" });
  const doneNova = () =>
    makeSpec({ id: "FEAT-NEW", status: "done", lastActivityAt: "2026-06-09T00:00:00Z" });

  it("kanban esconde a done velha (arquivada)", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()] }]);
    expect(screen.queryByText("FEAT-OLD")).toBeNull();
    expect(screen.getByText("FEAT-NEW")).toBeInTheDocument(); // done nova ainda aparece
  });

  it("aba Arquivadas mostra só a done velha", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneVelha(), doneNova()] }]);
    // Usa fireEvent pra evitar hang de userEvent com fake timers
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText("FEAT-OLD")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-NEW")).toBeNull();
  });

  it("aba Arquivadas vazia mostra empty state", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [doneNova()] }]);
    fireEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(screen.getByText(/nenhuma feature arquivada/i)).toBeInTheDocument();
  });
});
