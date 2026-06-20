import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import type { ObservedMeta } from "../store/types.js";

export interface NarrativeSource {
  intent: string;
  edits: { path: string; added: number | null; removed: number | null; patch: string | null }[];
  runs: string[];
  verifications: string[];
  decisions: { what: string; why: string | null; rejected: string | null }[];
  reasoning: string;
}

interface SourceDeps {
  readFileFn?: (p: string) => string;
  readDirFn?: (p: string) => string[];
}

const VERIFY_RE = /\b(vitest|jest|pytest|tsc|--noEmit|node --check|eslint|lint|npm run build|npm test|cargo test|go test|pyright|mypy)\b/;
const MAX_REASONING_CHARS = 12000;

/** true se o comando é uma verificação real (teste/build/lint/typecheck), não exploração. */
export function isVerificationCmd(cmd: string): boolean {
  return VERIFY_RE.test(cmd);
}

/** Lê o transcript apontado por costs/session-*.json e devolve só os textos do assistente (raciocínio). */
function distillTranscript(sessionDir: string, deps: SourceDeps): string {
  const readFile = deps.readFileFn ?? ((p: string) => readFileSync(p, "utf8"));
  const readDir = deps.readDirFn ?? ((p: string) => readdirSync(p));
  let transcriptPath: string | null = null;
  try {
    const costs = join(sessionDir, "costs");
    for (const name of readDir(costs).filter((n) => n.startsWith("session-") && n.endsWith(".json")).sort()) {
      const data = JSON.parse(readFile(join(costs, name))) as { transcript_path?: string };
      if (data.transcript_path) { transcriptPath = data.transcript_path; break; }
    }
  } catch { return ""; }
  if (!transcriptPath) return "";
  let raw: string;
  try { raw = readFile(transcriptPath); } catch { return ""; }
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let o: { type?: string; message?: { content?: unknown } };
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== "assistant") continue;
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
        const t = (block as { text?: string }).text;
        if (typeof t === "string" && t.trim()) out.push(t.trim());
      }
    }
  }
  return out.join("\n\n").slice(0, MAX_REASONING_CHARS);
}

/** Monta a fonte da narrativa a partir do Store (markers) + transcript destilado. */
export function buildNarrativeSource(observed: ObservedMeta, sessionDir: string, deps: SourceDeps = {}): NarrativeSource {
  const edits: NarrativeSource["edits"] = [];
  const runs: string[] = [];
  const verifications: string[] = [];
  const decisions: NarrativeSource["decisions"] = [];

  for (const m of observed.markers) {
    if (m.kind === "edit" && m.editFiles) {
      for (const f of m.editFiles) edits.push({ path: f.path, added: f.added, removed: f.removed, patch: f.patch });
    } else if (m.kind === "run" && m.note) {
      runs.push(m.note);
      if (isVerificationCmd(m.note)) verifications.push(m.note);
    } else if (m.kind === "decision" && m.decision) {
      decisions.push({ what: m.decision.what, why: m.decision.why, rejected: m.decision.rejected });
    } else if (m.kind === "verify" && m.evidence?.cmd) {
      verifications.push(m.evidence.result ? `${m.evidence.cmd} -> ${m.evidence.result}` : m.evidence.cmd);
    }
  }
  for (const e of observed.evidence) {
    if (e.cmd) verifications.push(e.result ? `${e.cmd} -> ${e.result}` : e.cmd);
  }
  for (const d of observed.decisions) decisions.push({ what: d.what, why: d.why, rejected: d.rejected });

  return {
    intent: observed.intent,
    edits,
    runs,
    verifications: [...new Set(verifications)],
    decisions,
    reasoning: distillTranscript(sessionDir, deps),
  };
}
