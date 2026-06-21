import { describe, it, expect } from "vitest";
import { buildNarrativePrompt } from "./prompt.js";
import type { NarrativeSource } from "./source.js";

const src: NarrativeSource = {
  intent: "diff first-class",
  edits: [{ path: "/p/diff.ts", added: 10, removed: 2, patch: "@@\n+x" }],
  runs: ["ls", "npx vitest run"],
  verifications: ["npx vitest run"],
  decisions: [{ what: "Shiki", why: "temas", rejected: "highlight.js" }],
  reasoning: "queria distinguir adicionado de removido",
};

describe("buildNarrativePrompt", () => {
  it("inclui intent, diffs, verificações, raciocínio e o contrato JSON", () => {
    const p = buildNarrativePrompt(src, "pt-BR");
    expect(p).toContain("diff first-class");
    expect(p).toContain("/p/diff.ts");
    expect(p).toContain("npx vitest run");
    expect(p).toContain("queria distinguir");
    expect(p).toContain('"tldr"');
    expect(p).toContain('"prReview"');
    expect(p.toLowerCase()).toContain("json");
  });

  it("instrui o idioma de saída", () => {
    expect(buildNarrativePrompt(src, "pt-BR")).toMatch(/português|pt-BR/i);
    expect(buildNarrativePrompt(src, "en")).toMatch(/english|en\b/i);
  });

  it("rotula a conversa (usuário+assistente) e instrui cobertura de todas as frentes", () => {
    const p = buildNarrativePrompt(src, "pt-BR");
    expect(p.toLowerCase()).toContain("conversa");
    expect(p).toMatch(/todas as frentes|todos os steps/i);
  });
});
