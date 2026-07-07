import { describe, it, expect } from "vitest";
import { computeOverview, WINDOWS } from "./overview";
import { spec, project } from "./overview.testutil";

const NOW = Date.parse("2026-07-07T12:00:00Z");

describe("computeOverview — featureRows + dailyLine", () => {
  it("featureRows lista features com atividade na janela", () => {
    const s = spec({ id: "A", closedAt: "2026-07-06T00:00:00Z", featureId: "F1", featureName: "Export" });
    const d = computeOverview([project("p", [s])], WINDOWS["7d"], NOW);
    const row = d.featureRows.find((r) => r.featureId === "F1");
    expect(row?.name).toBe("Export");
    expect(row?.projectName).toBe("p");
  });

  it("dailyLine menciona entrega e atenção quando existem", () => {
    const done = spec({ id: "A", status: "done", closedAt: "2026-07-06T00:00:00Z", featureId: "F1", featureName: "Export", costUsd: 5 });
    const attn = spec({ id: "B", status: "needs_attention", featureId: "F2", featureName: "Login" });
    const d = computeOverview([project("p", [done, attn])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toContain("fechou");
    expect(d.dailyLine).toContain("esperam você");
  });

  it("dailyLine honesta quando nada aconteceu na janela e nada trava", () => {
    const old = spec({ id: "A", status: "done", closedAt: "2026-01-01T00:00:00Z" });
    const d = computeOverview([project("p", [old])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toBe("Nada fechou nem travou nesta janela.");
  });
});
