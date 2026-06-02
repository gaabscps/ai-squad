import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSummary, writeSummary } from "./cache.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-cache-"));
  dirs.push(d);
  return d;
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("cache de resumo", () => {
  it("retorna null quando não há cache", () => {
    expect(readSummary(tmp(), "proj-1", "FEAT-001", "T-001")).toBeNull();
  });

  it("round-trip: o que grava, lê de volta", () => {
    const root = tmp();
    const written = writeSummary(root, "proj-1", "FEAT-001", "T-001", { text: "resumo", fingerprint: "abc", costUsd: 0.04 }, () => "2026-06-01T10:00:00Z");
    expect(written).toEqual({ text: "resumo", fingerprint: "abc", costUsd: 0.04, generatedAt: "2026-06-01T10:00:00Z" });
    expect(readSummary(root, "proj-1", "FEAT-001", "T-001")).toEqual(written);
  });

  it("isola por projectId, specId e taskId", () => {
    const root = tmp();
    writeSummary(root, "proj-1", "FEAT-001", "T-001", { text: "a", fingerprint: "x", costUsd: null }, () => "t");
    expect(readSummary(root, "proj-1", "FEAT-001", "T-002")).toBeNull();
    expect(readSummary(root, "proj-1", "FEAT-002", "T-001")).toBeNull();
    // mesmo spec/task, projeto diferente → não colide (o bug que isso previne)
    expect(readSummary(root, "proj-2", "FEAT-001", "T-001")).toBeNull();
  });

  it("readSummary não lança em JSON corrompido (retorna null)", () => {
    const root = tmp();
    writeSummary(root, "proj-1", "F", "T", { text: "a", fingerprint: "x", costUsd: null }, () => "t");
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(root, "summaries", "proj-1", "F", "T.json"), "{corrompido");
    expect(readSummary(root, "proj-1", "F", "T")).toBeNull();
  });
});
