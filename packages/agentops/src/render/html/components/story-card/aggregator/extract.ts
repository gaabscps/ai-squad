/**
 * Data extraction helpers for the story-card aggregator — FEAT-005.
 * Pure functions; no HTML, no side effects.
 * Covers data extraction for: AC-007 (cost), AC-009 (summary), AC-014 (files),
 * AC-015 (ACs), AC-005 (tasks), AC-001 (batchId).
 */

import type { Role } from '../../../../../types';
import { truncate } from '../format';
import type { BatchData } from '../types';

// ---------------------------------------------------------------------------
// Internal interfaces (shared between extract + merge + index)
// ---------------------------------------------------------------------------

export interface FileEntry {
  path: string;
  action: string;
  tasksCovered: string[];
}

export interface AcEntry {
  id: string;
  evidence: string;
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

/** Type guard: value is a non-null Record<string, unknown>. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Safe string read from unknown. */
export function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** Safe string-array read from unknown. */
export function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/** Safe finite number read from unknown. */
export function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/**
 * Splits text into sentences and returns the first N joined.
 * Fallback when no punctuation terminator: truncate at 120 chars.
 */
export function firstNSentences(text: string, n: number): string | null {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length > 0) {
    return sentences
      .slice(0, n)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  // No punctuation terminator found — truncate to avoid returning huge unstructured text.
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 120 ? trimmed.slice(0, 119) + '…' : trimmed;
}

// ---------------------------------------------------------------------------
// BatchId extraction
// ---------------------------------------------------------------------------

/**
 * Extracts BATCH-X from a dispatch id like "feat-005-batch-b-dev" → "BATCH-B".
 * Fallback for non-batch dispatchIds: uses the first two dash-separated segments
 * uppercased (e.g. "pm-orchestrator" → "PM-ORCHESTRATOR").
 */
export function extractBatchId(dispatchId: string): string {
  const match = /batch-([a-z0-9]+)/i.exec(dispatchId);
  if (match?.[1]) return `BATCH-${match[1].toUpperCase()}`;
  // Non-batch dispatchId: produce a stable synthetic key from first 2 segments
  return dispatchId.split('-').slice(0, 2).join('-').toUpperCase();
}

// ---------------------------------------------------------------------------
// Per-output-packet data extraction
// ---------------------------------------------------------------------------

export function extractFilesChanged(op: Record<string, unknown>): FileEntry[] {
  const raw = op.files_changed;
  if (!Array.isArray(raw)) return [];
  const result: FileEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const path = asString(item.path);
    if (!path) continue;
    const action = asString(item.action) ?? 'changed';
    const tasksCovered = asStringArray(item.tasks_covered);
    result.push({ path, action, tasksCovered });
  }
  return result;
}

export function extractAcsCovered(op: Record<string, unknown>): AcEntry[] {
  const raw = op.ac_evidence;
  if (!isRecord(raw)) return [];
  const result: AcEntry[] = [];
  for (const [id, evidence] of Object.entries(raw)) {
    const ev = asString(evidence) ?? '';
    result.push({ id, evidence: ev });
  }
  return result;
}

export function extractTasksCovered(op: Record<string, unknown>): string[] {
  return asStringArray(op.tasks_covered);
}

/** Extracts first 2 sentences of summary_for_reviewers from an output packet. */
export function extractSummary(op: Record<string, unknown>): string | null {
  const raw = asString(op.summary_for_reviewers);
  if (!raw) return null;
  return firstNSentences(raw, 2);
}

// ---------------------------------------------------------------------------
// Retry entries extraction
// ---------------------------------------------------------------------------

/**
 * Produces retryEntries[] for loops >= 2.
 * Each entry describes one retry: role, loop number, and reason from pmNote.
 */
export function extractRetryEntries(
  dispatches: {
    role: Role;
    loop: number | null;
    pmNote: string | null;
  }[],
): BatchData['retryEntries'] {
  const entries: BatchData['retryEntries'] = [];
  for (const dispatch of dispatches) {
    const loopNum = dispatch.loop ?? 0;
    if (loopNum >= 2) {
      const reason = dispatch.pmNote ? truncate(dispatch.pmNote, 80) : '(no PM note)';
      entries.push({ role: dispatch.role, loop: loopNum, reason });
    }
  }
  return entries;
}
