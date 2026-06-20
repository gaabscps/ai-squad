import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNarrative, writeNarrative } from "./cache.js";
import type { SessionNarrative } from "./types.js";

const narrative: SessionNarrative = {
  tldr: "x", why: "y", changes: [], decisions: [], verifications: [],
  prReview: { groups: [], risk: null },
};

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "narr-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("cache de narrativa", () => {
  it("retorna null quando não existe", () => {
    expect(readNarrative(root, "p", "FEAT-1")).toBeNull();
  });
  it("grava e lê de volta com generatedAt carimbado", () => {
    const rec = writeNarrative(root, "p", "FEAT-1", { narrative, fingerprint: "fp", costUsd: 0.04 }, () => "2026-06-20T10:00:00Z");
    expect(rec.generatedAt).toBe("2026-06-20T10:00:00Z");
    const back = readNarrative(root, "p", "FEAT-1");
    expect(back?.narrative.tldr).toBe("x");
    expect(back?.fingerprint).toBe("fp");
    expect(back?.costUsd).toBe(0.04);
  });
});
