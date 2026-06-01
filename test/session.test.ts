import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseSession, deriveStatus } from "../src/collector/session.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixt = (name: string) => join(here, "fixtures", name);

describe("parseSession", () => {
  it("mapeia campos do session.yml num Spec", () => {
    const s = parseSession(fixt("feat-done"))!;
    expect(s.id).toBe("FEAT-099");
    expect(s.squad).toBe("sdd");
    expect(s.title).toBe("exemplo concluido");
    expect(s.plannedPhases).toEqual(["specify", "plan", "tasks", "implementation"]);
    expect(s.tasks).toHaveLength(2);
    expect(s.tasks[1]).toEqual({ id: "T-002", state: "done", loops: 2 });
    expect(s.health.pendingHuman).toBe(0);
    expect(s.timeline[0].kind).toBe("pm_init");
    expect(s.status).toBe("done");
  });

  it("retorna null quando não há session.yml", () => {
    expect(parseSession(fixt("spec-sem-custo"))).toBeNull();
  });
});

describe("deriveStatus", () => {
  it("done quando current_phase é done", () => {
    expect(deriveStatus({ current_phase: "done" }, [])).toBe("done");
  });
  it("escalated quando current_phase é escalated", () => {
    expect(deriveStatus({ current_phase: "escalated" }, [])).toBe("escalated");
  });
  it("paused quando há paused_at", () => {
    expect(
      deriveStatus({ current_phase: "implementation", paused_at: "x" }, [])
    ).toBe("paused");
  });
  it("blocked quando alguma task está blocked", () => {
    expect(
      deriveStatus({ current_phase: "implementation" }, [
        { id: "T-001", state: "blocked", loops: 3 },
      ])
    ).toBe("blocked");
  });
  it("running no caso default", () => {
    expect(deriveStatus({ current_phase: "implementation" }, [])).toBe("running");
  });
});
