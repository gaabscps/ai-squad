import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AiosConfig {
  roots: string[]; // pastas-raiz pra auto-scan
  include: string[]; // paths avulsos de projeto, fora das roots
  hide: string[]; // names ou paths de projeto a ocultar (persistido)
  archiveAfterDays: number; // dias após concluir até a feature done sair do board
}

const DEFAULTS: AiosConfig = { roots: [], include: [], hide: [], archiveAfterDays: 7 };

/** Expande um ~ inicial para o home do usuário (Node não faz isso sozinho). */
export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
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
    archiveAfterDays: raw.archiveAfterDays ?? 7,
  };
}

/**
 * Reescreve só o hide[] preservando roots/include. ÚNICA escrita do aiOS —
 * e no PRÓPRIO repo do aiOS (aios.config.json), nunca nos .agent-session/ alheios.
 */
export function saveHidden(configPath: string, hide: string[]): void {
  // Preserva roots/include crus (com ~ literal) de propósito: manter o arquivo
  // legível como o usuário escreveu. Contraste com loadConfig, que expande o ~.
  let current: Partial<AiosConfig> = {};
  if (existsSync(configPath)) {
    try {
      current = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      current = {}; // config corrompida: reescreve com roots/include vazios
    }
  }
  const next: AiosConfig = {
    roots: current.roots ?? [],
    include: current.include ?? [],
    hide,
    archiveAfterDays: current.archiveAfterDays ?? 7,
  };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + "\n", "utf-8");
}
