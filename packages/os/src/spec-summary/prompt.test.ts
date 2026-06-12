import { describe, it, expect } from "vitest";
import { buildSpecSummaryPrompt } from "./prompt.js";

describe("buildSpecSummaryPrompt", () => {
  it("contém instrução de tom em pt-BR com foco em Problem e Goal", () => {
    const p = buildSpecSummaryPrompt("## Problem\nFalta resumo.\n## Goal\nMostrar prosa.");
    expect(p).toMatch(/pt-BR|português/i);
    expect(p).toMatch(/problema|problem/i);
    expect(p).toMatch(/objetivo|goal/i);
  });

  it("inclui o conteúdo do spec.md no prompt", () => {
    const content = "## Problem\nO drawer não tem prosa.\n## Goal\nGerar resumo.";
    const p = buildSpecSummaryPrompt(content);
    expect(p).toContain("O drawer não tem prosa.");
    expect(p).toContain("Gerar resumo.");
  });

  it("não quebra com conteúdo vazio", () => {
    expect(() => buildSpecSummaryPrompt("")).not.toThrow();
    expect(buildSpecSummaryPrompt("")).toBeTypeOf("string");
  });

  it("instrui a produzir resumo em 1 a 3 parágrafos (não inventa)", () => {
    const p = buildSpecSummaryPrompt("spec content");
    expect(p).toMatch(/parágraf/i);
    expect(p).toMatch(/não invente|só com base|resumo/i);
  });
});
