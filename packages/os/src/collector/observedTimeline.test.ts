import { describe, it, expect } from "vitest";
import { buildMarkers } from "./observedTimeline.js";
import type { ObservedDecision, ObservedEvidence } from "../store/types.js";

const dec = (what: string, at: string | null): ObservedDecision & { at?: string | null } =>
  ({ what, why: null, rejected: null, ref: null, at });
const ev = (cmd: string, at: string | null): ObservedEvidence & { at?: string | null } =>
  ({ cmd, result: "ok", kind: null, at });

describe("buildMarkers — união ordenada", () => {
  it("ordena marcos exatos por timestamp", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z",
      closedAt: "2026-06-13T15:00:00Z",
      decisions: [], evidence: [],
      edits: [{ at: "2026-06-13T14:30:00Z", file: "a.ts" }],
      diffFiles: [{ path: "a.ts", added: 3, removed: 1, patch: "p" }],
      attentionKind: null,
      blocks: [],
    });
    expect(markers.map(m => m.kind)).toEqual(["open", "edit", "close"]);
  });

  it("agrupa edições próximas (mesmo gap) num único marco edit", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [],
      edits: [
        { at: "2026-06-13T14:10:00Z", file: "a.ts" },
        { at: "2026-06-13T14:10:05Z", file: "b.ts" },
      ],
      diffFiles: [], attentionKind: null,
      blocks: [],
    });
    const edits = markers.filter(m => m.kind === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0].editFiles!.map(f => f.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("decisão com at é posicionada; sem at entra por inserção (exact=false)", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [dec("usa JWT", null)], evidence: [],
      edits: [], diffFiles: [], attentionKind: null,
      blocks: [],
    });
    const d = markers.find(m => m.kind === "decision")!;
    expect(d.exact).toBe(false);
    expect(d.decision!.what).toBe("usa JWT");
  });

  it("anexa patch/counts do diff.json ao editFile por path", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [],
      edits: [{ at: "2026-06-13T14:10:00Z", file: "a.ts" }],
      diffFiles: [{ path: "a.ts", added: 7, removed: 2, patch: "@@..." }],
      attentionKind: null,
      blocks: [],
    });
    const f = markers.find(m => m.kind === "edit")!.editFiles![0];
    expect(f.added).toBe(7);
    expect(f.patch).toBe("@@...");
  });

  it("sessão vazia (sem nada) retorna só open", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [], edits: [], diffFiles: [], attentionKind: null,
      blocks: [],
    });
    expect(markers.map(m => m.kind)).toEqual(["open"]);
  });
});

describe("buildMarkers — marcos block", () => {
  it("emite um marco block pareando blocked→resumed com duração", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [], edits: [], diffFiles: [], attentionKind: null,
      blocks: [
        { at: "2026-06-13T14:20:00Z", event: "blocked", kind: "input" },
        { at: "2026-06-13T14:35:00Z", event: "resumed" },
      ],
    });
    const blockMarkers = markers.filter(m => m.kind === "block");
    expect(blockMarkers).toHaveLength(1);
    expect(blockMarkers[0].at).toBe("2026-06-13T14:20:00Z");
    expect(blockMarkers[0].blockMs).toBe(900_000); // 15 min
  });

  it("bloqueio em aberto (sem resumed) → blockMs null", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [], edits: [], diffFiles: [], attentionKind: null,
      blocks: [{ at: "2026-06-13T14:20:00Z", event: "blocked", kind: "input" }],
    });
    const blockMarkers = markers.filter(m => m.kind === "block");
    expect(blockMarkers).toHaveLength(1);
    expect(blockMarkers[0].blockMs).toBeNull();
  });

  it("block marker é ordenado entre open e close por timestamp", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: "2026-06-13T15:00:00Z",
      decisions: [], evidence: [], edits: [], diffFiles: [], attentionKind: null,
      blocks: [
        { at: "2026-06-13T14:20:00Z", event: "blocked", kind: "input" },
        { at: "2026-06-13T14:35:00Z", event: "resumed" },
      ],
    });
    expect(markers.map(m => m.kind)).toEqual(["open", "block", "close"]);
  });

  it("dois bloqueios → dois marcos block", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [], edits: [], diffFiles: [], attentionKind: null,
      blocks: [
        { at: "2026-06-13T14:10:00Z", event: "blocked", kind: "input" },
        { at: "2026-06-13T14:15:00Z", event: "resumed" },
        { at: "2026-06-13T14:40:00Z", event: "blocked", kind: "input" },
        { at: "2026-06-13T14:50:00Z", event: "resumed" },
      ],
    });
    const blockMarkers = markers.filter(m => m.kind === "block");
    expect(blockMarkers).toHaveLength(2);
  });
});
