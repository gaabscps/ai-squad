import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCostRollup } from "./cost.js";

const dirs: string[] = [];
function specDir(): string {
  const d = mkdtempSync(join(tmpdir(), "aios-cost-"));
  dirs.push(d);
  return d;
}
function writeReport(dir: string, obj: unknown) {
  writeFileSync(join(dir, "cost-report.json"), JSON.stringify(obj));
}
function writeRaw(dir: string, name: string, obj: unknown) {
  const costs = join(dir, "costs");
  mkdirSync(costs, { recursive: true });
  writeFileSync(join(costs, name), JSON.stringify(obj));
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readCostRollup — escolha de fonte", () => {
  it("sem nada ⇒ source 'empty'", () => {
    const r = readCostRollup(specDir());
    expect(r.source).toBe("empty");
    expect(r.totalCostUsd).toBeNull();
  });

  it("só costs/*.json ⇒ source 'preliminary' com soma crua", () => {
    const d = specDir();
    writeRaw(d, "agent-1.json", {
      total_cost_usd: 0.4,
      by_model: { m: { input_tokens: 10, output_tokens: 5 } },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("preliminary");
    expect(r.totalCostUsd).toBe(0.4);
    expect(r.totalTokens).toBe(15);
    expect(r.byPhase).toBeNull();
  });

  it("cost-report.json presente ⇒ source 'authoritative' e custo/fases do report", () => {
    const d = specDir();
    writeReport(d, {
      planning_cost_usd: 5,
      orchestration_cost_usd: 1,
      implementation_cost_usd: 2,
      total_cost_usd: 8,
      unpriced_models: [],
      tokens: { by_type: { input: 1, output: 2, cache_read: 3, cache_creation: 4 }, total: 10 },
    });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalCostUsd).toBe(8);
    expect(r.byPhase).toEqual({ planning: 5, orchestration: 1, implementation: 2 });
    expect(r.totalTokens).toBe(10);
  });

  it("authoritative sem bloco tokens ⇒ tokens caem na soma crua (D2)", () => {
    const d = specDir();
    writeReport(d, { total_cost_usd: 8, unpriced_models: [], complete: true });
    writeRaw(d, "agent-1.json", { by_model: { m: { input_tokens: 7, output_tokens: 3 } } });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalCostUsd).toBe(8);
    expect(r.totalTokens).toBe(10); // veio do costs/*.json, não do report
  });

  it("authoritative com by_type mas SEM total ⇒ tokens caem na soma crua (I1)", () => {
    const d = specDir();
    writeReport(d, {
      total_cost_usd: 8,
      unpriced_models: [],
      tokens: { by_type: { input: 1, output: 2, cache_read: 3, cache_creation: 4 } }, // sem `total`
    });
    writeRaw(d, "agent-1.json", { by_model: { m: { input_tokens: 7, output_tokens: 3 } } });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalTokens).toBe(10); // total ausente no report ⇒ soma crua, breakdown coerente
    expect(r.tokens).toEqual({ input: 7, output: 3, cacheRead: 0, cacheCreation: 0 });
  });

  it("authoritative sem bloco tokens e sem costs/ ⇒ totalTokens 0 (soma crua vazia)", () => {
    const d = specDir();
    writeReport(d, { total_cost_usd: 8, unpriced_models: [] });
    const r = readCostRollup(d);
    expect(r.source).toBe("authoritative");
    expect(r.totalCostUsd).toBe(8);
    expect(r.totalTokens).toBe(0);
    expect(r.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  });

  it("authoritative com unpriced_models ⇒ partial true", () => {
    const d = specDir();
    writeReport(d, { total_cost_usd: 8, unpriced_models: ["some-model"] });
    expect(readCostRollup(d).partial).toBe(true);
  });

  it("preliminary com unpriced_models no costs/*.json ⇒ partial true", () => {
    const d = specDir();
    writeRaw(d, "agent-1.json", { total_cost_usd: 0.4, unpriced_models: ["x"], by_model: {} });
    const r = readCostRollup(d);
    expect(r.source).toBe("preliminary");
    expect(r.partial).toBe(true);
  });
});
