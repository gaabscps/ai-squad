import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { ProjectsProvider } from "../state/projects";
import { makeProject, makeSpec } from "../test-utils";

function renderBoard(projects: Parameters<typeof makeProject>[0][] = [], onHide = vi.fn()) {
  const built = projects.map((p) => makeProject(p));
  return {
    onHide,
    ...render(
      <ProjectsProvider initial={built}>
        <Board onHide={onHide} />
      </ProjectsProvider>,
    ),
  };
}

describe("Board", () => {
  it("mostra os cards das specs no kanban por padrão", () => {
    renderBoard([{ id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", status: "running" })] }]);
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
});
