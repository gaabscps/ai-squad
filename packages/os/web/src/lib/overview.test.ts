import { describe, it, expect } from "vitest";
import { computeOverview, WINDOWS } from "./overview";
import type { Project, Spec } from "../../../src/store/types";

const NOW = Date.parse("2026-07-07T12:00:00Z");
const H = 3600_000, D = 24 * H;

function spec(over: Partial<Spec> & {
  id?: string; createdAt?: string; closedAt?: string | null;
  status?: Spec["status"]; costUsd?: number | null; costSource?: string;
  featureId?: string; featureName?: string;
}): Spec {
  const { createdAt = "2026-07-07T00:00:00Z", closedAt = null, costUsd = 1, costSource = "cost_report",
          featureId = "F1", featureName = "Feature 1", ...rest } = over;
  return {
    id: over.id ?? "OBS-001", squad: "sdd", title: over.title ?? "titulo", phase: "", plannedPhases: [],
    status: over.status ?? "running", tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: over.lastActivityAt ?? closedAt ?? createdAt, timeline: [],
    cost: {
      totalCostUsd: costUsd, partial: false,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      totalTokens: 0, reportPath: null, source: costSource as never, scopingSuspect: false,
      excludedSubagents: null, recoveredSubagents: null, byPhase: null, complete: null,
    },
    deliveryReport: null, specPath: null,
    observed: {
      intent: "i", createdAt, closedAt, attentionKind: over.status === "needs_attention" ? "input" : null,
      decisions: [], evidence: [], driftFlags: [], baseSha: null, outputLocale: null, workType: null,
      markers: [], report: null,
      feature: { id: featureId, key: null, name: featureName, jira: null },
    },
    ...rest,
  } as Spec;
}

function project(name: string, specs: Spec[]): Project {
  // features não são lidas por computeOverview nesta task (usa flattenSpecs); [] basta
  return { id: `${name}-hash`, path: `/${name}`, name, specs, hidden: false, features: [] };
}

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
});
