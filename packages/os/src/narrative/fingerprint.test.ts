import { describe, it, expect } from "vitest";
import { observedFingerprint } from "./fingerprint.js";
import type { ObservedMeta } from "../store/types.js";

function obs(partial: Partial<ObservedMeta>): ObservedMeta {
  return {
    intent: "x", createdAt: "a", closedAt: "b", attentionKind: null, decisions: [],
    evidence: [], driftFlags: [], baseSha: null, outputLocale: "pt-BR", feature: null, report: null, markers: [], ...partial,
  };
}

describe("observedFingerprint", () => {
  it("é estável para a mesma entrada", () => {
    const o = obs({ markers: [{ kind: "run", at: "t", exact: true, note: "vitest", decision: null, evidence: null, editFiles: null, blockMs: null }] });
    expect(observedFingerprint(o, "done")).toBe(observedFingerprint(o, "done"));
  });
  it("muda quando o status muda", () => {
    const o = obs({});
    expect(observedFingerprint(o, "done")).not.toBe(observedFingerprint(o, "in_progress"));
  });
  it("muda quando um marker muda", () => {
    const a = obs({ markers: [{ kind: "run", at: "t", exact: true, note: "vitest", decision: null, evidence: null, editFiles: null, blockMs: null }] });
    const b = obs({ markers: [{ kind: "run", at: "t", exact: true, note: "tsc", decision: null, evidence: null, editFiles: null, blockMs: null }] });
    expect(observedFingerprint(a, "done")).not.toBe(observedFingerprint(b, "done"));
  });
});
