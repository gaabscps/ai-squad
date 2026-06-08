import type { Project, Spec, Task, CostRollup, Dispatch } from "../../src/store/types";

export function makeDispatch(over: Partial<Dispatch> = {}): Dispatch {
  return {
    role: "dev",
    loop: 1,
    status: "done",
    summary: null,
    filesChanged: [],
    findings: [],
    testEvidence: [],
    tokens: null,
    ...over,
  };
}

export function makeCost(over: Partial<CostRollup> = {}): CostRollup {
  return {
    totalCostUsd: 0.5,
    partial: false,
    tokens: { input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 },
    totalTokens: 1350,
    reportPath: null,
    source: "partial",
    scopingSuspect: false,
    excludedSubagents: null,
    recoveredSubagents: null,
    byPhase: null,
    complete: null,
    ...over,
  };
}

export function makeTask(over: Partial<Task> = {}): Task {
  return { id: "T-001", state: "pending", loops: 0, dispatches: [], ...over };
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
    deliveryReport: null,
    ...over,
  };
}

export function makeProject(over: Partial<Project> = {}): Project {
  return { id: "proj-abc", path: "/x/proj", name: "proj", specs: [], hidden: false, ...over };
}
