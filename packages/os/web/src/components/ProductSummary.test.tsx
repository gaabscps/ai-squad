import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductSummary } from "./ProductSummary";
import type { ProductClient, ProductServerMsg } from "../state/productClient";

function clientThatEmitsOnFetch(msg: ProductServerMsg): ProductClient {
  return {
    subscribe: (_k, fn) => { setTimeout(() => fn(msg), 0); return () => {}; },
    fetch: () => {}, generate: () => {},
  };
}

const SUMMARY = {
  tldr: "Definiu o onboarding enxuto",
  decided: [{ what: "3 telas", why: "menos fricção", rejected: "tour guiado" }],
  open: ["validar com usuários"],
  next: ["prototipar no Figma"],
  deliverable: "Direção de onboarding definida",
};

describe("ProductSummary", () => {
  it("mostra botão de gerar quando não há cache", () => {
    const client: ProductClient = { subscribe: () => () => {}, fetch: () => {}, generate: () => {} };
    render(<ProductSummary projectId="p" specId="OBS-1" client={client} />);
    expect(screen.getByRole("button", { name: /gerar resumo/i })).toBeTruthy();
  });

  it("renderiza decidido/aberto/próximo/entregável e o selo de inferência", async () => {
    const client = clientThatEmitsOnFetch({ type: "product:cached", projectId: "p", specId: "OBS-1", summary: SUMMARY, stale: false });
    const { container } = render(<ProductSummary projectId="p" specId="OBS-1" client={client} />);
    expect(await screen.findByText("Definiu o onboarding enxuto")).toBeTruthy();
    expect(screen.getByText("O que ficou decidido")).toBeTruthy();
    expect(screen.getByText(/3 telas/)).toBeTruthy();
    expect(screen.getByText("Em aberto")).toBeTruthy();
    expect(screen.getByText("Próximo passo")).toBeTruthy();
    expect(screen.getByText("Entregável")).toBeTruthy();
    expect(screen.getByText("Direção de onboarding definida")).toBeTruthy();
    expect(container.textContent).toContain("Inferido da conversa");
  });

  it("não vaza vocabulário de engenharia (sem seções dev)", async () => {
    const client = clientThatEmitsOnFetch({ type: "product:cached", projectId: "p", specId: "OBS-1", summary: SUMMARY, stale: false });
    const { container } = render(<ProductSummary projectId="p" specId="OBS-1" client={client} />);
    await screen.findByText("Definiu o onboarding enxuto");
    expect(container.textContent).not.toContain("Verificações");
    expect(container.textContent).not.toContain("revisar a PR");
  });
});
