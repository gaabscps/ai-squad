import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readCostRollup } from "../src/collector/cost.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixt = (name: string) => join(here, "fixtures", name);

describe("readCostRollup", () => {
  it("soma total_cost_usd e tokens de todos os costs/*.json", () => {
    const c = readCostRollup(fixt("spec-com-custo"));
    expect(c.totalCostUsd).toBeCloseTo(0.5, 6); // 0.3 + 0.2
    expect(c.tokens.input).toBe(110); // 100 + 10
    expect(c.tokens.output).toBe(55); // 50 + 5
    expect(c.tokens.cacheRead).toBe(1000);
    expect(c.tokens.cacheCreation).toBe(200);
    expect(c.totalTokens).toBe(110 + 55 + 1000 + 200);
    expect(c.partial).toBe(false);
  });

  it("retorna totalCostUsd null quando não há pasta costs/", () => {
    const c = readCostRollup(fixt("spec-sem-custo"));
    expect(c.totalCostUsd).toBeNull();
    expect(c.totalTokens).toBe(0);
  });
});
