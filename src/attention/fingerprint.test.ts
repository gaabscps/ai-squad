import { describe, it, expect } from "vitest";
import { contextFingerprint } from "./fingerprint.js";
import type { AttentionContext } from "./context.js";

function ctx(over: Partial<AttentionContext> = {}): AttentionContext {
  return { specId: "FEAT-001", title: "Login", status: "blocked", phase: "impl", plannedPhases: [], projectPath: "/p", auditException: false, notes: [], findings: [], ...over };
}

describe("contextFingerprint", () => {
  it("é estável para o mesmo contexto", () => {
    expect(contextFingerprint(ctx())).toBe(contextFingerprint(ctx()));
  });

  it("muda quando uma note muda", () => {
    const a = contextFingerprint(ctx({ notes: [{ kind: "blocked", timestamp: "T", note: "x" }] }));
    const b = contextFingerprint(ctx({ notes: [{ kind: "blocked", timestamp: "T", note: "y" }] }));
    expect(a).not.toBe(b);
  });

  it("muda quando o status muda", () => {
    expect(contextFingerprint(ctx({ status: "blocked" }))).not.toBe(contextFingerprint(ctx({ status: "escalated" })));
  });
});
