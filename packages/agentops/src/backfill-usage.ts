/**
 * backfill-usage.ts — retroactively adds per-dispatch usage estimates to
 * pre-FEAT-003 dispatch-manifest.json files.
 *
 * Reads `usage-backfill.json` (manual estimates from conversation log),
 * opens each `.agent-session/<task_id>/dispatch-manifest.json`,
 * and adds `pre_feat_003_backfilled_usage[]` — a SEPARATE field from
 * `actual_dispatches[].usage` to preserve historical integrity.
 *
 * IDEMPOTENT: running twice does not duplicate entries.
 *
 * AC-018 (FEAT-003).
 *
 * Usage: npm run agentops:backfill
 */

import fs from 'fs';
import path from 'path';

export interface BackfillJsonEntry {
  task_id: string;
  dispatch_id: string;
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
  model: string;
  backfill_source: 'conversation_log_estimate' | 'manual';
}

interface ManifestWithBackfill {
  pre_feat_003_backfilled_usage?: BackfillJsonEntry[];
  [key: string]: unknown;
}

/**
 * Reads and parses a JSON file. Returns null on failure.
 */
function readJsonFile(filePath: string): unknown {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Validates a BackfillJsonEntry shape.
 */
export function isBackfillJsonEntry(o: unknown): o is BackfillJsonEntry {
  if (typeof o !== 'object' || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.task_id === 'string' &&
    typeof r.dispatch_id === 'string' &&
    typeof r.total_tokens === 'number' &&
    typeof r.tool_uses === 'number' &&
    typeof r.duration_ms === 'number' &&
    typeof r.model === 'string' &&
    (r.backfill_source === 'conversation_log_estimate' || r.backfill_source === 'manual')
  );
}

/**
 * Applies backfill entries for a single task to its dispatch-manifest.json.
 * Returns true if the manifest was updated, false if it was already up-to-date or could not be read.
 */
export function applyBackfillToManifest(
  manifestPath: string,
  entries: BackfillJsonEntry[],
): boolean {
  const raw = readJsonFile(manifestPath);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    process.stderr.write(`[agentops:backfill] WARN: Cannot read manifest at ${manifestPath}\n`);
    return false;
  }

  const manifest = raw as ManifestWithBackfill;

  // Idempotency: check if the manifest already has all these dispatch_ids backfilled
  const existing = manifest.pre_feat_003_backfilled_usage ?? [];
  const existingIds = new Set(existing.map((e) => e.dispatch_id));

  const newEntries = entries.filter((e) => !existingIds.has(e.dispatch_id));

  if (newEntries.length === 0) {
    process.stdout.write(
      `[agentops:backfill] Already up-to-date: ${manifestPath} (${existing.length} entries)\n`,
    );
    return false;
  }

  const updated: ManifestWithBackfill = {
    ...manifest,
    pre_feat_003_backfilled_usage: [...existing, ...newEntries],
  };

  // Atomic write: write to tmp then rename
  const tmpPath = manifestPath + '.backfill.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(updated, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, manifestPath);

  process.stdout.write(
    `[agentops:backfill] Updated: ${manifestPath} (+${newEntries.length} entries)\n`,
  );
  return true;
}

/**
 * Main entry point: reads usage-backfill.json, groups by task_id,
 * finds each manifest, applies backfill.
 */
export function runBackfill(options?: {
  backfillJsonPath?: string;
  agentSessionRoot?: string;
}): void {
  const projectRoot = path.resolve(__dirname, '../..');
  const backfillJsonPath = options?.backfillJsonPath ?? path.join(__dirname, 'usage-backfill.json');
  const agentSessionRoot = options?.agentSessionRoot ?? path.join(projectRoot, '.agent-session');

  // Read backfill data
  const backfillRaw = readJsonFile(backfillJsonPath);
  if (typeof backfillRaw !== 'object' || backfillRaw === null || Array.isArray(backfillRaw)) {
    process.stderr.write(`[agentops:backfill] ERROR: Cannot read ${backfillJsonPath}\n`);
    process.exit(1);
  }

  const backfillJson = backfillRaw as Record<string, unknown>;
  const rawEntries = backfillJson.entries;
  if (!Array.isArray(rawEntries)) {
    process.stderr.write(
      `[agentops:backfill] ERROR: ${backfillJsonPath} missing 'entries' array\n`,
    );
    process.exit(1);
  }

  // Validate and group entries by task_id
  const entriesByTask = new Map<string, BackfillJsonEntry[]>();
  for (const entry of rawEntries) {
    if (!isBackfillJsonEntry(entry)) {
      process.stderr.write(
        `[agentops:backfill] WARN: Skipping invalid entry: ${JSON.stringify(entry)}\n`,
      );
      continue;
    }
    const group = entriesByTask.get(entry.task_id) ?? [];
    group.push(entry);
    entriesByTask.set(entry.task_id, group);
  }

  if (entriesByTask.size === 0) {
    process.stdout.write('[agentops:backfill] No valid entries found. Nothing to do.\n');
    return;
  }

  // Apply to each task's manifest
  let updated = 0;
  let skipped = 0;

  for (const [taskId, entries] of entriesByTask) {
    const manifestPath = path.join(agentSessionRoot, taskId, 'dispatch-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      process.stderr.write(
        `[agentops:backfill] WARN: Manifest not found for ${taskId}: ${manifestPath}\n`,
      );
      skipped++;
      continue;
    }
    const wasUpdated = applyBackfillToManifest(manifestPath, entries);
    if (wasUpdated) {
      updated++;
    } else {
      skipped++;
    }
  }

  process.stdout.write(
    `[agentops:backfill] Done. ${updated} manifests updated, ${skipped} skipped/already-done.\n`,
  );
}

// Run when invoked directly (tsx backfill-usage.ts)
// Using a heuristic: if require.main === module in CommonJS, or if this is the entry point in ESM
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runBackfill();
}
