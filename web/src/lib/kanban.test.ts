import { describe, it, expect } from "vitest";
import {
  columnForSpec, attentionReason, COLUMN_DEFS,
  flattenSpecs, bucketByColumn, matchesQuery,
} from "./kanban";
import { makeSpec, makeProject } from "../test-utils";

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
  it("tem as 3 colunas na ordem certa", () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toEqual(["attention", "running", "done"]);
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
        makeSpec({ id: "A", status: "running" }),
        makeSpec({ id: "B", status: "blocked", tasks: [{ id: "T-1", state: "blocked", loops: 0, dispatches: [] }] }),
        makeSpec({ id: "C", status: "done" }),
        makeSpec({ id: "D", status: "running" }),
      ] })],
      false,
    );
    const buckets = bucketByColumn(flat);
    expect(buckets.running.map((s) => s.spec.id)).toEqual(["A", "D"]);
    expect(buckets.attention.map((s) => s.spec.id)).toEqual(["B"]);
    expect(buckets.done.map((s) => s.spec.id)).toEqual(["C"]);
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
