import { describe, it, expect } from "vitest";
import { visibleDecisions, visibleEvidence } from "./observedTrail";
import type { ObservedMeta } from "../../../src/store/types";

const base: ObservedMeta = {
  intent: "x", createdAt: null, closedAt: null, attentionKind: null,
  decisions: [], evidence: [], driftFlags: [],
  baseSha: null, outputLocale: null, feature: null, markers: [], report: null,
};

describe("visibleDecisions", () => {
  it("filtra decisões totalmente vazias", () => {
    const obs = { ...base, decisions: [
      { what: "A", why: null, rejected: null, ref: null },
      { what: "", why: null, rejected: null, ref: null },
    ]};
    expect(visibleDecisions(obs)).toHaveLength(1);
  });

  it("mantém decisão com qualquer campo preenchido (why)", () => {
    const obs = { ...base, decisions: [
      { what: "", why: "porque sim", rejected: null, ref: null },
    ]};
    expect(visibleDecisions(obs)).toHaveLength(1);
  });

  it("array vazio retorna vazio", () => {
    expect(visibleDecisions(base)).toHaveLength(0);
  });
});

describe("visibleEvidence", () => {
  it("filtra evidências totalmente vazias", () => {
    const obs = { ...base, evidence: [
      { cmd: "ls", result: null, kind: null },
      { cmd: null, result: null, kind: null },
    ]};
    expect(visibleEvidence(obs)).toHaveLength(1);
  });

  it("mantém evidência com qualquer campo preenchido (result)", () => {
    const obs = { ...base, evidence: [
      { cmd: null, result: "ok", kind: null },
    ]};
    expect(visibleEvidence(obs)).toHaveLength(1);
  });

  it("array vazio retorna vazio", () => {
    expect(visibleEvidence(base)).toHaveLength(0);
  });
});
