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
    });
    const f = markers.find(m => m.kind === "edit")!.editFiles![0];
    expect(f.added).toBe(7);
    expect(f.patch).toBe("@@...");
  });

  it("sessão vazia (sem nada) retorna só open", () => {
    const markers = buildMarkers({
      createdAt: "2026-06-13T14:00:00Z", closedAt: null,
      decisions: [], evidence: [], edits: [], diffFiles: [], attentionKind: null,
    });
    expect(markers.map(m => m.kind)).toEqual(["open"]);
  });
});
