import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FeaturesOverlay } from "./collector/features.js";

export interface AiosConfig {
  roots: string[]; // pastas-raiz pra auto-scan
  include?: string[]; // paths avulsos de projeto, fora das roots
  hide: string[]; // names ou paths de projeto a ocultar (persistido)
  archiveAfterDays: number; // dias após concluir até a feature done sair do board
  features?: FeaturesOverlay; // overlay de correção manual da camada de feature (dono: OS)
}

const DEFAULTS: AiosConfig = { roots: [], include: [], hide: [], archiveAfterDays: 7, features: {} };

/**
 * Lê o config atual, faz merge dos campos fornecidos e persiste.
 * Tolerante: se o arquivo existir mas não puder ser lido/parseado, retorna
 * { persisted: false } sem tentar gravar (evita sobrescrever com defaults).
 * Erros de escrita também são capturados e retornam { persisted: false }.
 */
export async function saveConfigFields(
  fields: Partial<AiosConfig>,
  configPath: string,
): Promise<{ persisted: boolean }> {
  let current: Partial<AiosConfig> = {};
  if (existsSync(configPath)) {
    try {
      current = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      console.warn("[aiOS] saveConfigFields: não foi possível ler o config; gravação cancelada para preservar o estado.");
      return { persisted: false };
    }
  }
  try {
    writeFileSync(configPath, JSON.stringify({ ...DEFAULTS, ...current, ...fields }, null, 2) + "\n", "utf-8");
    return { persisted: true };
  } catch (err) {
    console.warn("[aiOS] saveConfigFields: falha ao gravar config —", (err as Error).message);
    return { persisted: false };
  }
}

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
    features: raw.features ?? {},
  };
}

/** Reescreve só o hide[] preservando os demais campos. */
export async function saveHidden(configPath: string, hide: string[]): Promise<void> {
  await saveConfigFields({ hide }, configPath);
}
