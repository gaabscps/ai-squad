import { describe, it, expect } from "vitest";
import { buildProductPrompt } from "./prompt.js";
import type { NarrativeSource } from "../narrative/source.js";

const src: NarrativeSource = {
  intent: "explorar onboarding",
  edits: [],
  runs: [],
  verifications: [],
  decisions: [{ what: "3 telas", why: "fricção", rejected: "tour guiado" }],
  reasoning: "Usuário: como começo?\n\nAssistente: vamos pensar no fluxo.",
};

describe("buildProductPrompt", () => {
  it("usa persona de produto e o contrato decidido/aberto/próximo/entregável", () => {
    const p = buildProductPrompt(src, "pt-BR");
    expect(p).toContain("produto/design");
    expect(p).toContain('"decided"');
    expect(p).toContain('"open"');
    expect(p).toContain('"next"');
    expect(p).toContain('"deliverable"');
  });

  it("não usa o contrato de engenharia (sem prReview/verifications/changes)", () => {
    const p = buildProductPrompt(src, "pt-BR");
    expect(p).not.toContain("prReview");
    expect(p).not.toContain('"changes"');
    expect(p).not.toContain("tech lead");
  });

  it("instrui contra jargão de engenharia e contra invenção", () => {
    const p = buildProductPrompt(src, "pt-BR");
    expect(p).toMatch(/PR|diff|commit/); // citados para PROIBIR
    expect(p.toLowerCase()).toContain("não invente");
  });

  it("respeita o idioma (pt vs en)", () => {
    expect(buildProductPrompt(src, "pt-BR")).toContain("português");
    expect(buildProductPrompt(src, "en")).toContain("english");
  });

  it("inclui a intenção e a conversa como fonte", () => {
    const p = buildProductPrompt(src, "pt-BR");
    expect(p).toContain("explorar onboarding");
    expect(p).toContain("Usuário: como começo?");
  });
});
