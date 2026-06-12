import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TopBar } from "./TopBar";

function setup(over: Record<string, unknown> = {}) {
  const props = {
    connected: true,
    query: "",
    onQuery: vi.fn(),
    view: "kanban" as const,
    onView: vi.fn(),
    onOpenFolderManager: vi.fn(),
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

  describe("botão Pastas (AC-001)", () => {
    it("renderiza o botão Pastas na TopBar", () => {
      setup();
      expect(screen.getByRole("button", { name: /pastas/i })).toBeInTheDocument();
    });

    it("clicar no botão Pastas chama onOpenFolderManager", async () => {
      const props = setup();
      await userEvent.click(screen.getByRole("button", { name: /pastas/i }));
      expect(props.onOpenFolderManager).toHaveBeenCalledTimes(1);
    });

    it("botão Pastas NÃO chama onOpenFolderManager se a prop não for fornecida", async () => {
      const fallback = vi.fn();
      setup({ onOpenFolderManager: undefined });
      const btn = screen.getByRole("button", { name: /pastas/i });
      await userEvent.click(btn);
      expect(fallback).not.toHaveBeenCalled();
    });
  });
});
