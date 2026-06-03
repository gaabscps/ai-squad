import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCostReport } from "./cost-report.js";

const dirs: string[] = [];
function specDirWith(content: string | null): string {
  const d = mkdtempSync(join(tmpdir(), "aios-costreport-"));
  dirs.push(d);
  if (content !== null) writeFileSync(join(d, "cost-report.json"), content);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FULL = JSON.stringify({
  planning_cost_usd: 6.5,
  orchestration_cost_usd: 1.0,
  implementation_cost_usd: 2.0,
  total_cost_usd: 9.5,
  subagent_count: 3,
  excluded_subagents: 66,
  recovered_subagents: 4,
  scoping_suspect: false,
  unpriced_models: [],
  complete: false,
  tokens: {
    by_type: { input: 100, output: 50, cache_read: 1000, cache_creation: 200 },
    total: 1350,
  },
});

describe("readCostReport — arquivo válido completo", () => {
  it("normaliza custo, fases, tokens e flags", () => {
    const r = readCostReport(specDirWith(FULL));
    expect(r).not.toBeNull();
    expect(r!.totalCostUsd).toBe(9.5);
    expect(r!.byPhase).toEqual({ planning: 6.5, orchestration: 1.0, implementation: 2.0 });
    expect(r!.tokens).toEqual({ input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 });
    expect(r!.totalTokens).toBe(1350);
    expect(r!.partial).toBe(false);
    expect(r!.scopingSuspect).toBe(false);
    expect(r!.excludedSubagents).toBe(66);
    expect(r!.recoveredSubagents).toBe(4);
    expect(r!.complete).toBe(false);
  });
});

describe("readCostReport — casos de borda", () => {
  it("ausente ⇒ null", () => {
    expect(readCostReport(specDirWith(null))).toBeNull();
  });

  it("JSON inválido ⇒ null (não inventa número)", () => {
    expect(readCostReport(specDirWith("{ não é json"))).toBeNull();
  });

  it("sem total_cost_usd numérico ⇒ null", () => {
    expect(readCostReport(specDirWith(JSON.stringify({ complete: true })))).toBeNull();
  });

  it("válido mínimo (shape FEAT-010, sem bloco tokens) ⇒ tokens null", () => {
    const min = JSON.stringify({
      planning_cost_usd: 0,
      orchestration_cost_usd: 0,
      implementation_cost_usd: 0,
      total_cost_usd: 0,
      unpriced_models: [],
      complete: true,
    });
    const r = readCostReport(specDirWith(min))!;
    expect(r).not.toBeNull();
    expect(r.totalCostUsd).toBe(0);
    expect(r.tokens).toBeNull();
    expect(r.totalTokens).toBeNull();
    expect(r.complete).toBe(true);
    expect(r.scopingSuspect).toBe(false);
    expect(r.excludedSubagents).toBeNull();
  });

  it("scoping_suspect=true ⇒ implementation vira null", () => {
    const susp = JSON.stringify({
      planning_cost_usd: 5,
      orchestration_cost_usd: 1,
      implementation_cost_usd: 99,
      total_cost_usd: 105,
      scoping_suspect: true,
      unpriced_models: [],
    });
    const r = readCostReport(specDirWith(susp))!;
    expect(r.scopingSuspect).toBe(true);
    expect(r.byPhase.implementation).toBeNull();
    expect(r.byPhase.planning).toBe(5);
  });
});
