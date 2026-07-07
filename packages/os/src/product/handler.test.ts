import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProductHandler } from "./handler.js";
import { writeProductSummary } from "./cache.js";
import type { Store } from "../store/store.js";
import type { ObservedMeta, Spec } from "../store/types.js";

const SUMMARY = { tldr: "t", decided: [{ what: "x", why: null, rejected: null }], open: [], next: [], deliverable: "d" };
function observed(): ObservedMeta {
  return { intent: "x", createdAt: "a", closedAt: "b", attentionKind: null, decisions: [], evidence: [], driftFlags: [], baseSha: null, outputLocale: "pt-BR", workType: "product", feature: null, report: null, markers: [] };
}
function fakeStore(projectPath: string, spec: Spec): Store {
  return { getSnapshot: () => [{ id: "p", name: "proj", path: projectPath, specs: [spec] }] } as unknown as Store;
}
function writeSealed(projectPath: string, sealedAt: string) {
  writeFileSync(join(projectPath, ".agent-session", "OBS-1", "product-summary.json"),
    JSON.stringify({ schemaVersion: 1, kind: "product", sealedAt, outputLocale: "pt-BR", summary: { ...SUMMARY, tldr: "SELADO" } }));
}

let cacheRoot: string, projectPath: string;
beforeEach(() => {
  cacheRoot = mkdtempSync(join(tmpdir(), "ph-cache-"));
  projectPath = mkdtempSync(join(tmpdir(), "ph-proj-"));
  mkdirSync(join(projectPath, ".agent-session", "OBS-1"), { recursive: true });
});
afterEach(() => { rmSync(cacheRoot, { recursive: true, force: true }); rmSync(projectPath, { recursive: true, force: true }); });

function fetchOnce(spec: Spec): Record<string, unknown> | undefined {
  const handler = makeProductHandler(fakeStore(projectPath, spec), { cacheRoot });
  const sent: string[] = [];
  handler({ type: "product:fetch", projectId: "p", specId: "OBS-1" }, (d) => sent.push(d));
  return sent[0] ? JSON.parse(sent[0]) : undefined;
}

describe("product:fetch precedência selado vs cache", () => {
  const spec = { id: "OBS-1", status: "done", observed: observed() } as unknown as Spec;

  it("só cache → source generated", () => {
    writeProductSummary(cacheRoot, "p", "OBS-1", { summary: SUMMARY, fingerprint: "f", costUsd: 0.02 }, () => "2026-06-20T00:00:00Z");
    const m = fetchOnce(spec);
    expect(m?.source).toBe("generated");
    expect((m?.summary as { tldr: string }).tldr).toBe("t");
  });

  it("selado mais novo que o cache → source sealed", () => {
    writeProductSummary(cacheRoot, "p", "OBS-1", { summary: SUMMARY, fingerprint: "f", costUsd: 0.02 }, () => "2026-06-20T00:00:00Z");
    writeSealed(projectPath, "2026-06-22T00:00:00Z");
    const m = fetchOnce(spec);
    expect(m?.source).toBe("sealed");
    expect((m?.summary as { tldr: string }).tldr).toBe("SELADO");
    expect(m?.stale).toBe(false);
    expect(m?.costUsd).toBeNull();
  });

  it("cache mais novo que o selado → source generated", () => {
    writeProductSummary(cacheRoot, "p", "OBS-1", { summary: SUMMARY, fingerprint: "f", costUsd: 0.02 }, () => "2026-06-22T00:00:00Z");
    writeSealed(projectPath, "2026-06-20T00:00:00Z");
    const m = fetchOnce(spec);
    expect(m?.source).toBe("generated");
  });

  it("só selado (sem cache) → source sealed", () => {
    writeSealed(projectPath, "2026-06-22T00:00:00Z");
    const m = fetchOnce(spec);
    expect(m?.source).toBe("sealed");
  });

  it("selado corrompido → fail-open pro cache", () => {
    writeProductSummary(cacheRoot, "p", "OBS-1", { summary: SUMMARY, fingerprint: "f", costUsd: 0.02 }, () => "2026-06-20T00:00:00Z");
    writeFileSync(join(projectPath, ".agent-session", "OBS-1", "product-summary.json"), "{ corrompido");
    const m = fetchOnce(spec);
    expect(m?.source).toBe("generated");
  });

  it("nem selado nem cache → não envia nada", () => {
    expect(fetchOnce(spec)).toBeUndefined();
  });
});
