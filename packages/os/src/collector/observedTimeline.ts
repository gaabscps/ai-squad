import type {
  ObservedMarker, ObservedDecision, ObservedEvidence, ObservedEditFile,
} from "../store/types.js";

export interface EditEvent { at: string; file: string; }
export interface DiffFile { path: string; added: number | null; removed: number | null; patch: string | null; }
export interface BlockEvent { at: string; event: string; kind?: string | null; }
export interface TrailEvent { at: string; tool: string; summary: string; }

export interface MarkerSources {
  createdAt: string | null;
  closedAt: string | null;
  decisions: (ObservedDecision & { at?: string | null })[];
  evidence: (ObservedEvidence & { at?: string | null })[];
  edits: EditEvent[];
  diffFiles: DiffFile[];
  attentionKind: string | null;
  blocks: BlockEvent[];
  trail?: TrailEvent[];
}

// Edições com gap <= EDIT_GROUP_GAP_MS caem no mesmo marco "Editou".
const EDIT_GROUP_GAP_MS = 120_000; // 2 min

function diffLookup(diffFiles: DiffFile[]): Map<string, DiffFile> {
  return new Map(diffFiles.map(f => [f.path, f]));
}

function groupEdits(edits: EditEvent[], diff: Map<string, DiffFile>): ObservedMarker[] {
  const sorted = [...edits].sort((a, b) => a.at.localeCompare(b.at));
  const groups: EditEvent[][] = [];
  for (const e of sorted) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && Date.parse(e.at) - Date.parse(prev.at) <= EDIT_GROUP_GAP_MS) {
      last.push(e);
    } else {
      groups.push([e]);
    }
  }
  return groups.map((g) => {
    const files: ObservedEditFile[] = [];
    const seen = new Set<string>();
    for (const e of g) {
      if (seen.has(e.file)) continue;
      seen.add(e.file);
      const d = diff.get(e.file);
      files.push({
        path: e.file,
        added: d?.added ?? null,
        removed: d?.removed ?? null,
        patch: d?.patch ?? null,
      });
    }
    return {
      kind: "edit" as const, at: g[0].at, exact: true, note: null,
      decision: null, evidence: null, editFiles: files, blockMs: null,
    };
  });
}

function groupBlocks(blocks: BlockEvent[]): ObservedMarker[] {
  const sorted = [...blocks].sort((a, b) => a.at.localeCompare(b.at));
  const markers: ObservedMarker[] = [];
  let open: BlockEvent | null = null;
  for (const b of sorted) {
    if (b.event === "blocked") {
      open = b;
    } else if (b.event === "resumed" && open) {
      const ms = Date.parse(b.at) - Date.parse(open.at);
      markers.push({
        kind: "block", at: open.at, exact: true, note: null,
        decision: null, evidence: null, editFiles: null,
        blockMs: ms >= 0 ? ms : null,
      });
      open = null;
    }
  }
  if (open) {  // bloqueio em aberto: ainda aguardando
    markers.push({
      kind: "block", at: open.at, exact: true, note: null,
      decision: null, evidence: null, editFiles: null, blockMs: null,
    });
  }
  return markers;
}

function runMarkers(trail: TrailEvent[]): ObservedMarker[] {
  return trail.map((t) => ({
    kind: "run" as const, at: t.at, exact: true, note: t.summary,
    decision: null, evidence: null, editFiles: null, blockMs: null,
  }));
}

/** Une as fontes carimbadas numa timeline ordenada de marcos. */
export function buildMarkers(s: MarkerSources): ObservedMarker[] {
  const diff = diffLookup(s.diffFiles);
  const exact: ObservedMarker[] = [];

  if (s.createdAt) {
    exact.push({ kind: "open", at: s.createdAt, exact: true, note: "aberto",
      decision: null, evidence: null, editFiles: null, blockMs: null });
  }
  exact.push(...groupEdits(s.edits, diff));
  exact.push(...groupBlocks(s.blocks));
  exact.push(...runMarkers(s.trail ?? []));
  if (s.closedAt) {
    exact.push({ kind: "close", at: s.closedAt, exact: true, note: "fechado",
      decision: null, evidence: null, editFiles: null, blockMs: null });
  }

  // Marcos exatos com timestamp: ordenados por at.
  const withAtDecisions: ObservedMarker[] = [];
  const looseDecisions: ObservedMarker[] = [];
  for (const d of s.decisions) {
    const m: ObservedMarker = {
      kind: "decision", at: d.at ?? null, exact: Boolean(d.at), note: null,
      decision: d, evidence: null, editFiles: null, blockMs: null,
    };
    (d.at ? withAtDecisions : looseDecisions).push(m);
  }
  for (const e of s.evidence) {
    const m: ObservedMarker = {
      kind: "verify", at: e.at ?? null, exact: Boolean(e.at), note: null,
      decision: null, evidence: e, editFiles: null, blockMs: null,
    };
    (e.at ? withAtDecisions : looseDecisions).push(m);
  }

  const timed = [...exact, ...withAtDecisions]
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));

  // Best-effort sem hora: ancorados ao fim (ordem de inserção), antes do close.
  if (looseDecisions.length === 0) return timed;
  const closeIdx = timed.findIndex(m => m.kind === "close");
  if (closeIdx === -1) return [...timed, ...looseDecisions];
  return [...timed.slice(0, closeIdx), ...looseDecisions, ...timed.slice(closeIdx)];
}
