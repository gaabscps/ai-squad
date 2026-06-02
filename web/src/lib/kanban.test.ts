import { describe, it, expect } from "vitest";
import {
  columnForSpec, attentionReason, COLUMN_DEFS,
  flattenSpecs, bucketByColumn, matchesQuery,
} from "./kanban";
import { makeSpec, makeProject, makeTask } from "../test-utils";

describe("columnForSpec", () => {
  it("blocked/escalated/paused vão pra 'attention' (ganham de tudo)", () => {
    expect(columnForSpec(makeSpec({ status: "blocked" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "escalated" }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "paused" }))).toBe("attention");
  });

  it("auditException leva pra 'attention' mesmo se running ou done", () => {
    const h = { pendingHuman: 0, escalationRate: 0, auditException: true };
    expect(columnForSpec(makeSpec({ status: "running", health: h }))).toBe("attention");
    expect(columnForSpec(makeSpec({ status: "done", health: h }))).toBe("attention");
  });

  it("done vai pra 'done'", () => {
    expect(columnForSpec(makeSpec({ status: "done" }))).toBe("done");
  });

  it("discovery em andamento vai pra 'running' (sem conceito de planejado)", () => {
    expect(columnForSpec(makeSpec({ squad: "discovery", status: "running", tasks: [] }))).toBe("running");
  });

  it("tem task running/done -> 'running' (execução começou)", () => {
    expect(columnForSpec(makeSpec({ status: "running", tasks: [makeTask({ state: "running" })] }))).toBe("running");
    expect(columnForSpec(makeSpec({ status: "running", tasks: [makeTask({ state: "done" })] }))).toBe("running");
  });

  it("tem tasks e todas pending -> 'planned' (decomposto, ninguém começou)", () => {
    expect(columnForSpec(makeSpec({ status: "running", tasks: [makeTask(), makeTask()] }))).toBe("planned");
  });

  it("tasks parado em phase=tasks (todas pending) também é 'planned'", () => {
    expect(columnForSpec(makeSpec({ status: "running", phase: "tasks", tasks: [makeTask()] }))).toBe("planned");
  });

  it("sem tasks geradas -> 'planning' (ainda escrevendo spec/plano)", () => {
    expect(columnForSpec(makeSpec({ status: "running", phase: "specify", tasks: [] }))).toBe("planning");
    expect(columnForSpec(makeSpec({ status: "running", phase: "implementation", tasks: [] }))).toBe("planning");
  });
});

describe("attentionReason", () => {
  it("blocked aponta a task bloqueada quando existe", () => {
    const spec = makeSpec({
      status: "blocked",
      tasks: [{ id: "T-005", state: "blocked", loops: 1, dispatches: [] }],
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
  it("tem as 5 colunas na ordem certa", () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toEqual([
      "attention", "planning", "planned", "running", "done",
    ]);
  });
});

describe("flattenSpecs", () => {
  it("achata todas as specs com metadados do projeto", () => {
    const projects = [
      makeProject({ id: "p1", name: "proj-a", path: "/a", specs: [makeSpec({ id: "FEAT-1" })] }),
      makeProject({ id: "p2", name: "proj-b", path: "/b", specs: [makeSpec({ id: "FEAT-2" })] }),
    ];
    const flat = flattenSpecs(projects, false);
    expect(flat.map((s) => s.spec.id)).toEqual(["FEAT-1", "FEAT-2"]);
    expect(flat[0]).toMatchObject({ projectId: "p1", projectName: "proj-a", projectPath: "/a" });
  });
  it("esconde projetos hidden quando showHidden=false", () => {
    const projects = [
      makeProject({ id: "p1", hidden: true, specs: [makeSpec({ id: "FEAT-1" })] }),
      makeProject({ id: "p2", specs: [makeSpec({ id: "FEAT-2" })] }),
    ];
    expect(flattenSpecs(projects, false).map((s) => s.spec.id)).toEqual(["FEAT-2"]);
    expect(flattenSpecs(projects, true).map((s) => s.spec.id)).toEqual(["FEAT-1", "FEAT-2"]);
  });
});

describe("bucketByColumn", () => {
  it("agrupa cada item na sua coluna", () => {
    const flat = flattenSpecs(
      [makeProject({ specs: [
        makeSpec({ id: "A", status: "running", tasks: [makeTask({ state: "running" })] }), // running
        makeSpec({ id: "B", status: "blocked", tasks: [makeTask({ state: "blocked" })] }), // attention
        makeSpec({ id: "C", status: "done" }),                                             // done
        makeSpec({ id: "D", status: "running", tasks: [makeTask()] }),                     // planned
        makeSpec({ id: "E", status: "running", phase: "specify", tasks: [] }),             // planning
      ] })],
      false,
    );
    const buckets = bucketByColumn(flat);
    expect(buckets.running.map((s) => s.spec.id)).toEqual(["A"]);
    expect(buckets.attention.map((s) => s.spec.id)).toEqual(["B"]);
    expect(buckets.done.map((s) => s.spec.id)).toEqual(["C"]);
    expect(buckets.planned.map((s) => s.spec.id)).toEqual(["D"]);
    expect(buckets.planning.map((s) => s.spec.id)).toEqual(["E"]);
  });
});

describe("matchesQuery", () => {
  const item = flattenSpecs(
    [makeProject({ name: "site-vendas", specs: [makeSpec({ id: "FEAT-042", title: "Exportar PDF" })] })],
    false,
  )[0];
  it("vazio casa com tudo", () => expect(matchesQuery(item, "")).toBe(true));
  it("casa por id (case-insensitive)", () => expect(matchesQuery(item, "feat-042")).toBe(true));
  it("casa por título", () => expect(matchesQuery(item, "exportar")).toBe(true));
  it("casa por nome do projeto", () => expect(matchesQuery(item, "vendas")).toBe(true));
  it("não casa quando nada bate", () => expect(matchesQuery(item, "zzz")).toBe(false));
});
