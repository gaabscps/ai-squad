import { describe, it, expect } from "vitest";
import { taskTotalTokens } from "./taskTokens";
import { makeTask } from "../test-utils";
import type { Dispatch } from "../../../src/store/types";

function makeDispatch(tokens: number | null): Dispatch {
  return {
    role: "dev",
    loop: 1,
    status: "done",
    summary: null,
    filesChanged: [],
    findings: [],
    testEvidence: [],
    tokens,
  };
}

describe("taskTotalTokens", () => {
  it("retorna null para tarefa sem dispatches", () => {
    expect(taskTotalTokens(makeTask({ dispatches: [] }))).toBeNull();
  });

  it("retorna null quando todos os dispatches têm tokens null", () => {
    const task = makeTask({ dispatches: [makeDispatch(null), makeDispatch(null)] });
    expect(taskTotalTokens(task)).toBeNull();
  });

  it("soma somente os dispatches com tokens numéricos (ignora null)", () => {
    const task = makeTask({
      dispatches: [makeDispatch(100), makeDispatch(null), makeDispatch(200)],
    });
    expect(taskTotalTokens(task)).toBe(300);
  });

  it("retorna o valor quando há apenas um dispatch numérico e os demais são null", () => {
    const task = makeTask({
      dispatches: [makeDispatch(null), makeDispatch(42), makeDispatch(null)],
    });
    expect(taskTotalTokens(task)).toBe(42);
  });

  it("soma corretamente quando todos os dispatches têm tokens numéricos", () => {
    const task = makeTask({ dispatches: [makeDispatch(10), makeDispatch(20), makeDispatch(30)] });
    expect(taskTotalTokens(task)).toBe(60);
  });

  it("retorna null para dispatch único com tokens null (não retorna 0)", () => {
    const result = taskTotalTokens(makeTask({ dispatches: [makeDispatch(null)] }));
    expect(result).toBeNull();
    expect(result).not.toBe(0);
  });
});
