import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { SessionNarrative } from "./types.js";

export interface CachedNarrative {
  narrative: SessionNarrative;
  generatedAt: string;
  fingerprint: string;
  costUsd: number | null;
}

function fileFor(cacheRoot: string, projectId: string, specId: string): string {
  return join(cacheRoot, "narratives", projectId, `${specId}.json`);
}

/** Lê a narrativa cacheada, ou null se ausente/corrompida. Nunca lança. */
export function readNarrative(cacheRoot: string, projectId: string, specId: string): CachedNarrative | null {
  const file = fileFor(cacheRoot, projectId, specId);
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedNarrative;
    if (parsed?.narrative && typeof parsed.fingerprint === "string") return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Grava a narrativa e devolve o registro salvo (com generatedAt carimbado pelo `now`). */
export function writeNarrative(
  cacheRoot: string, projectId: string, specId: string,
  data: { narrative: SessionNarrative; fingerprint: string; costUsd: number | null },
  now: () => string,
): CachedNarrative {
  const file = fileFor(cacheRoot, projectId, specId);
  mkdirSync(dirname(file), { recursive: true });
  const record: CachedNarrative = { narrative: data.narrative, fingerprint: data.fingerprint, costUsd: data.costUsd, generatedAt: now() };
  writeFileSync(file, JSON.stringify(record), "utf8");
  return record;
}
