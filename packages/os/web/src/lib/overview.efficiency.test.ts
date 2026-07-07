import { describe, it, expect } from "vitest";
import { computeOverview, WINDOWS, percentile } from "./overview";
import { spec, project } from "./overview.testutil";

const NOW = Date.parse("2026-07-07T12:00:00Z");

describe("percentile", () => {
  it("interpola/aproxima P50 e P95", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBeCloseTo(2.5, 1);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("computeOverview — eficiência", () => {
  it("média só sobre sessões com custo conhecido; expõe sessionsWithCost", () => {
    const a = spec({ id: "A", closedAt: "2026-07-06T00:00:00Z", costUsd: 4 });
    const b = spec({ id: "B", closedAt: "2026-07-06T00:00:00Z", costUsd: 8 });
    const c = spec({ id: "C", closedAt: "2026-07-06T00:00:00Z", costUsd: null, costSource: "empty" });
    const d = computeOverview([project("p", [a, b, c])], WINDOWS["7d"], NOW);
    expect(d.efficiency.avgCostPerSession).toBe(6);
    expect(d.efficiency.sessionsWithCost).toBe(2);
  });

  it("trend null quando a janela anterior não tem custo", () => {
    const a = spec({ id: "A", closedAt: "2026-07-06T00:00:00Z", costUsd: 4 });
    const d = computeOverview([project("p", [a])], WINDOWS["7d"], NOW);
    expect(d.efficiency.trendPct).toBeNull();
  });

  it("trend calcula queda vs janela anterior de mesmo tamanho", () => {
    const prev = spec({ id: "PREV", closedAt: "2026-06-28T00:00:00Z", costUsd: 10 }); // 9 dias atrás → janela anterior de 7d
    const cur = spec({ id: "CUR", closedAt: "2026-07-06T00:00:00Z", costUsd: 5 });
    const d = computeOverview([project("p", [prev, cur])], WINDOWS["7d"], NOW);
    expect(d.efficiency.trendPct).toBeCloseTo(-0.5, 2);
  });

  it("spark bucketiza custo por dia dentro da janela", () => {
    const a = spec({ id: "A", closedAt: "2026-07-06T10:00:00Z", costUsd: 3 });
    const b = spec({ id: "B", closedAt: "2026-07-06T20:00:00Z", costUsd: 2 });
    const c = spec({ id: "C", closedAt: "2026-07-04T10:00:00Z", costUsd: 7 });
    const d = computeOverview([project("p", [a, b, c])], WINDOWS["7d"], NOW);
    const jul6 = d.efficiency.spark.find((p) => p.at.startsWith("2026-07-06"));
    expect(jul6?.costUsd).toBe(5); // 3+2 no mesmo dia
  });
});
