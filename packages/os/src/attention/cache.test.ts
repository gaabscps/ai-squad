import { describe, it, expect, afterEach } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { readDiagnosis, writeDiagnosis } from "./cache.js";

const ROOT = join(process.cwd(), ".aios-cache-test-attention");
afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("cache do diagnóstico", () => {
  it("grava e lê de volta, chaveado por projectId/specId", () => {
    const rec = writeDiagnosis(ROOT, "proj-abc", "FEAT-001", { text: "porque X", fingerprint: "fp1", costUsd: 0.01 }, () => "2026-06-01T00:00:00Z");
    expect(rec.generatedAt).toBe("2026-06-01T00:00:00Z");
    const got = readDiagnosis(ROOT, "proj-abc", "FEAT-001");
    expect(got?.text).toBe("porque X");
    expect(got?.fingerprint).toBe("fp1");
  });

  it("readDiagnosis devolve null quando não existe", () => {
    expect(readDiagnosis(ROOT, "nada", "FEAT-999")).toBeNull();
  });
});
