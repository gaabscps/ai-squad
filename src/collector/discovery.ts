import { readdirSync, existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Project, Spec } from "../store/types.js";
import { parseSession } from "./session.js";

export interface DiscoveryOptions {
  roots: string[]; // pastas-raiz pra auto-scan (subpastas diretas)
  include?: string[]; // paths avulsos de projeto, fora das roots
  hide?: string[]; // nomes (ou paths) de projeto a marcar hidden
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Lê todas as Sessions em <projectPath>/.agent-session/<id>/session.yml. */
function loadSpecs(projectPath: string): Spec[] {
  const agentDir = join(projectPath, ".agent-session");
  if (!existsSync(agentDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(agentDir);
  } catch {
    return []; // .agent-session ilegível: não derruba o scan inteiro
  }
  const specs: Spec[] = [];
  for (const entry of entries) {
    const specDir = join(agentDir, entry);
    if (!isDir(specDir)) continue;
    let spec;
    try {
      spec = parseSession(specDir);
    } catch {
      continue; // um spec ruim não derruba o scan dos outros
    }
    if (spec) specs.push(spec);
  }
  return specs;
}

function toProject(projectPath: string, hide: Set<string>): Project {
  const name = basename(projectPath);
  return {
    id: name,
    path: projectPath,
    name,
    specs: loadSpecs(projectPath),
    hidden: hide.has(name) || hide.has(projectPath),
  };
}

/**
 * Descoberta híbrida: auto-scan das subpastas diretas de cada root que tenham
 * .agent-session/, mais os paths avulsos de include[]. Dedup por path. Read-only.
 */
export function discoverProjects(opts: DiscoveryOptions): Project[] {
  const hide = new Set(opts.hide ?? []);
  const found = new Set<string>();

  for (const root of opts.roots) {
    if (!isDir(root)) continue;
    for (const entry of readdirSync(root)) {
      const candidate = resolve(root, entry);
      if (!isDir(candidate)) continue;
      if (existsSync(join(candidate, ".agent-session"))) {
        found.add(candidate);
      }
    }
  }

  for (const p of opts.include ?? []) {
    const abs = resolve(p);
    if (isDir(abs) && existsSync(join(abs, ".agent-session"))) found.add(abs);
  }

  return [...found].map((p) => toProject(p, hide));
}
