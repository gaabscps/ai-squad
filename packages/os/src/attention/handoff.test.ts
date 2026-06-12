import { describe, it, expect } from "vitest";
import { buildHandoffPrompt } from "./handoff.js";
import type { AttentionContext } from "./context.js";

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { specId: "FEAT-001", title: "Login", status: "blocked", phase: "implementation", plannedPhases: [], projectPath: "/proj/login", auditException: false, notes: [], findings: [], ...over };
}

describe("buildHandoffPrompt", () => {
  it("inclui caminho do projeto, spec id e o diretório .agent-session", () => {
    const p = buildHandoffPrompt(ctx());
    expect(p).toContain("/proj/login");
    expect(p).toContain("FEAT-001");
    expect(p).toContain("/proj/login/.agent-session/FEAT-001/");
  });

  it("embute notes e findings quando existem", () => {
    const p = buildHandoffPrompt(ctx({
      notes: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
      findings: [{ severity: "error", loc: "auth.ts:42", text: "sem validação" }],
    }));
    expect(p).toContain("reviewer rejeitou");
    expect(p).toContain("auth.ts:42");
  });

  it("não chama IA — é texto determinístico (mesmo ctx → mesmo texto)", () => {
    expect(buildHandoffPrompt(ctx())).toBe(buildHandoffPrompt(ctx()));
  });
});
