import type { Project, Spec } from "../../../src/store/types";
import { buildFeatures, type FeaturesOverlay } from "../../../src/collector/features";

export function spec(over: Partial<Spec> & {
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

export function project(name: string, specs: Spec[], overlay?: FeaturesOverlay): Project {
  // features derivadas pelo mesmo builder de produção (buildFeatures), pra featureRows
  // testar contra a semântica real: status "done" nunca vem do status da sessão.
  const id = `${name}-hash`;
  return { id, path: `/${name}`, name, specs, hidden: false, features: buildFeatures(id, specs, overlay, Date.now()) };
}
