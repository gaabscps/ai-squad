import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "./TopBar";

function setup(over = {}) {
  const props = {
    connected: true,
    query: "",
    onQuery: vi.fn(),
    view: "kanban" as const,
    onView: vi.fn(),
    ...over,
  };
  render(<TopBar {...props} />);
  return props;
}

describe("TopBar", () => {
  it("mostra 'ao vivo' quando conectado e 'reconectando' quando não", () => {
    setup({ connected: true });
    expect(screen.getByText(/ao vivo/i)).toBeInTheDocument();
  });

  it("digitar na busca chama onQuery", async () => {
    const props = setup();
    await userEvent.type(screen.getByPlaceholderText(/buscar/i), "pdf");
    expect(props.onQuery).toHaveBeenCalled();
  });

  it("clicar em Tabela chama onView com 'table'", async () => {
    const props = setup({ view: "kanban" });
    await userEvent.click(screen.getByRole("button", { name: /tabela/i }));
    expect(props.onView).toHaveBeenCalledWith("table");
  });

  it("clicar em Arquivadas chama onView('archived')", async () => {
    const props = setup({ view: "kanban" });
    await userEvent.click(screen.getByRole("button", { name: /arquivadas/i }));
    expect(props.onView).toHaveBeenCalledWith("archived");
  });
});
