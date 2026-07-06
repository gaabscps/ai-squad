import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CopyJiraPanel } from "./CopyJiraPanel";

describe("CopyJiraPanel", () => {
  it("mostra o corpo e copia a descrição pro clipboard ao clicar", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const body = "## Decisões\n- **x**";
    render(<CopyJiraPanel summaryLine="Resumo da sessão" body={body} />);

    expect(screen.getByText("Resumo da sessão")).toBeTruthy();
    expect(screen.getByText(/## Decisões/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /copiar descrição/i }));
    expect(writeText).toHaveBeenCalledWith(body);
    expect(await screen.findByRole("button", { name: /copiado/i })).toBeTruthy();
  });

  it("copia o resumo (título do issue) ao clicar no botão de resumo", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<CopyJiraPanel summaryLine="Resumo da sessão" body="x" />);

    fireEvent.click(screen.getByRole("button", { name: /copiar resumo/i }));
    expect(writeText).toHaveBeenCalledWith("Resumo da sessão");
    expect(await screen.findByRole("button", { name: /copiado/i })).toBeTruthy();
  });
});
