import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AiosConfig {
  roots: string[]; // pastas-raiz pra auto-scan
  include: string[]; // paths avulsos de projeto, fora das roots
  hide: string[]; // names ou paths de projeto a ocultar (persistido)
}

const DEFAULTS: AiosConfig = { roots: [], include: [], hide: [] };

/** Expande um ~ inicial para o home do usuário (Node não faz isso sozinho). */
export function expandTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** Lê aios.config.json; devolve defaults se ausente ou inválido. Paths com ~ expandidos. */
export function loadConfig(configPath: string): AiosConfig {
  if (!existsSync(configPath)) return { ...DEFAULTS };
  let raw: Partial<AiosConfig>;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return { ...DEFAULTS }; // config corrompida: não derruba o servidor, não inventa nada
  }
  return {
    roots: (raw.roots ?? []).map(expandTilde),
    include: (raw.include ?? []).map(expandTilde),
    hide: raw.hide ?? [],
  };
}

/**
 * Reescreve só o hide[] preservando roots/include. ÚNICA escrita do aiOS —
 * e no PRÓPRIO repo do aiOS (aios.config.json), nunca nos .agent-session/ alheios.
 */
export function saveHidden(configPath: string, hide: string[]): void {
  const current: Partial<AiosConfig> = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf-8"))
    : {};
  const next: AiosConfig = {
    roots: current.roots ?? [],
    include: current.include ?? [],
    hide,
  };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
}
