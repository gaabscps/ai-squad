import { describe, it, expect } from "vitest";
import { featureColumn, bucketFeaturesByColumn, flattenFeatures, featureMatchesQuery } from "./kanbanFeatures";
import type { Feature } from "../../../src/store/types";

function feat(over: Partial<Feature>): Feature {
  return {
    id: "PAY-1", key: "PAY-1", name: "Export", orphan: false, projectId: "P",
    sessionIds: ["OBS-001"], status: "running", doneSource: null,
    attention: { count: 0, items: [] },
    delivery: { sessionsClosed: 0, sessionsTotal: 1, deliverables: [] },
    cost: { totalCostUsd: 1, totalTokens: 10, tokens: { input: 5, output: 5, cacheRead: 0, cacheCreation: 0 }, incomplete: false },
    time: { firstOpenedAt: null, lastClosedAt: null, spanMs: null, engagedMs: null },
    lastActivityAt: null, jira: null,
    ...over,
  };
}

describe("featureColumn", () => {
  it("needs_attention → attention; done → done; running e idle → running; awaiting_deploy → deploy", () => {
    expect(featureColumn(feat({ status: "needs_attention" }))).toBe("attention");
    expect(featureColumn(feat({ status: "done" }))).toBe("done");
    expect(featureColumn(feat({ status: "running" }))).toBe("running");
    expect(featureColumn(feat({ status: "idle" }))).toBe("running");
    expect(featureColumn(feat({ status: "awaiting_deploy" }))).toBe("deploy");
  });
});

describe("bucketFeaturesByColumn", () => {
  it("agrupa preservando ordem", () => {
    const items = [
      { feature: feat({ id: "A", status: "done" }), projectId: "P", projectName: "p", sessions: [] },
      { feature: feat({ id: "B", status: "needs_attention" }), projectId: "P", projectName: "p", sessions: [] },
    ];
    const buckets = bucketFeaturesByColumn(items);
    expect(buckets.done.map((i) => i.feature.id)).toEqual(["A"]);
    expect(buckets.attention.map((i) => i.feature.id)).toEqual(["B"]);
    expect(buckets.running).toEqual([]);
  });

  it("awaiting_deploy vai pro balde deploy", () => {
    const items = [{ feature: feat({ id: "C", status: "awaiting_deploy" as const }), projectId: "P", projectName: "p", sessions: [] }];
    const buckets = bucketFeaturesByColumn(items);
    expect(buckets.deploy.map((i) => i.feature.id)).toEqual(["C"]);
  });
});

describe("flattenFeatures", () => {
  it("junta features com suas sessões e respeita hidden", () => {
    const spec = { id: "OBS-001", observed: {} } as never;
    const projects = [
      { id: "P", name: "p", path: "/p", hidden: false, specs: [spec], features: [feat({})] },
      { id: "H", name: "h", path: "/h", hidden: true, specs: [], features: [feat({ id: "X" })] },
    ] as never[];
    const out = flattenFeatures(projects as never, false);
    expect(out).toHaveLength(1);
    expect(out[0].sessions.map((s) => s.spec.id)).toEqual(["OBS-001"]);
  });

  it("inclui projeto hidden quando showHidden=true", () => {
    const spec = { id: "OBS-001", observed: {} } as never;
    const projects = [
      { id: "H", name: "h", path: "/h", hidden: true, specs: [spec], features: [feat({ id: "X" })] },
    ] as never[];
    const out = flattenFeatures(projects as never, true);
    expect(out).toHaveLength(1);
    expect(out[0].feature.id).toBe("X");
  });

  it("sessionIds sem Spec correspondente ficam de fora da lista de sessões (sem quebrar)", () => {
    const spec = { id: "OBS-001", observed: {} } as never;
    const projects = [
      { id: "P", name: "p", path: "/p", hidden: false, specs: [spec], features: [feat({ sessionIds: ["OBS-001", "OBS-404"] })] },
    ] as never[];
    const out = flattenFeatures(projects as never, false);
    expect(out[0].sessions.map((s) => s.spec.id)).toEqual(["OBS-001"]);
  });
});

describe("featureMatchesQuery", () => {
  const spec = { id: "OBS-001", title: "Exportar PDF" } as never;
  const item = {
    feature: feat({ name: "Export de fatura", key: "PAY-1" }),
    projectId: "P", projectName: "proj-a",
    sessions: [{ spec, projectId: "P", projectName: "proj-a" }],
  };

  it("string vazia sempre casa", () => {
    expect(featureMatchesQuery(item as never, "")).toBe(true);
  });

  it("casa pelo nome da feature", () => {
    expect(featureMatchesQuery(item as never, "fatura")).toBe(true);
  });

  it("casa pela key da feature", () => {
    expect(featureMatchesQuery(item as never, "pay-1")).toBe(true);
  });

  it("casa quando uma sessão-membro casa mesmo sem casar no nome/key da feature", () => {
    expect(featureMatchesQuery(item as never, "pdf")).toBe(true);
  });

  it("não casa quando nada bate", () => {
    expect(featureMatchesQuery(item as never, "inexistente")).toBe(false);
  });
});
