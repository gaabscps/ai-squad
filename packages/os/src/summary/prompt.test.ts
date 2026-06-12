import { describe, it, expect } from "vitest";
import { buildSummaryPrompt } from "./prompt.js";
import type { Task, Dispatch } from "../store/types.js";

function disp(over: Partial<Dispatch> = {}): Dispatch {
  return { role: "dev", loop: 1, status: "done", summary: null, filesChanged: [], findings: [], testEvidence: [], tokens: null, ...over };
}
function task(over: Partial<Task> = {}): Task {
  return { id: "T-001", state: "done", loops: 1, dispatches: [], ...over };
}

describe("buildSummaryPrompt", () => {
  it("inclui a instrução de tom de ensino", () => {
    const p = buildSummaryPrompt("Coletor de dispatches", task());
    expect(p).toMatch(/did[áa]tico/i);
    expect(p).toMatch(/front-end/i);
  });

  it("inclui título da spec, id e estado da task", () => {
    const p = buildSummaryPrompt("Coletor de dispatches", task({ id: "T-008", state: "done" }));
    expect(p).toContain("Coletor de dispatches");
    expect(p).toContain("T-008");
  });

  it("inclui os summaries, arquivos e findings dos dispatches", () => {
    const p = buildSummaryPrompt("X", task({
      dispatches: [disp({ summary: "implementou o reader", filesChanged: ["src/a.ts"], findings: [{ severity: "warning", file: "src/a.ts", line: 3, text: "ajustar parsing" }] })],
    }));
    expect(p).toContain("implementou o reader");
    expect(p).toContain("src/a.ts");
    expect(p).toContain("ajustar parsing");
  });

  it("não quebra com task sem dispatches", () => {
    expect(() => buildSummaryPrompt("X", task({ dispatches: [] }))).not.toThrow();
  });
});
