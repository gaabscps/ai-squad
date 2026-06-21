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
const MAX_TRANSCRIPT_CHARS = 100000;

/** true se o comando é uma verificação real (teste/build/lint/typecheck), não exploração. */
export function isVerificationCmd(cmd: string): boolean {
  return VERIFY_RE.test(cmd);
}

/** true se o content é um envelope de tool_result (saída de comando, não diálogo). */
function isToolResultContent(content: unknown): boolean {
  return Array.isArray(content) && content.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result");
}

/** Extrai o texto de diálogo de um content: string direta ou blocos type:"text". */
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
      const t = (b as { text?: string }).text;
      if (typeof t === "string" && t.trim()) parts.push(t.trim());
    }
  }
  return parts.join("\n");
}

/** Reúne todos os transcript_path distintos das sessões de chat adotadas pelo contrato. */
function collectTranscriptPaths(sessionDir: string, readFile: (p: string) => string, readDir: (p: string) => string[]): string[] {
  const paths: string[] = [];
  try {
    const costs = join(sessionDir, "costs");
    for (const name of readDir(costs).filter((n) => n.startsWith("session-") && n.endsWith(".json")).sort()) {
      try {
        const data = JSON.parse(readFile(join(costs, name))) as { transcript_path?: string };
        if (data.transcript_path && !paths.includes(data.transcript_path)) paths.push(data.transcript_path);
      } catch { continue; }
    }
  } catch { return []; }
  return paths;
}

/** Lê os transcripts de TODAS as sessões e devolve o diálogo (usuário + assistente), sem tool_result/tool_use, com teto. */
function distillTranscript(sessionDir: string, deps: SourceDeps): string {
  const readFile = deps.readFileFn ?? ((p: string) => readFileSync(p, "utf8"));
  const readDir = deps.readDirFn ?? ((p: string) => readdirSync(p));
  const paths = collectTranscriptPaths(sessionDir, readFile, readDir);
  if (paths.length === 0) return "";
  const out: string[] = [];
  for (const tp of paths) {
    let raw: string;
    try { raw = readFile(tp); } catch { continue; }
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      let o: { type?: string; message?: { content?: unknown } };
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type === "assistant") {
        const t = textFromContent(o.message?.content);
        if (t) out.push(`Assistente: ${t}`);
      } else if (o.type === "user") {
        const content = o.message?.content;
        if (isToolResultContent(content)) continue;
        const t = textFromContent(content);
        if (t) out.push(`Usuário: ${t}`);
      }
    }
  }
  return out.join("\n\n").slice(0, MAX_TRANSCRIPT_CHARS);
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
