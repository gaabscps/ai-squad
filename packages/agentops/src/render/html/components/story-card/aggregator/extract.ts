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
 * Derives a grouping key from a dispatch id. Used only as a fallback when
 * Session.dispatches[].taskId is absent (legacy manifests or virtual dispatches).
 *
 * Recognised forms, in priority order:
 *   1. "feat-005-batch-b-dev" → "BATCH-B"            (legacy batch slug)
 *   2. "d-T-001-dev-l1"        → "T-001"             (task dispatch)
 *   3. "d-audit-agent"         → "audit-agent"       (singleton audit)
 *   4. "pm-orchestrator-<id>"  → "pm-orchestrator"   (virtual PM session)
 *   5. fallback: first two dash-separated segments uppercased
 */
export function extractBatchId(dispatchId: string): string {
  const batchMatch = /batch-([a-z0-9]+)/i.exec(dispatchId);
  if (batchMatch?.[1]) return `BATCH-${batchMatch[1].toUpperCase()}`;

  const taskMatch = /^d-(T-\d+)(?:-|$)/i.exec(dispatchId);
  if (taskMatch?.[1]) return taskMatch[1].toUpperCase();

  if (/^d-audit-agent(?:-|$)/i.test(dispatchId)) return 'audit-agent';
  if (/^pm-orchestrator(?:-|$)/i.test(dispatchId)) return 'pm-orchestrator';

  return dispatchId.split('-').slice(0, 2).join('-').toUpperCase();
}

// ---------------------------------------------------------------------------
// Per-output-packet data extraction
// ---------------------------------------------------------------------------

/**
 * Reads files_changed from an Output Packet.
 *
 * Accepts two schema variants:
 *   - Structured: [{ path, action, tasks_covered }]
 *   - Path-only:  ["path/to/file.ts", ...]
 *
 * For the path-only form, action defaults to "changed" and tasksCovered falls
 * back to the packet's own task_id (single-element array) when present.
 */
export function extractFilesChanged(op: Record<string, unknown>): FileEntry[] {
  const raw = op.files_changed;
  if (!Array.isArray(raw)) return [];
  const ownTaskId = asString(op.task_id);
  const fallbackTasksCovered = ownTaskId ? [ownTaskId] : [];
  const result: FileEntry[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.length === 0) continue;
      result.push({ path: item, action: 'changed', tasksCovered: fallbackTasksCovered });
      continue;
    }
    if (!isRecord(item)) continue;
    const path = asString(item.path);
    if (!path) continue;
    const action = asString(item.action) ?? 'changed';
    const tasksCovered = asStringArray(item.tasks_covered);
    result.push({
      path,
      action,
      tasksCovered: tasksCovered.length > 0 ? tasksCovered : fallbackTasksCovered,
    });
  }
  return result;
}

/**
 * Reads AC coverage from an Output Packet.
 *
 * Accepts two schema variants:
 *   - ac_evidence: { "AC-001": "free-form evidence string", ... }
 *   - ac_coverage: { "AC-001": ["E-AC001-001", "E-AC001-002"], ... } (qa packet)
 *
 * ac_evidence wins when both are present; ac_coverage entries are flattened
 * into an evidence string by joining the evidence IDs.
 */
export function extractAcsCovered(op: Record<string, unknown>): AcEntry[] {
  const result: AcEntry[] = [];
  const evidenceMap = isRecord(op.ac_evidence) ? op.ac_evidence : null;
  if (evidenceMap) {
    for (const [id, evidence] of Object.entries(evidenceMap)) {
      result.push({ id, evidence: asString(evidence) ?? '' });
    }
    return result;
  }
  const coverageMap = isRecord(op.ac_coverage) ? op.ac_coverage : null;
  if (coverageMap) {
    for (const [id, evidenceIds] of Object.entries(coverageMap)) {
      const ids = asStringArray(evidenceIds);
      result.push({ id, evidence: ids.join(', ') });
    }
  }
  return result;
}

/**
 * Reads task coverage from an Output Packet.
 * Falls back to the packet's own task_id when tasks_covered is missing.
 */
export function extractTasksCovered(op: Record<string, unknown>): string[] {
  const fromArray = asStringArray(op.tasks_covered);
  if (fromArray.length > 0) return fromArray;
  const ownTaskId = asString(op.task_id);
  return ownTaskId ? [ownTaskId] : [];
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
