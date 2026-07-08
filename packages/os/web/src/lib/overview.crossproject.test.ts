import { describe, it, expect } from "vitest";
import { computeOverview, WINDOWS } from "./overview";
import { spec, project } from "./overview.testutil";

const NOW = Date.parse("2026-07-07T12:00:00Z");

// Ids de sessão (OBS-NNN) reiniciam em cada projeto — "OBS-001" existe em vários.
// A janela/agrupamento devem chavear por projeto+sessão, senão a atividade de um
// projeto vaza para features homônimas de outros.
describe("computeOverview — isolamento entre projetos (ids de sessão colidentes)", () => {
  it("sessão OBS-001 do projeto A na janela não arrasta a feature OBS-001 do projeto B", () => {
    const a = project("proj-a", [
      spec({ id: "OBS-001", featureId: "FA", featureName: "Feature A", status: "done", closedAt: "2026-07-06T00:00:00Z" }),
    ]);
    const b = project("proj-b", [
      // mesmo id de sessão, mas fechada há mais de 2 meses → FORA da janela de 7d
      spec({ id: "OBS-001", featureId: "FB", featureName: "Feature B", status: "done", closedAt: "2026-05-01T00:00:00Z" }),
    ]);
    const d = computeOverview([a, b], WINDOWS["7d"], NOW);
    expect(d.featureRows.map((r) => r.featureId)).toEqual(["FA"]);
    expect(d.delivery.featuresTouched).toBe(1);
    expect(d.delivery.sessionsClosed).toBe(1);
  });

  it("featuresTouched e featureRows contam o mesmo conjunto (coerência placar × lista)", () => {
    const a = project("proj-a", [
      spec({ id: "OBS-001", featureId: "FA", featureName: "A", status: "done", closedAt: "2026-07-06T00:00:00Z" }),
    ]);
    const b = project("proj-b", [
      spec({ id: "OBS-001", featureId: "FB", featureName: "B", status: "running", closedAt: null, createdAt: "2026-07-06T00:00:00Z" }),
    ]);
    const d = computeOverview([a, b], WINDOWS["7d"], NOW);
    // ambas as sessões estão na janela (uma por projeto) → 2 features tocadas, 2 linhas
    expect(d.delivery.featuresTouched).toBe(2);
    expect(d.featureRows).toHaveLength(2);
  });
});
