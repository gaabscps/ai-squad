import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export interface CachedSummary {
  text: string;
  generatedAt: string; // ISO
  fingerprint: string;
  costUsd: number | null; // custo em $ reportado pelo CLI nessa geração
}

// O caminho inclui projectId porque specId/taskId (FEAT-001/T-001) NÃO são únicos
// entre projetos — sem o projectId, o FEAT-001 de um projeto sobrescreveria o de outro.
function fileFor(cacheRoot: string, projectId: string, specId: string, taskId: string): string {
  return join(cacheRoot, "summaries", projectId, specId, `${taskId}.json`);
}

/** Lê o resumo cacheado, ou null se não existe / está corrompido. Nunca lança. */
export function readSummary(cacheRoot: string, projectId: string, specId: string, taskId: string): CachedSummary | null {
  const file = fileFor(cacheRoot, projectId, specId, taskId);
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
  projectId: string,
  specId: string,
  taskId: string,
  data: { text: string; fingerprint: string; costUsd: number | null },
  now: () => string,
): CachedSummary {
  const file = fileFor(cacheRoot, projectId, specId, taskId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedSummary = { text: data.text, fingerprint: data.fingerprint, costUsd: data.costUsd, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
