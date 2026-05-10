/**
 * AgentOps observability extractor — parse.ts
 * Reads session.yml, dispatch-manifest.json, outputs/*.json, and spec.md
 * from a session directory and returns a RawSession.
 *
 * Strategy (Plan D9–D12):
 *  - session.yml: js-yaml; throws if file missing or YAML invalid.
 *  - dispatch-manifest.json: JSON.parse in try/catch; null on failure.
 *  - outputs/*.json: each parsed individually; on failure data = null and
 *    the output entry is skipped (best-effort — AC-019).
 *  - spec.md: raw text; null if absent.
 */

import fs from 'fs/promises';
import path from 'path';

import yaml from 'js-yaml';

import type { RawSession } from './types';

// ---------------------------------------------------------------------------
// Type guards (Plan D11) — no `as` casts on uncertain shapes
// ---------------------------------------------------------------------------

function isRecord(o: unknown): o is Record<string, unknown> {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type OutputEntry = { filename: string; data: unknown } | null;

async function readOutputFiles(sessionPath: string): Promise<RawSession['outputs']> {
  const outputsDir = path.join(sessionPath, 'outputs');
  let files: string[];
  try {
    files = await fs.readdir(outputsDir);
  } catch {
    return [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json')).sort();

  const results: OutputEntry[] = await Promise.all(
    jsonFiles.map(async (filename): Promise<OutputEntry> => {
      const data = await readJsonFile(path.join(outputsDir, filename));
      // Only include successfully-parsed outputs
      if (data !== null) {
        return { filename, data };
      }
      return null;
    }),
  );

  return results.filter((r): r is { filename: string; data: unknown } => r !== null);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses all artefacts in sessionPath into a RawSession.
 * Throws if session.yml is missing or YAML-invalid (per spec AC-019 —
 * callers should catch and warn-and-skip that session).
 */
export async function parse(sessionPath: string): Promise<RawSession> {
  const taskId = path.basename(sessionPath);

  // --- session.yml (mandatory; throws on failure) ---
  const sessionYmlPath = path.join(sessionPath, 'session.yml');
  const sessionYmlText = await fs.readFile(sessionYmlPath, 'utf-8');
  const sessionYml = yaml.load(sessionYmlText);

  if (isRecord(sessionYml)) {
    // If task_id is present in YAML use it; otherwise fall back to dir name
    const ymlTaskId = sessionYml.task_id;
    if (typeof ymlTaskId === 'string' && ymlTaskId.length > 0) {
      // Use the canonical taskId from the YAML
      const canonicalTaskId = ymlTaskId;
      const manifest = await readJsonFile(path.join(sessionPath, 'dispatch-manifest.json'));
      const outputs = await readOutputFiles(sessionPath);
      const specMd = await readSpecMd(sessionPath);
      return {
        taskId: canonicalTaskId,
        sessionYml,
        manifest,
        outputs,
        specMd,
        sessionDirPath: sessionPath,
      };
    }
  }

  // Fall through: sessionYml parsed but has no task_id — still return with
  // dirName as taskId (best-effort)
  const manifest = await readJsonFile(path.join(sessionPath, 'dispatch-manifest.json'));
  const outputs = await readOutputFiles(sessionPath);
  const specMd = await readSpecMd(sessionPath);

  return {
    taskId,
    sessionYml,
    manifest,
    outputs,
    specMd,
    sessionDirPath: sessionPath,
  };
}

async function readSpecMd(sessionPath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(sessionPath, 'spec.md'), 'utf-8');
  } catch {
    return null;
  }
}
