import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CachedSummary {
  text: string;
  generatedAt: string; // ISO
  fingerprint: string;
}

function fileFor(cacheRoot: string, specId: string, taskId: string): string {
  return join(cacheRoot, "summaries", specId, `${taskId}.json`);
}

/** Lê o resumo cacheado, ou null se não existe / está corrompido. Nunca lança. */
export function readSummary(cacheRoot: string, specId: string, taskId: string): CachedSummary | null {
  const file = fileFor(cacheRoot, specId, taskId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedSummary;
    if (typeof parsed?.text === "string" && typeof parsed?.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava o resumo e devolve o objeto salvo (com generatedAt carimbado pelo `now`). */
export function writeSummary(
  cacheRoot: string,
  specId: string,
  taskId: string,
  data: { text: string; fingerprint: string },
  now: () => string,
): CachedSummary {
  const file = fileFor(cacheRoot, specId, taskId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedSummary = { text: data.text, fingerprint: data.fingerprint, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
