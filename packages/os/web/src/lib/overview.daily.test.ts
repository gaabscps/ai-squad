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
    expect(d.dailyLine).toContain("espera você");
  });

  it("dailyLine honesta quando nada aconteceu na janela e nada trava", () => {
    const old = spec({ id: "A", status: "done", closedAt: "2026-01-01T00:00:00Z" });
    const d = computeOverview([project("p", [old])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toBe("Nada fechou nem travou nesta janela.");
  });

  it("dailyLine usa singular correto para 1 sessão fechada", () => {
    const done = spec({ id: "A", status: "done", closedAt: "2026-07-06T00:00:00Z", featureId: "F1", featureName: "Export", costUsd: 5 });
    const d = computeOverview([project("p", [done])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toContain("fechou 1 sessão");
  });

  it("dailyLine usa plural correto para 2+ sessões fechadas", () => {
    const done1 = spec({ id: "A", status: "done", closedAt: "2026-07-06T00:00:00Z", featureId: "F1", featureName: "Export", costUsd: 5 });
    const done2 = spec({ id: "B", status: "done", closedAt: "2026-07-06T12:00:00Z", featureId: "F2", featureName: "Login", costUsd: 3 });
    const d = computeOverview([project("p", [done1, done2])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toContain("fechou 2 sessões");
  });

  it("dailyLine com 1 sessão em atenção usa singular e verbo correto", () => {
    const attn = spec({ id: "A", status: "needs_attention", featureId: "F1", featureName: "Export" });
    const d = computeOverview([project("p", [attn])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toContain("1 sessão espera você");
  });

  it("dailyLine com 2+ sessões em atenção usa plural e verbo correto", () => {
    const attn1 = spec({ id: "A", status: "needs_attention", featureId: "F1", featureName: "Export" });
    const attn2 = spec({ id: "B", status: "needs_attention", featureId: "F2", featureName: "Login" });
    const d = computeOverview([project("p", [attn1, attn2])], WINDOWS["7d"], NOW);
    expect(d.dailyLine).toContain("2 sessões esperam você");
  });
});
