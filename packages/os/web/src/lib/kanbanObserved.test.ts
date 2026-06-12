import { describe, it, expect } from "vitest";
import {
  columnForSpec,
  attentionReason,
  isArchived,
  bucketByColumn,
  COLUMN_DEFS,
} from "./kanbanObserved";
import { flattenSpecs } from "./kanbanObserved";
import { makeSpec, makeProject, makeObservedSpec } from "../test-utils";

// ─── columnForSpec ─────────────────────────────────────────────────────────────

describe("columnForSpec (observed)", () => {
  it("needs_attention → attention", () => {
    expect(columnForSpec(makeSpec({ status: "needs_attention" }))).toBe("attention");
  });
  it("unreadable → attention", () => {
    expect(columnForSpec(makeSpec({ status: "unreadable" }))).toBe("attention");
  });
  it("blocked → attention (compatibilidade SDD)", () => {
    expect(columnForSpec(makeSpec({ status: "blocked" }))).toBe("attention");
  });
  it("escalated → attention (compatibilidade SDD)", () => {
    expect(columnForSpec(makeSpec({ status: "escalated" }))).toBe("attention");
  });
  it("paused → attention (compatibilidade SDD)", () => {
    expect(columnForSpec(makeSpec({ status: "paused" }))).toBe("attention");
  });
  it("running → running", () => {
    expect(columnForSpec(makeSpec({ status: "running" }))).toBe("running");
  });
  it("done → done", () => {
    expect(columnForSpec(makeSpec({ status: "done" }))).toBe("done");
  });
  it("abandoned → done", () => {
    expect(columnForSpec(makeSpec({ status: "abandoned" }))).toBe("done");
  });
});

// ─── attentionReason ───────────────────────────────────────────────────────────

describe("attentionReason (observed)", () => {
  it("needs_attention → kind=input, label aguarda resposta", () => {
    const r = attentionReason(makeSpec({ status: "needs_attention" }));
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("input");
    expect(r!.label).toMatch(/aguardando/i);
  });
  it("unreadable → kind=unreadable, label ilegível", () => {
    const r = attentionReason(makeSpec({ status: "unreadable" }));
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("unreadable");
    expect(r!.label).toMatch(/ilegível/i);
  });
  it("running → null (sem motivo de atenção)", () => {
    expect(attentionReason(makeSpec({ status: "running" }))).toBeNull();
  });

  it("blocked → kind=blocked, label usa o id da task bloqueada", () => {
    const r = attentionReason(
      makeSpec({ status: "blocked", tasks: [{ id: "T-007", state: "blocked", loops: 0, dispatches: [] }] }),
    );
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("blocked");
    expect(r!.label).toMatch(/T-007/);
  });
});

// ─── isArchived ────────────────────────────────────────────────────────────────

describe("isArchived (observed)", () => {
  // "agora" fixo: 2026-06-10
  const NOW = Date.parse("2026-06-10T00:00:00Z");

  it("done + idade > limite → arquivada", () => {
    const spec = makeSpec({ status: "done", lastActivityAt: "2026-06-01T00:00:00Z" }); // 9 dias
    expect(isArchived(spec, NOW, 7)).toBe(true);
  });

  it("abandoned + idade > limite → arquivada (terminal observado)", () => {
    const spec = makeSpec({ status: "abandoned", lastActivityAt: "2026-06-01T00:00:00Z" }); // 9 dias
    expect(isArchived(spec, NOW, 7)).toBe(true);
  });

  it("done sem lastActivityAt → não arquivada (idade desconhecida)", () => {
    const spec = makeSpec({ status: "done", lastActivityAt: null });
    expect(isArchived(spec, NOW, 7)).toBe(false);
  });

  it("running + velha → não arquivada (só terminais arquivam)", () => {
    const spec = makeSpec({ status: "running", lastActivityAt: "2020-01-01T00:00:00Z" });
    expect(isArchived(spec, NOW, 7)).toBe(false);
  });

  it("done + idade == limite → NÃO arquivada (limite é exclusivo)", () => {
    // NOW=2026-06-10, limit=9 dias → 2026-06-01 = exatamente 9 dias → ainda aparece
    const spec = makeSpec({ status: "done", lastActivityAt: "2026-06-01T00:00:00Z" });
    expect(isArchived(spec, NOW, 9)).toBe(false);
  });
});

// ─── bucketByColumn ────────────────────────────────────────────────────────────

describe("bucketByColumn (observed)", () => {
  it("distribui specs nas 3 colunas certas e preserva a forma do objeto", () => {
    const items = flattenSpecs(
      [makeProject({ specs: [
        makeObservedSpec({ id: "OBS-001", status: "running" }),
        makeObservedSpec({ id: "OBS-002", status: "needs_attention" }),
        makeObservedSpec({ id: "OBS-003", status: "done" }),
        makeObservedSpec({ id: "OBS-004", status: "abandoned" }),
      ] })],
      false,
    );
    const buckets = bucketByColumn(items);
    expect(buckets.running.map((i) => i.spec.id)).toEqual(["OBS-001"]);
    expect(buckets.attention.map((i) => i.spec.id)).toEqual(["OBS-002"]);
    expect(buckets.done.map((i) => i.spec.id)).toEqual(["OBS-003", "OBS-004"]);
  });

  it("resultado tem exatamente as 3 chaves (attention, running, done)", () => {
    const buckets = bucketByColumn([]);
    expect(Object.keys(buckets).sort()).toEqual(["attention", "done", "running"]);
  });
});

// ─── COLUMN_DEFS ───────────────────────────────────────────────────────────────

describe("COLUMN_DEFS (observed)", () => {
  it("tem 3 colunas na ordem certa", () => {
    expect(COLUMN_DEFS.map((c) => c.key)).toEqual(["attention", "running", "done"]);
  });
  it("labels em português", () => {
    expect(COLUMN_DEFS[0].label).toBe("Precisa de você");
    expect(COLUMN_DEFS[1].label).toBe("Em andamento");
    expect(COLUMN_DEFS[2].label).toBe("Pronto");
  });
});
