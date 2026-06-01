import type { Project, Spec, CostRollup } from "../../src/store/types";

export function makeCost(over: Partial<CostRollup> = {}): CostRollup {
  return {
    totalCostUsd: 0.5,
    partial: false,
    tokens: { input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 },
    totalTokens: 1350,
    reportPath: null,
    ...over,
  };
}

export function makeSpec(over: Partial<Spec> = {}): Spec {
  return {
    id: "FEAT-001",
    squad: "sdd",
    title: "exemplo",
    phase: "implementation",
    plannedPhases: ["specify", "plan", "tasks", "implementation"],
    status: "running",
    tasks: [],
    health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: "2026-05-20T10:00:00Z",
    timeline: [],
    cost: makeCost(),
    ...over,
  };
}

export function makeProject(over: Partial<Project> = {}): Project {
  return { id: "proj-abc", path: "/x/proj", name: "proj", specs: [], hidden: false, ...over };
}
