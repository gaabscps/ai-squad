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
  it("lista os projetos visíveis e seus cards", () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1", title: "um" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2", title: "dois" })] },
    ]);
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.getByText("FEAT-2")).toBeInTheDocument();
  });

  it("filtra por tag de projeto ao clicar", async () => {
    renderBoard([
      { id: "a", name: "proj-a", specs: [makeSpec({ id: "FEAT-1" })] },
      { id: "b", name: "proj-b", specs: [makeSpec({ id: "FEAT-2" })] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
    expect(screen.queryByText("FEAT-2")).toBeNull(); // proj-b sumiu do filtro
  });

  it("esconde projetos hidden por padrão, com toggle pra mostrar", async () => {
    renderBoard([{ id: "a", name: "proj-a", hidden: true, specs: [makeSpec({ id: "FEAT-1" })] }]);
    expect(screen.queryByText("FEAT-1")).toBeNull(); // hidden não aparece
    await userEvent.click(screen.getByLabelText("mostrar ocultos"));
    expect(screen.getByText("FEAT-1")).toBeInTheDocument();
  });

  it("o botão ocultar manda o id estável pro callback", async () => {
    const { onHide } = renderBoard([{ id: "proj-abc", name: "proj-a", specs: [] }]);
    await userEvent.click(screen.getByRole("button", { name: "ocultar" }));
    expect(onHide).toHaveBeenCalledWith("proj-abc", true);
  });
});
