import { describe, it, expect } from "vitest";
import { buildDiagnosisPrompt } from "./prompt.js";
import type { AttentionContext } from "./context.js";

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { specId: "FEAT-001", title: "Login", status: "blocked", phase: "implementation", plannedPhases: [], projectPath: "/p", auditException: false, notes: [], findings: [], ...over };
}

describe("buildDiagnosisPrompt", () => {
  it("inclui a instrução anti-alucinação (não invente se vazio)", () => {
    expect(buildDiagnosisPrompt(ctx())).toMatch(/não invente/i);
  });

  it("com dados vazios, sinaliza ausência em vez de prometer conteúdo", () => {
    const p = buildDiagnosisPrompt(ctx());
    expect(p).toContain("(sem anotações na linha do tempo)");
    expect(p).toContain("(sem findings de review)");
  });

  it("renderiza notes e findings quando existem", () => {
    const p = buildDiagnosisPrompt(ctx({
      notes: [{ kind: "blocked", timestamp: "T", note: "reviewer rejeitou" }],
      findings: [{ severity: "error", loc: "auth.ts:42", text: "sem validação" }],
    }));
    expect(p).toContain("reviewer rejeitou");
    expect(p).toContain("auth.ts:42");
    expect(p).toContain("sem validação");
  });

  it("pede os 3 blocos (por que / o que pedem / próximo passo)", () => {
    const p = buildDiagnosisPrompt(ctx());
    expect(p).toMatch(/POR QUE/);
    expect(p).toMatch(/PR[ÓO]XIMO PASSO/i);
  });
});
