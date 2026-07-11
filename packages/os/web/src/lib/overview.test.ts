import { describe, it, expect } from "vitest";
import { computeOverview, WINDOWS } from "./overview";
import { spec, project } from "./overview.testutil";

const NOW = Date.parse("2026-07-07T12:00:00Z");

describe("computeOverview — janela + atenção + entrega + gasto", () => {
  it("atenção ignora a janela (dívida do agora)", () => {
    const old = spec({ id: "OBS-OLD", status: "needs_attention", createdAt: "2026-06-01T00:00:00Z", lastActivityAt: "2026-06-01T00:00:00Z" });
    const d = computeOverview([project("p", [old])], WINDOWS["7d"], NOW);
    expect(d.attention.count).toBe(1);
    expect(d.attention.items[0].sessionId).toBe("OBS-OLD");
    expect(d.attention.items[0].whyLabel).toBe("aguardando sua resposta");
  });

  it("entrega conta só sessões fechadas DENTRO da janela", () => {
    const inWin = spec({ id: "OBS-IN", status: "done", closedAt: "2026-07-06T12:00:00Z" });
    const outWin = spec({ id: "OBS-OUT", status: "done", closedAt: "2026-06-01T12:00:00Z" });
    const d = computeOverview([project("p", [inWin, outWin])], WINDOWS["7d"], NOW);
    expect(d.delivery.sessionsClosed).toBe(1);
  });

  it("gasto soma custo das sessões na janela, honesto sobre incompleto", () => {
    const a = spec({ id: "A", closedAt: "2026-07-06T00:00:00Z", costUsd: 10 });
    const b = spec({ id: "B", closedAt: "2026-07-06T00:00:00Z", costUsd: null, costSource: "partial" });
    const d = computeOverview([project("p", [a, b])], WINDOWS["7d"], NOW);
    expect(d.spend.totalUsd).toBe(10);
    expect(d.spend.incomplete).toBe(true);
    expect(d.spend.byProject).toEqual([{ projectName: "p", costUsd: 10 }]);
  });

  it("gasto null (nenhuma sessão com custo) nunca vira 0", () => {
    const a = spec({ id: "A", closedAt: "2026-07-06T00:00:00Z", costUsd: null, costSource: "empty" });
    const d = computeOverview([project("p", [a])], WINDOWS["7d"], NOW);
    expect(d.spend.totalUsd).toBeNull();
  });

  it("feature aguardando_deploy aparece em delivery.items mas NÃO conta em featuresDelivered", () => {
    const s = spec({ id: "OBS-001", status: "done", closedAt: "2026-07-06T12:00:00Z", featureId: "PAY-1", featureName: "Export" });
    const d = computeOverview(
      [project("p", [s], { deliveryState: { "p-hash/PAY-1": "awaiting_deploy" } })],
      WINDOWS["7d"], NOW,
    );
    expect(d.delivery.featuresDelivered).toBe(0);
    const item = d.delivery.items.find((i) => i.featureId === "PAY-1");
    expect(item?.status).toBe("awaiting_deploy");
  });
});
