import { describe, it, expect } from "vitest";
import { computeSpecFingerprint } from "./fingerprint.js";

describe("computeSpecFingerprint", () => {
  it("é estável: mesmo conteúdo → mesmo hash", () => {
    const content = "## Problem\nFalta prosa.\n## Goal\nGerar resumo.";
    expect(computeSpecFingerprint(content)).toBe(computeSpecFingerprint(content));
  });

  it("muda quando o conteúdo muda", () => {
    const a = "## Problem\nFalta prosa.";
    const b = "## Problem\nOutra coisa.";
    expect(computeSpecFingerprint(a)).not.toBe(computeSpecFingerprint(b));
  });

  it("retorna string hex não-vazia", () => {
    expect(computeSpecFingerprint("qualquer coisa")).toMatch(/^[0-9a-f]+$/);
  });

  it("string vazia produz hash determinístico (sem lançar)", () => {
    const h = computeSpecFingerprint("");
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(computeSpecFingerprint("")).toBe(h);
  });
});
