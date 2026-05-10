/**
 * AgentOps observability extractor — scan.ts
 * Discovers valid session directories under rootDir matching the given prefix pattern(s).
 */

import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';

/**
 * Scans rootDir for subdirectories matching the given sessionPrefix (string or
 * array of strings) that contain at least a session.yml file. Returns absolute
 * paths sorted by name (ascending) for idempotency. Tolerates rootDir not
 * existing (returns []).
 */
export async function scan(rootDir: string, sessionPrefix: string | string[]): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    // rootDir does not exist or is not readable
    return [];
  }

  const prefixes = Array.isArray(sessionPrefix) ? sessionPrefix : [sessionPrefix];

  if (prefixes.some((p) => p === '')) {
    throw new RangeError('agentops: sessionPrefix cannot be an empty string.');
  }

  const candidates = entries
    .filter((e) => e.isDirectory() && prefixes.some((p) => e.name.startsWith(p)))
    .map((e) => path.resolve(rootDir, e.name));

  const valid: string[] = [];
  await Promise.all(
    candidates.map(async (sessionPath) => {
      const sessionYmlPath = path.join(sessionPath, 'session.yml');
      try {
        await fs.access(sessionYmlPath);
        valid.push(sessionPath);
      } catch {
        // No session.yml — skip
      }
    }),
  );

  return valid.sort();
}

/**
 * Returns the actionable error message to emit when scan produces zero results.
 * Callers (e.g. the report command) use this to print a consistent message and
 * exit with a non-zero code.
 */
export function formatEmptyScanMessage(prefix: string | string[], rootDir: string): string {
  const prefixDisplay = Array.isArray(prefix) ? prefix.join('|') : prefix;
  return `agentops: no sessions found matching prefix '${prefixDisplay}' in '${rootDir}'. Check your .agentops.json.`;
}

export class EmptyScanError extends Error {
  constructor(
    public readonly prefix: string | string[],
    public readonly rootDir: string,
  ) {
    super(formatEmptyScanMessage(prefix, rootDir));
    this.name = 'EmptyScanError';
  }
}
