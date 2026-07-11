import { describe, it, expect } from "vitest";
import { buildFeatures, slugifyFeatureName } from "../src/collector/features.js";
import type { Spec, ObservedFeatureRef } from "../src/store/types.js";

const NOW = Date.parse("2026-07-06T12:00:00Z");

function obsSpec(over: Partial<Spec> & { feature?: ObservedFeatureRef | null; createdAt?: string; closedAt?: string | null }): Spec {
  const { feature = null, createdAt = "2026-07-06T00:00:00Z", closedAt = null, ...rest } = over;
  return {
    id: over.id ?? "OBS-001", squad: "sdd", title: "t", phase: "", plannedPhases: [],
    status: over.status ?? "running", tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: over.lastActivityAt ?? createdAt, timeline: [],
    cost: {
      totalCostUsd: 1, partial: false,
      tokens: { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 },
      totalTokens: 15, reportPath: null, source: "cost_report", scopingSuspect: false,
      excludedSubagents: null, recoveredSubagents: null, byPhase: null, complete: null,
    },
    deliveryReport: null, specPath: null,
    observed: {
      intent: "t", createdAt, closedAt, attentionKind: null, decisions: [], evidence: [],
      driftFlags: [], baseSha: null, outputLocale: null, workType: null, markers: [],
      report: null, feature,
    },
    ...rest,
  } as Spec;
}

const FEAT: ObservedFeatureRef = { id: "PAY-1", key: "PAY-1", name: "Export", jira: null };

describe("slugifyFeatureName", () => {
  it("remove acentos e vira kebab", () => {
    expect(slugifyFeatureName("Exportação de fatura")).toBe("ft-exportacao-de-fatura");
  });
});

describe("buildFeatures", () => {
  it("agrupa por id declarado e soma custo", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT }), obsSpec({ id: "OBS-002", feature: FEAT })];
    const [f] = buildFeatures("P", specs, undefined, NOW);
    expect(f.sessionIds).toEqual(["OBS-001", "OBS-002"]);
    expect(f.cost.totalCostUsd).toBe(2);
    expect(f.cost.incomplete).toBe(false);
  });

  it("atenção vence: um membro needs_attention marca a feature", () => {
    const specs = [
      obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" }),
      obsSpec({ id: "OBS-002", feature: FEAT, status: "needs_attention" }),
    ];
    const [f] = buildFeatures("P", specs, undefined, NOW);
    expect(f.status).toBe("needs_attention");
    expect(f.attention.count).toBe(1);
    expect(f.attention.items[0].sessionId).toBe("OBS-002");
  });

  it("done NUNCA derivado: todas fechadas sem toggle → idle", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" })];
    const [f] = buildFeatures("P", specs, undefined, NOW);
    expect(f.status).toBe("idle");
    expect(f.doneSource).toBeNull();
  });

  it("toggle manual do overlay marca done", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" })];
    const [f] = buildFeatures("P", specs, { done: { "P/PAY-1": true } }, NOW);
    expect(f.status).toBe("done");
    expect(f.doneSource).toBe("manual");
  });

  it("overlay assign vence declaração", () => {
    const specs = [
      obsSpec({ id: "OBS-001", feature: FEAT }),
      obsSpec({ id: "OBS-002", feature: { id: "OUTRA-9", key: "OUTRA-9", name: "Outra", jira: null } }),
    ];
    const out = buildFeatures("P", specs, { assign: { "P/OBS-002": "PAY-1" } }, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].sessionIds).toEqual(["OBS-001", "OBS-002"]);
  });

  it("sessão sem bloco vira feature-órfã de uma sessão", () => {
    const [f] = buildFeatures("P", [obsSpec({ id: "OBS-003", feature: null })], undefined, NOW);
    expect(f.orphan).toBe(true);
    expect(f.id).toBe("ft-orfa-obs-003");
    expect(f.sessionIds).toEqual(["OBS-003"]);
  });

  it("spanMs usa now quando há sessão aberta; engagedMs soma durações", () => {
    const specs = [
      obsSpec({ id: "OBS-001", feature: FEAT, createdAt: "2026-07-06T00:00:00Z", closedAt: "2026-07-06T02:00:00Z", status: "done" }),
      obsSpec({ id: "OBS-002", feature: FEAT, createdAt: "2026-07-06T10:00:00Z", closedAt: null }),
    ];
    const [f] = buildFeatures("P", specs, undefined, NOW);
    expect(f.time.spanMs).toBe(NOW - Date.parse("2026-07-06T00:00:00Z"));
    expect(f.time.engagedMs).toBe(2 * 3600_000 + 2 * 3600_000); // 2h fechada + 2h aberta até now
  });

  it("custo incompleto quando membro tem source partial", () => {
    const bad = obsSpec({ id: "OBS-004", feature: FEAT });
    (bad.cost as { source: string }).source = "partial";
    const [f] = buildFeatures("P", [obsSpec({ id: "OBS-001", feature: FEAT }), bad], undefined, NOW);
    expect(f.cost.incomplete).toBe(true);
  });

  it("ignora specs não-observadas (SDD legado)", () => {
    const sdd = { ...obsSpec({ id: "FEAT-001" }), observed: undefined } as Spec;
    expect(buildFeatures("P", [sdd], undefined, NOW)).toHaveLength(0);
  });

  it("overlay deliveryState=awaiting_deploy marca aguardando_deploy", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" })];
    const [f] = buildFeatures("P", specs, { deliveryState: { "P/PAY-1": "awaiting_deploy" } }, NOW);
    expect(f.status).toBe("awaiting_deploy");
    expect(f.doneSource).toBeNull();
  });

  it("deliveryState=done marca done com doneSource manual", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" })];
    const [f] = buildFeatures("P", specs, { deliveryState: { "P/PAY-1": "done" } }, NOW);
    expect(f.status).toBe("done");
    expect(f.doneSource).toBe("manual");
  });

  it("done legado (overlay.done=true) ainda funciona quando deliveryState não tem a chave", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" })];
    const [f] = buildFeatures("P", specs, { done: { "P/PAY-1": true } }, NOW);
    expect(f.status).toBe("done");
    expect(f.doneSource).toBe("manual");
  });

  it("deliveryState vence sobre done legado quando os dois existem pra mesma chave", () => {
    const specs = [obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" })];
    const [f] = buildFeatures(
      "P", specs,
      { done: { "P/PAY-1": true }, deliveryState: { "P/PAY-1": "awaiting_deploy" } },
      NOW,
    );
    expect(f.status).toBe("awaiting_deploy");
  });

  it("atenção sobrepõe aguardando_deploy e ele volta sozinho quando a atenção some (reabrir contínuo do QA)", () => {
    const overlay = { deliveryState: { "P/PAY-1": "awaiting_deploy" as const } };
    const comAtencao = [
      obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" }),
      obsSpec({ id: "OBS-002", feature: FEAT, status: "needs_attention" }),
    ];
    const [f1] = buildFeatures("P", comAtencao, overlay, NOW);
    expect(f1.status).toBe("needs_attention");

    const semAtencao = [
      obsSpec({ id: "OBS-001", feature: FEAT, status: "done", closedAt: "2026-07-06T01:00:00Z" }),
      obsSpec({ id: "OBS-002", feature: FEAT, status: "done", closedAt: "2026-07-06T02:00:00Z" }),
    ];
    const [f2] = buildFeatures("P", semAtencao, overlay, NOW);
    expect(f2.status).toBe("awaiting_deploy");
  });
});
