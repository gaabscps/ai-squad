import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectFilter } from "./ProjectFilter";
import { makeProject } from "../test-utils";

function setup(over = {}) {
  const props = {
    projects: [makeProject({ id: "p1", name: "proj-a" }), makeProject({ id: "p2", name: "proj-b", hidden: true })],
    filter: null as string | null, onFilter: vi.fn(),
    showHidden: false, onShowHidden: vi.fn(), onHide: vi.fn(), ...over,
  };
  render(<ProjectFilter {...props} />);
  return props;
}

describe("ProjectFilter", () => {
  it("mostra 'todos' + os projetos visíveis (esconde hidden por padrão)", () => {
    setup();
    expect(screen.getByRole("button", { name: "todos" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "proj-a" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "proj-b" })).toBeNull();
  });
  it("clicar num projeto chama onFilter com o id", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "proj-a" }));
    expect(props.onFilter).toHaveBeenCalledWith("p1");
  });
  it("ocultar manda o id estável", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: /ocultar proj-a/i }));
    expect(props.onHide).toHaveBeenCalledWith("p1", true);
  });
  it("com 'mostrar ocultos' ligado, hidden aparece com ação de mostrar", async () => {
    const props = setup({ showHidden: true });
    expect(screen.getByRole("button", { name: "proj-b" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /mostrar proj-b/i }));
    expect(props.onHide).toHaveBeenCalledWith("p2", false);
  });
  it("o checkbox 'mostrar ocultos' chama onShowHidden", async () => {
    const props = setup();
    await userEvent.click(screen.getByLabelText(/mostrar ocultos/i));
    expect(props.onShowHidden).toHaveBeenCalledWith(true);
  });
});
