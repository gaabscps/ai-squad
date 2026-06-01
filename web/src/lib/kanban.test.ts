import { describe, it, expect } from "vitest";
import { columnForSpec, attentionReason, COLUMN_DEFS } from "./kanban";
import { makeSpec } from "../test-utils";

describe("columnForSpec", () => {
  it("running vai pra 'running'", () => {
    expect(columnForSpec(makeSpec({ status: "running" }))).toBe("running");
  });
  it("done vai pra 'done'", () => {
    expect(columnForSpec(makeSpec({ status: "done" }))).toBe("done");
  });
  it("blocked/escalated/paused vão pra 'attention'", () => {
    expect(columnForSpec(makeSpec({ status: "blocked" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "escalated" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "paused" }))).toBe("attention");
  });
  it("auditException leva pra 'attention' mesmo se running ou done", () => {
    const h = { pendingHuman: 0, escalationRate: 0, auditException: true };
    expect(columnForSpec(makeSpec({ status: "running", health: h }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "done", health: h }))).toBe("attention");
  });
});

describe("attentionReason", () => {
  it("blocked aponta a task bloqueada quando existe", () => {
    const spec = makeSpec({
      status: "blocked",
      tasks: [{ id: "T-005", state: "blocked", loops: 1 }],
    });
    expect(attentionReason(spec)).toEqual({ kind: "blocked", label: "T-005 bloqueada" });
  });
  it("blocked sem task identificada usa label genérico", () => {
    expect(attentionReason(makeSpec({ status: "blocked", tasks: [] }))).toEqual({
      kind: "blocked",
      label: "bloqueado",
    });
  });
  it("escalated", () => {
    expect(attentionReason(makeSpec({ status: "escalated" }))).toEqual({
      kind: "escalated",
      label: "decisão humana",
    });
  });
  it("paused", () => {
    expect(attentionReason(makeSpec({ status: "paused" }))).toEqual({
      kind: "paused",
      label: "pausado",
    });
  });
  it("audit quando exceção e status normal", () => {
    expect(
      attentionReason(makeSpec({ status: "running", health: { pendingHuman: 0, escalationRate: 0, auditException: true } })),
    ).toEqual({ kind: "audit", label: "exceção de auditoria" });
  });
  it("sem motivo de atenção retorna null", () => {
    expect(attentionReason(makeSpec({ status: "running" }))).toBeNull();
  });
});

describe("COLUMN_DEFS", () => {
  it("tem as 3 colunas na ordem certa", () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toEqual(["attention", "running", "done"]);
  });
});
