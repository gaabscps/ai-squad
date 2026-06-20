import { describe, it, expect } from "vitest";
import { parseNarrative } from "./parse.js";

const good = {
  tldr: "Fiz X.",
  why: "Porque Y.",
  changes: [{ title: "A", prose: "p", files: ["a.ts"], primaryFile: "a.ts" }],
  decisions: [{ what: "d", why: "w", tradeoff: null }],
  verifications: [{ cmd: "vitest", passed: true }],
  prReview: { groups: [{ label: "Núcleo", files: ["a.ts"], lookFirst: true }], risk: "r" },
};

describe("parseNarrative", () => {
  it("parseia JSON puro", () => {
    const n = parseNarrative(JSON.stringify(good));
    expect(n?.tldr).toBe("Fiz X.");
    expect(n?.changes[0].primaryFile).toBe("a.ts");
  });

  it("parseia JSON dentro de cerca ```json", () => {
    const n = parseNarrative("```json\n" + JSON.stringify(good) + "\n```");
    expect(n?.why).toBe("Porque Y.");
  });

  it("preenche arrays ausentes e devolve objeto seguro", () => {
    const n = parseNarrative(JSON.stringify({ tldr: "só isso", why: "" }));
    expect(n?.changes).toEqual([]);
    expect(n?.prReview.groups).toEqual([]);
  });

  it("devolve null para texto sem JSON", () => {
    expect(parseNarrative("desculpa, não consegui")).toBeNull();
  });
});
