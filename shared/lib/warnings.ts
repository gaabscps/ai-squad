/**
 * shared/lib/warnings.ts — structured warning helper for ai-squad hooks.
 *
 * Exposes appendWarning() for writing entries to
 * .agent-session/<task_id>/warnings.json in a schema-consistent,
 * atomic, append-only manner.
 *
 * Schema (warnings.json):
 *   {
 *     "schema_version": 1,
 *     "warnings": [
 *       {
 *         "id": "<uuid>",
 *         "timestamp": "<iso8601>",
 *         "source": "<caller>",
 *         "reason": "<short_snake_case>",
 *         "severity": "info|warning|error",
 *         "metadata": {<arbitrary>}
 *       }
 *     ]
 *   }
 *
 * Security: taskId is validated against /^(FEAT|DISC)-\d{3,4}$/ before any file op.
 * PII must NOT be placed in metadata.
 * Concurrency: lockfile via fs.openSync(wx) with retry-backoff (mirrors Python's fcntl.LOCK_EX).
 * Atomic write: tmp + rename pattern for cross-platform safety.
 * Pure Node.js stdlib (fs, crypto, path). No extra dependencies.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Simple lockfile helpers — wx-flag + retry-backoff (mirrors fcntl.LOCK_EX).
// Max total wait: ~100ms across 5 attempts (10ms, 20ms, 20ms, 25ms, 25ms).
// ---------------------------------------------------------------------------

const LOCK_MAX_ATTEMPTS = 5;
const LOCK_DELAYS_MS = [10, 20, 20, 25, 25];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Acquire an exclusive lockfile at `lockPath`. Returns fd to release. */
async function acquireLock(lockPath: string): Promise<number> {
  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt++) {
    try {
      // O_CREAT | O_EXCL | O_WRONLY — fails if file exists (atomic on POSIX + Windows NTFS)
      const fd = fs.openSync(lockPath, 'wx');
      return fd;
    } catch {
      if (attempt < LOCK_MAX_ATTEMPTS - 1) {
        await sleep(LOCK_DELAYS_MS[attempt] ?? 20);
      }
    }
  }
  throw new Error(`acquireLock: could not acquire ${lockPath} after ${LOCK_MAX_ATTEMPTS} attempts`);
}

/** Release a lockfile previously acquired via acquireLock. */
function releaseLock(fd: number, lockPath: string): void {
  try {
    fs.closeSync(fd);
  } catch {
    // ignore close errors
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // lock may already be gone — ignore
  }
}

const TASK_ID_RE = /^(FEAT|DISC)-\d{3,4}$/;
const VALID_SEVERITIES = new Set(['info', 'warning', 'error']);
const SCHEMA_VERSION = 1;

export interface Warning {
  id: string;
  timestamp: string;
  source: string;
  reason: string;
  severity: 'info' | 'warning' | 'error';
  metadata: Record<string, unknown>;
}

export interface AppendWarningOptions {
  reason: string;
  source: string;
  metadata?: Record<string, unknown>;
  severity?: 'info' | 'warning' | 'error';
}

interface WarningsDoc {
  schema_version: number;
  warnings: Warning[];
}

/**
 * Locate .agent-session/ by walking upward from this file's directory.
 * Falls back to process.cwd() + '.agent-session' if not found.
 */
function findAgentSessionRoot(): string {
  let dir = path.dirname(path.resolve(__filename));
  const maxDepth = 20;
  for (let i = 0; i < maxDepth; i++) {
    const candidate = path.join(dir, '.agent-session');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), '.agent-session');
}

/**
 * Append a warning entry to .agent-session/<taskId>/warnings.json.
 *
 * Uses an exclusive lockfile (wx flag + retry-backoff) to prevent the
 * read-modify-write race when two concurrent callers both read before either
 * writes. Mirrors Python's fcntl.LOCK_EX semantics.
 *
 * @param taskId  Session identifier, e.g. 'FEAT-003'. Must match /^(FEAT|DISC)-\d{3,4}$/.
 * @param opts    Warning fields: reason, source, metadata (no PII), severity.
 * @returns       The warning entry that was written.
 * @throws        Error if taskId is invalid or severity is not in allowed set.
 */
export async function appendWarning(taskId: string, opts: AppendWarningOptions): Promise<Warning> {
  if (!TASK_ID_RE.test(taskId)) {
    throw new Error(`Invalid taskId '${taskId}': must match /^(FEAT|DISC)-\\d{3,4}$/`);
  }
  const severity = opts.severity ?? 'warning';
  if (!VALID_SEVERITIES.has(severity)) {
    throw new Error(`Invalid severity '${severity}': must be one of info, warning, error`);
  }

  const agentSessionRoot = findAgentSessionRoot();
  const taskDir = path.join(agentSessionRoot, taskId);
  const warningsPath = path.join(taskDir, 'warnings.json');
  const lockPath = warningsPath + '.lock';

  fs.mkdirSync(taskDir, { recursive: true });

  const entry: Warning = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    source: opts.source,
    reason: opts.reason,
    severity,
    metadata: opts.metadata ?? {},
  };

  const lockFd = await acquireLock(lockPath);
  try {
    let doc: WarningsDoc = { schema_version: SCHEMA_VERSION, warnings: [] };
    if (fs.existsSync(warningsPath)) {
      try {
        const raw = fs.readFileSync(warningsPath, 'utf-8').trim();
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            Array.isArray((parsed as Record<string, unknown>).warnings)
          ) {
            doc = parsed as WarningsDoc;
          }
        }
      } catch {
        // malformed file — start fresh
        doc = { schema_version: SCHEMA_VERSION, warnings: [] };
      }
    }

    doc.schema_version = SCHEMA_VERSION;
    doc.warnings.push(entry);

    const tmp = warningsPath + '.tmp-' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf-8');
    fs.renameSync(tmp, warningsPath);
  } finally {
    releaseLock(lockFd, lockPath);
  }

  return entry;
}
