import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Board } from "./Board";
import { ProjectsProvider } from "../state/projects";
import { makeProject, makeObservedSpec, makeFeature } from "../test-utils";

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

describe("Board — landing overview", () => {
  it("abre na Overview por padrão (não no kanban)", () => {
    renderBoard([
      {
        id: "a",
        name: "proj-a",
        specs: [makeObservedSpec({ id: "FEAT-1", status: "done" })],
        features: [makeFeature({ id: "ft-1", name: "Feature Um", sessionIds: ["FEAT-1"], status: "done" })],
      },
    ]);
    // "PRA DAILY" é exclusiva da faixa daily da Overview.
    expect(screen.getByText("PRA DAILY")).toBeInTheDocument();
    // A coluna de kanban não deve estar presente no load.
    expect(screen.queryByText("Precisa de você")).toBeNull();
  });

  it("botão Overview/Kanban alterna a view", async () => {
    renderBoard([
      {
        id: "a",
        name: "proj-a",
        specs: [makeObservedSpec({ id: "FEAT-1", status: "done" })],
        features: [makeFeature({ id: "ft-1", name: "Feature Um", sessionIds: ["FEAT-1"], status: "done" })],
      },
    ]);
    expect(screen.getByText("PRA DAILY")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.queryByText("PRA DAILY")).toBeNull();
    expect(screen.getByText("Precisa de você")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(screen.getByText("PRA DAILY")).toBeInTheDocument();
  });
});
