import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSpecSummary, writeSpecSummary } from "./cache.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-spec-cache-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("cache de spec-summary", () => {
  it("retorna null quando não há cache", () => {
    expect(readSpecSummary(tmp(), "proj-1", "FEAT-001")).toBeNull();
  });

  it("round-trip: o que grava, lê de volta", () => {
    const root = tmp();
    const written = writeSpecSummary(
      root, "proj-1", "FEAT-001",
      { text: "resumo da feature", fingerprint: "abc123", costUsd: 0.02, modelId: "claude-haiku-4-5-20251001" },
      () => "2026-06-04T10:00:00Z",
    );
    expect(written).toEqual({
      text: "resumo da feature",
      fingerprint: "abc123",
      costUsd: 0.02,
      modelId: "claude-haiku-4-5-20251001",
      generatedAt: "2026-06-04T10:00:00Z",
    });
    expect(readSpecSummary(root, "proj-1", "FEAT-001")).toEqual(written);
  });

  it("isola por projectId e specId", () => {
    const root = tmp();
    writeSpecSummary(root, "proj-1", "FEAT-001", { text: "a", fingerprint: "x", costUsd: null, modelId: null }, () => "t");
    expect(readSpecSummary(root, "proj-1", "FEAT-002")).toBeNull();
    expect(readSpecSummary(root, "proj-2", "FEAT-001")).toBeNull();
  });

  it("aceita costUsd e modelId nulos", () => {
    const root = tmp();
    const w = writeSpecSummary(root, "p", "F", { text: "x", fingerprint: "y", costUsd: null, modelId: null }, () => "t");
    expect(w.costUsd).toBeNull();
    expect(w.modelId).toBeNull();
    const r = readSpecSummary(root, "p", "F");
    expect(r?.costUsd).toBeNull();
    expect(r?.modelId).toBeNull();
  });

  it("readSpecSummary não lança em JSON corrompido (retorna null)", () => {
    const root = tmp();
    const dir = join(root, "spec-summaries", "proj-1", "FEAT-001");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "summary.json"), "{corrompido");
    expect(readSpecSummary(root, "proj-1", "FEAT-001")).toBeNull();
  });

  it("readSpecSummary retorna null em arquivo sem campo text (estrutura inválida)", () => {
    const root = tmp();
    const dir = join(root, "spec-summaries", "proj-1", "FEAT-002");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "summary.json"), JSON.stringify({ fingerprint: "abc" }));
    expect(readSpecSummary(root, "proj-1", "FEAT-002")).toBeNull();
  });
});
