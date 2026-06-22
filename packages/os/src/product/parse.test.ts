import { describe, it, expect } from "vitest";
import { parseProductSummary, normalizeProductSummary } from "./parse.js";

describe("parseProductSummary", () => {
  it("extrai um resumo completo de JSON puro", () => {
    const raw = JSON.stringify({
      tldr: "Definiu o onboarding",
      decided: [{ what: "3 telas", why: "menos fricção", rejected: "tour guiado" }],
      open: ["validar com usuários"],
      next: ["prototipar no Figma"],
      deliverable: "Direção de onboarding",
    });
    const r = parseProductSummary(raw);
    expect(r).not.toBeNull();
    expect(r!.tldr).toBe("Definiu o onboarding");
    expect(r!.decided).toEqual([{ what: "3 telas", why: "menos fricção", rejected: "tour guiado" }]);
    expect(r!.open).toEqual(["validar com usuários"]);
    expect(r!.next).toEqual(["prototipar no Figma"]);
    expect(r!.deliverable).toBe("Direção de onboarding");
  });

  it("tolera cercas de código e texto ao redor", () => {
    const raw = "Claro!\n```json\n" + JSON.stringify({ tldr: "x", decided: [], open: [], next: [], deliverable: "y" }) + "\n```";
    const r = parseProductSummary(raw);
    expect(r).not.toBeNull();
    expect(r!.tldr).toBe("x");
  });

  it("retorna null quando não há JSON", () => {
    expect(parseProductSummary("nenhum json aqui")).toBeNull();
  });

  it("preserva listas vazias no caso de baixo sinal (não inventa)", () => {
    const raw = JSON.stringify({
      tldr: "Sessão exploratória",
      decided: [],
      open: ["o problema existe?"],
      next: [],
      deliverable: "Sessão exploratória — sem decisão/entregável fechado",
    });
    const r = parseProductSummary(raw)!;
    expect(r.decided).toEqual([]);
    expect(r.next).toEqual([]);
    expect(r.deliverable).toContain("exploratória");
  });

  it("descarta decisão sem 'what' e strings vazias em open/next", () => {
    const raw = JSON.stringify({
      tldr: "t",
      decided: [{ what: "", why: "x", rejected: null }, { what: "real", why: null, rejected: null }],
      open: ["", "  ", "válida"],
      next: [""],
      deliverable: "d",
    });
    const r = parseProductSummary(raw)!;
    expect(r.decided).toHaveLength(1);
    expect(r.decided[0].what).toBe("real");
    expect(r.open).toEqual(["válida"]);
    expect(r.next).toEqual([]);
  });

  it("campos ausentes viram defaults seguros", () => {
    const r = parseProductSummary("{}")!;
    expect(r.tldr).toBe("");
    expect(r.decided).toEqual([]);
    expect(r.open).toEqual([]);
    expect(r.next).toEqual([]);
    expect(r.deliverable).toBe("");
  });

  it("normalizeProductSummary aceita objeto já parseado e descarta decisão sem what", () => {
    const r = normalizeProductSummary({ tldr: "t", decided: [{ what: "", why: "y" }, { what: "ok" }], open: ["", "q"], next: [], deliverable: "d" });
    expect(r.tldr).toBe("t");
    expect(r.decided).toEqual([{ what: "ok", why: null, rejected: null }]);
    expect(r.open).toEqual(["q"]);
    expect(r.deliverable).toBe("d");
  });
});
