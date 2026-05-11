/**
 * PM session enricher for FEAT-004 (AC-014, AC-015).
 *
 * Reads the optional `pm_sessions[]` top-level field from a dispatch-manifest
 * (schema_version 2) and returns a typed array.  Returns an empty array for
 * v1 manifests (backward compat, AC-014) or when the field is absent / malformed.
 *
 * Convention: tolerant parsing — invalid entries are silently dropped, never
 * thrown.  This matches the existing pattern in `enrich/dispatches.ts`.
 *
 * Validation rules (per dispatch-manifest.schema.json):
 * - All usage subfields (input_tokens, output_tokens, total_tokens, cost_usd)
 *   are required and must be numbers with minimum: 0.  Entries with missing,
 *   non-numeric, or negative usage values are dropped.
 * - Duplicate session_id values are deduped: first occurrence wins.
 */

import type { PmSession } from '../types';
import { isRecord, isArray, isPmSessionSource } from './guards';

export type { PmSession, PmSessionSource } from '../types';

/**
 * Parse a single raw pm_sessions[] entry.
 * Returns null when any required field is missing, wrong type, or out of range.
 */
function parsePmSession(raw: unknown): PmSession | null {
  if (!isRecord(raw)) return null;

  const sessionId = raw.session_id;
  if (typeof sessionId !== 'string') return null;

  const startedAt = raw.started_at;
  if (typeof startedAt !== 'string') return null;

  // completedAt: must be string, null, or absent (absent → null).
  // Reject entries where field is present but neither string nor null.
  let completedAt: string | null = null;
  if (raw.completed_at !== undefined && raw.completed_at !== null) {
    if (typeof raw.completed_at !== 'string') return null;
    completedAt = raw.completed_at;
  }

  const source = raw.source;
  if (!isPmSessionSource(source)) return null;

  // usage: all four subfields are required (schema minimum: 0).
  // Reject entry if usage is not a record or any field is missing/non-numeric/negative.
  if (!isRecord(raw.usage)) return null;
  const u = raw.usage;

  if (typeof u.input_tokens !== 'number' || u.input_tokens < 0) return null;
  if (typeof u.output_tokens !== 'number' || u.output_tokens < 0) return null;
  if (typeof u.total_tokens !== 'number' || u.total_tokens < 0) return null;
  if (typeof u.cost_usd !== 'number' || u.cost_usd < 0) return null;

  const inputTokens = u.input_tokens;
  const outputTokens = u.output_tokens;
  const totalTokens = u.total_tokens;
  const costUsd = u.cost_usd;

  return {
    sessionId,
    startedAt,
    completedAt,
    usage: { inputTokens, outputTokens, totalTokens, costUsd },
    source,
  };
}

/**
 * Normalise the `pm_sessions[]` field from a raw manifest.
 *
 * - Returns `[]` when `manifest` is not a record (AC-014: non-crashing on
 *   unknown / v1 input).
 * - Returns `[]` when `pm_sessions` is absent or not an array.
 * - Silently drops entries that fail the per-entry guard.
 * - Deduplicates on session_id; first occurrence wins (f6 logic-reviewer finding).
 */
export function normalisePmSessions(manifest: unknown): PmSession[] {
  if (!isRecord(manifest)) return [];
  const raw = manifest.pm_sessions;
  if (!isArray(raw)) return [];

  const out: PmSession[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const parsed = parsePmSession(entry);
    if (parsed !== null) {
      if (!seen.has(parsed.sessionId)) {
        seen.add(parsed.sessionId);
        out.push(parsed);
      }
    }
  }
  return out;
}
