import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSealedProductSummary } from "./sealed.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sealed-")); mkdirSync(join(dir, "OBS-1"), { recursive: true }); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const ENVELOPE = {
  schemaVersion: 1, kind: "product", sealedAt: "2026-06-22T03:40:00Z", outputLocale: "pt-BR",
  summary: { tldr: "t", decided: [{ what: "x", why: null, rejected: null }], open: [], next: [], deliverable: "d" },
};

describe("readSealedProductSummary", () => {
  it("lê e normaliza um envelope válido", () => {
    writeFileSync(join(dir, "OBS-1", "product-summary.json"), JSON.stringify(ENVELOPE));
    const r = readSealedProductSummary(join(dir, "OBS-1"));
    expect(r?.summary.tldr).toBe("t");
    expect(r?.sealedAt).toBe("2026-06-22T03:40:00Z");
    expect(r?.outputLocale).toBe("pt-BR");
  });
  it("retorna null quando o arquivo não existe", () => {
    expect(readSealedProductSummary(join(dir, "OBS-1"))).toBeNull();
  });
  it("retorna null em JSON corrompido", () => {
    writeFileSync(join(dir, "OBS-1", "product-summary.json"), "{ nope");
    expect(readSealedProductSummary(join(dir, "OBS-1"))).toBeNull();
  });
  it("retorna null quando falta summary ou sealedAt", () => {
    writeFileSync(join(dir, "OBS-1", "product-summary.json"), JSON.stringify({ summary: ENVELOPE.summary }));
    expect(readSealedProductSummary(join(dir, "OBS-1"))).toBeNull();
  });
  it("normaliza summary parcial (descarta decisão sem what)", () => {
    writeFileSync(join(dir, "OBS-1", "product-summary.json"), JSON.stringify({ sealedAt: "T", summary: { tldr: "t", decided: [{ why: "y" }] } }));
    const r = readSealedProductSummary(join(dir, "OBS-1"));
    expect(r?.summary.decided).toEqual([]);
  });
});
