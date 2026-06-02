import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CachedDiagnosis {
  text: string;
  generatedAt: string;
  fingerprint: string;
  costUsd: number | null;
}

// Inclui projectId porque specId (FEAT-001) NÃO é único entre projetos.
function fileFor(cacheRoot: string, projectId: string, specId: string): string {
  return join(cacheRoot, "diagnoses", projectId, `${specId}.json`);
}

/** Lê o diagnóstico cacheado, ou null se não existe / está corrompido. Nunca lança. */
export function readDiagnosis(cacheRoot: string, projectId: string, specId: string): CachedDiagnosis | null {
  const file = fileFor(cacheRoot, projectId, specId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedDiagnosis;
    if (typeof parsed?.text === "string" && typeof parsed?.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava o diagnóstico e devolve o registro (com generatedAt carimbado pelo `now`). */
export function writeDiagnosis(
  cacheRoot: string,
  projectId: string,
  specId: string,
  data: { text: string; fingerprint: string; costUsd: number | null },
  now: () => string,
): CachedDiagnosis {
  const file = fileFor(cacheRoot, projectId, specId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedDiagnosis = { text: data.text, fingerprint: data.fingerprint, costUsd: data.costUsd, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
