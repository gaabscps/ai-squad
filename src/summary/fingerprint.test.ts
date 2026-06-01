import { describe, it, expect } from "vitest";
import { taskFingerprint } from "./fingerprint.js";
import type { Task, Dispatch } from "../store/types.js";

function disp(over: Partial<Dispatch> = {}): Dispatch {
  return { role: "dev", loop: 1, status: "done", summary: null, filesChanged: [], findings: [], testEvidence: [], tokens: null, ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: "T-001", state: "done", loops: 1, dispatches: [], ...over };
}

describe("taskFingerprint", () => {
  it("é estável: mesma task → mesmo hash", () => {
    const t = task({ dispatches: [disp({ summary: "fez X" })] });
    expect(taskFingerprint(t)).toBe(taskFingerprint(task({ dispatches: [disp({ summary: "fez X" })] })));
  });

  it("muda quando um dispatch muda", () => {
    const a = task({ dispatches: [disp({ summary: "fez X" })] });
    const b = task({ dispatches: [disp({ summary: "fez Y" })] });
    expect(taskFingerprint(a)).not.toBe(taskFingerprint(b));
  });

  it("muda quando um dispatch é adicionado", () => {
    const a = task({ dispatches: [disp()] });
    const b = task({ dispatches: [disp(), disp({ loop: 2 })] });
    expect(taskFingerprint(a)).not.toBe(taskFingerprint(b));
  });

  it("retorna string hex não-vazia", () => {
    expect(taskFingerprint(task())).toMatch(/^[0-9a-f]+$/);
  });
});
