import type { Project, Spec, Task, CostRollup, Dispatch, DeliveryReport, ObservedMeta, Feature, FeatureCost } from "../../src/store/types";

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

export function makeDeliveryReport(over: Partial<DeliveryReport> = {}): DeliveryReport {
  return {
    specId: "FEAT-011",
    outputLocale: "pt-BR",
    generatedAt: "2026-06-07T12:00:00Z",
    verdict: { value: "approved_with_caveats", rationale: "ok com ressalvas", evidenceRefs: ["o#1"] },
    answers: [
      { key: "what_was_done", answer: "fez X", confidence: "recorded", evidenceRefs: ["d#f"] },
      { key: "risks_and_pending", answer: "risco Y", confidence: "inferred", evidenceRefs: [] },
    ],
    acceptanceCriteria: [
      { id: "AC-001", description: "faz isso", classification: "met", evidenceRefs: [] },
      { id: "AC-002", description: "faz aquilo", classification: "partially_met", evidenceRefs: [] },
    ],
    container: "answers",
    mdPath: "/x/delivery-report.md",
    jsonPath: "/x/delivery-report.json",
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
    lastActivityAt: new Date(Date.now() - 60_000).toISOString(), // 1 min atrás — nunca vira dormente/arquivada
    timeline: [],
    cost: makeCost(),
    deliveryReport: null,
    ...over,
  };
}

export function makeProject(over: Partial<Project> = {}): Project {
  return { id: "proj-abc", path: "/x/proj", name: "proj", specs: [], features: [], hidden: false, ...over };
}

export function makeFeatureCost(over: Partial<FeatureCost> = {}): FeatureCost {
  return {
    totalCostUsd: 0.5,
    totalTokens: 1350,
    tokens: { input: 100, output: 50, cacheRead: 1000, cacheCreation: 200 },
    incomplete: false,
    ...over,
  };
}

/**
 * Feature de teste; por padrão referencia uma única sessão "FEAT-001" (o id
 * default de makeSpec) pra facilitar o join nos testes de Board/KanbanBoard.
 */
export function makeFeature(over: Partial<Feature> = {}): Feature {
  return {
    id: "ft-1",
    key: null,
    name: "Feature exemplo",
    orphan: false,
    projectId: "proj-abc",
    sessionIds: ["FEAT-001"],
    status: "running",
    doneSource: null,
    attention: { count: 0, items: [] },
    delivery: { sessionsClosed: 0, sessionsTotal: 1, deliverables: [] },
    cost: makeFeatureCost(),
    time: { firstOpenedAt: null, lastClosedAt: null, spanMs: null, engagedMs: null },
    lastActivityAt: null,
    jira: null,
    ...over,
  };
}

/** Metadados mínimos de uma sessão observada (campo Spec.observed). */
export function makeObservedMeta(over: Partial<ObservedMeta> = {}): ObservedMeta {
  return {
    intent: "exemplo observado",
    createdAt: "2026-06-01T10:00:00Z",
    closedAt: null,
    attentionKind: null,
    decisions: [],
    evidence: [],
    driftFlags: [],
    baseSha: null,
    outputLocale: null,
    feature: null,
    markers: [],
    report: null,
    ...over,
  };
}

/**
 * Spec com campo `observed` preenchido e tasks [].
 * Destinada a testes do modo observado; makeSpec permanece intocado para
 * proteger os testes SDD legados.
 */
export function makeObservedSpec(over: Partial<Spec> = {}): Spec {
  return makeSpec({
    tasks: [],
    observed: makeObservedMeta(),
    ...over,
  });
}
