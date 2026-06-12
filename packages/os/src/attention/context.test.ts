import { describe, it, expect } from "vitest";
import { buildAttentionContext } from "./context.js";
import type { Spec } from "../store/types.js";

function makeSpec(over: Partial<Spec> = {}): Spec {
  return {
    id: "FEAT-001", squad: "sdd", title: "Login", phase: "implementation",
    plannedPhases: ["specify", "plan", "tasks", "implementation"],
    status: "blocked", tasks: [], health: { pendingHuman: 0, escalationRate: 0, auditException: false },
    lastActivityAt: null, timeline: [], cost: { totalCostUsd: null, partial: false, tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, totalTokens: 0, reportPath: null, source: "empty", scopingSuspect: false, excludedSubagents: null, recoveredSubagents: null, byPhase: null, complete: null },
    ...over,
  };
}

describe("buildAttentionContext", () => {
  it("achata findings dos dispatches com loc montado e mapeia notes da timeline", () => {
    const spec = makeSpec({
      timeline: [{ kind: "blocked", timestamp: "2026-06-01T14:02:00Z", note: "reviewer rejeitou" }],
      tasks: [{ id: "T-008", state: "blocked", loops: 2, dispatches: [
        { role: "code-reviewer", loop: 2, status: "rejected", summary: null, filesChanged: [], findings: [{ severity: "error", file: "auth.ts", line: 42, text: "sem validação" }], testEvidence: [], tokens: null },
      ] }],
    });
    const ctx = buildAttentionContext(spec, "/proj/login");
    expect(ctx.specId).toBe("FEAT-001");
    expect(ctx.projectPath).toBe("/proj/login");
    expect(ctx.status).toBe("blocked");
    expect(ctx.notes).toEqual([{ kind: "blocked", timestamp: "2026-06-01T14:02:00Z", note: "reviewer rejeitou" }]);
    expect(ctx.findings).toEqual([{ severity: "error", loc: "auth.ts:42", text: "sem validação" }]);
  });

  it("é robusto a vazio: sem timeline e sem tasks → arrays vazios", () => {
    const ctx = buildAttentionContext(makeSpec(), "/p");
    expect(ctx.notes).toEqual([]);
    expect(ctx.findings).toEqual([]);
    expect(ctx.auditException).toBe(false);
  });

  it("finding sem file vira loc null", () => {
    const spec = makeSpec({ tasks: [{ id: "T-1", state: "blocked", loops: 1, dispatches: [
      { role: "qa", loop: 1, status: "fail", summary: null, filesChanged: [], findings: [{ severity: "warning", file: null, line: null, text: "fluxo X falha" }], testEvidence: [], tokens: null },
    ] }] });
    expect(buildAttentionContext(spec, "/p").findings[0].loc).toBeNull();
  });
});
