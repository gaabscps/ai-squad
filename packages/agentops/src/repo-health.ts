/**
 * AgentOps observability extractor — repo-health.ts
 * T-012: reads quality metric files from reports/ and returns RepoHealth snapshot.
 * AC-024, AC-028, AC-032, AC-034.
 *
 * readRepoHealth(reportsDir, depCruiseConfigPath?) → Promise<RepoHealth | null>
 */

import fs from 'fs/promises';
import path from 'path';

import type { RepoHealth } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readJson(filePath: string): Promise<unknown> {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(o: unknown): o is Record<string, unknown> {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

// ---------------------------------------------------------------------------
// Stryker mutation.json parser
// ---------------------------------------------------------------------------

// Statuses counted toward the mutation score denominator (Stryker convention):
// killed + survived + noCoverage; CompileError/Timeout/RuntimeError excluded.
const COUNTED_STATUSES = new Set(['Killed', 'Survived', 'NoCoverage']);

function parseMutationJson(data: unknown): { score: number; killed: number; total: number } | null {
  if (!isRecord(data)) return null;

  // Aggregate across all files — works for both simplified fixtures (with top-level
  // mutationScore) and real Stryker v8 JSON (no top-level mutationScore field).
  const files = data.files;
  let killed = 0;
  let total = 0; // denominator: only counted statuses (Stryker convention)
  let hasFiles = false;

  if (isRecord(files)) {
    for (const fileKey of Object.keys(files)) {
      const fileData = files[fileKey];
      if (!isRecord(fileData)) continue;
      const mutants = fileData.mutants;
      if (!Array.isArray(mutants)) continue;
      for (const mutant of mutants) {
        if (!isRecord(mutant)) continue;
        hasFiles = true;
        const status = mutant.status;
        if (typeof status !== 'string') continue;
        if (!COUNTED_STATUSES.has(status)) continue; // exclude CompileError, Timeout, etc.
        total++;
        if (status === 'Killed') killed++;
      }
    }
  }

  // Use top-level mutationScore if present (simplified fixture format);
  // otherwise compute from files (real Stryker v8 schema).
  const scoreRaw = data.mutationScore;
  const score =
    typeof scoreRaw === 'number' ? scoreRaw : hasFiles && total > 0 ? (killed / total) * 100 : null;

  if (score === null) return null;

  return { score, killed, total };
}

// ---------------------------------------------------------------------------
// type-coverage.json parser
// ---------------------------------------------------------------------------

function parseTypeCoverageJson(data: unknown): { percent: number; anyCount: number } | null {
  if (!isRecord(data)) return null;

  const percent = data.percent;
  const anyCount = data.anyCount;

  if (typeof percent !== 'number') return null;
  if (typeof anyCount !== 'number') return null;

  return { percent, anyCount };
}

// ---------------------------------------------------------------------------
// dep-cruiser violations parser
// ---------------------------------------------------------------------------

function parseDepCruiserJson(data: unknown): { error: number; warn: number } | null {
  if (!isRecord(data)) return null;

  // dep-cruiser --output-type json emits { modules: [...], summary: { violations: [...] } }
  const summary = data.summary;
  if (!isRecord(summary)) return null;

  const violations = summary.violations;
  if (!Array.isArray(violations)) return null;

  let errorCount = 0;
  let warnCount = 0;

  for (const v of violations) {
    if (!isRecord(v)) continue;
    const rule = v.rule;
    if (!isRecord(rule)) continue;
    const severity = rule.severity;
    if (severity === 'error') errorCount++;
    else if (severity === 'warn') warnCount++;
  }

  return { error: errorCount, warn: warnCount };
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Reads quality metric files from reportsDir and assembles a RepoHealth snapshot.
 *
 * Inputs (all optional — graceful degradation if any absent):
 *   - ${reportsDir}/mutation/mutation.json       (Stryker output)
 *   - ${reportsDir}/type-coverage/type-coverage.json  (type-coverage-json.ts output)
 *   - ${reportsDir}/dep-cruiser/violations.json  (cached dep-cruiser --output-type json)
 *
 * Returns null if ALL three inputs are absent (AC-034).
 * Returns RepoHealth with null fields for missing inputs (graceful partial, AC-034).
 *
 * @param reportsDir - Absolute path to the reports directory.
 * @param depCruiseConfigPath - Optional path to dep-cruiser config (reserved for future live run; currently reads from cache file only).
 */
export async function readRepoHealth(
  reportsDir: string,
  depCruiseConfigPath?: string, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<RepoHealth | null> {
  const mutationPath = path.join(reportsDir, 'mutation', 'mutation.json');
  const typeCoveragePath = path.join(reportsDir, 'type-coverage', 'type-coverage.json');
  const depCruiserPath = path.join(reportsDir, 'dep-cruiser', 'violations.json');

  const [mutationData, typeCoverageData, depCruiserData] = await Promise.all([
    readJson(mutationPath),
    readJson(typeCoveragePath),
    readJson(depCruiserPath),
  ]);

  const mutation = parseMutationJson(mutationData);
  const typeCoverage = parseTypeCoverageJson(typeCoverageData);
  const depViolations = parseDepCruiserJson(depCruiserData);

  // AC-034: all absent → null
  if (mutation === null && typeCoverage === null && depViolations === null) {
    return null;
  }

  return {
    mutation,
    typeCoverage,
    depViolations,
    measuredAt: new Date().toISOString(),
  };
}
