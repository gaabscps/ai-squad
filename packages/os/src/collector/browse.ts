import { realpath, readdir, stat } from "node:fs/promises";
import { basename, join, relative, isAbsolute } from "node:path";

export interface DirEntry {
  name: string;
  path: string;
  hasAgentSession: boolean;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function outsideHomeError(): Error & { code: string } {
  const err = new Error("path fora do home do usuário") as Error & { code: string };
  err.code = "OUTSIDE_HOME";
  return err;
}

function notADirError(path: string): Error & { code: string } {
  const err = new Error(`path não existe ou não é diretório: ${path}`) as Error & { code: string };
  err.code = "NOT_A_DIR";
  return err;
}

/**
 * Lista subdiretórios imediatos de `path`, confinado ao `homeDir`.
 * Resolve via realpath antes da checagem para barrar symlinks que escapam do home.
 */
export async function listDirs(path: string, homeDir: string): Promise<DirEntry[]> {
  const resolvedHome = await realpath(homeDir).catch(() => homeDir);
  const resolved = await realpath(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") throw notADirError(path);
    throw outsideHomeError();
  });

  if (!isInside(resolvedHome, resolved)) {
    throw outsideHomeError();
  }

  let entries: string[];
  try {
    entries = await readdir(resolved);
  } catch {
    return [];
  }

  const result: DirEntry[] = [];
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const fullPath = join(resolved, name);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;

    let hasAgentSession = false;
    try {
      const sessionStat = await stat(join(fullPath, ".agent-session"));
      hasAgentSession = sessionStat.isDirectory();
    } catch {
      hasAgentSession = false;
    }

    result.push({ name: basename(fullPath), path: fullPath, hasAgentSession });
  }

  return result;
}

/**
 * Valida que `path` é um repositório seguro para adicionar a `config.include`.
 * Lança erro com `code` em qualquer falha de validação.
 * Retorna o caminho canônico (realpath) para uso no dedup e na inserção.
 */
export async function resolveAddablePath(path: string, homeDir: string): Promise<string> {
  const resolvedHome = await realpath(homeDir).catch(() => homeDir);

  let resolved: string;
  try {
    resolved = await realpath(path);
  } catch {
    throw notADirError(path);
  }

  let s;
  try {
    s = await stat(resolved);
  } catch {
    throw notADirError(path);
  }

  if (!s.isDirectory()) {
    throw notADirError(path);
  }

  if (!isInside(resolvedHome, resolved)) {
    throw outsideHomeError();
  }

  let sessionStat;
  try {
    sessionStat = await stat(join(resolved, ".agent-session"));
  } catch {
    const err = new Error("diretório não contém .agent-session/") as Error & { code: string };
    err.code = "NO_AGENT_SESSION";
    throw err;
  }

  if (!sessionStat.isDirectory()) {
    const err = new Error(".agent-session existe mas não é diretório") as Error & { code: string };
    err.code = "NO_AGENT_SESSION";
    throw err;
  }

  return resolved;
}
