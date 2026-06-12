import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CachedSpecSummary {
  text: string;
  generatedAt: string;
  fingerprint: string;
  costUsd: number | null;
  modelId: string | null;
}

function fileFor(cacheRoot: string, projectId: string, specId: string): string {
  return join(cacheRoot, "spec-summaries", projectId, specId, "summary.json");
}

/** Lê o resumo de spec cacheado, ou null se não existe / está corrompido. Nunca lança. */
export function readSpecSummary(cacheRoot: string, projectId: string, specId: string): CachedSpecSummary | null {
  const file = fileFor(cacheRoot, projectId, specId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedSpecSummary;
    if (typeof parsed?.text === "string" && typeof parsed?.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava o resumo de spec e devolve o objeto salvo com generatedAt carimbado. */
export function writeSpecSummary(
  cacheRoot: string,
  projectId: string,
  specId: string,
  data: { text: string; fingerprint: string; costUsd: number | null; modelId: string | null },
  now: () => string,
): CachedSpecSummary {
  const file = fileFor(cacheRoot, projectId, specId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedSpecSummary = {
    text: data.text,
    fingerprint: data.fingerprint,
    costUsd: data.costUsd,
    modelId: data.modelId,
    generatedAt: now(),
  };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
