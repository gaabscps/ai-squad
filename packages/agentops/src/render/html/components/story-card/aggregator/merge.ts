/**
 * Merge helpers for the story-card aggregator — FEAT-005.
 * Last-wins deduplication over arrays of output packets.
 * Covers: AC-014 (files dedup), AC-015 (ACs dedup), AC-005 (tasks dedup).
 */

import { isRecord, extractFilesChanged, extractAcsCovered, extractTasksCovered } from './extract';
import type { FileEntry, AcEntry } from './extract';

// Re-export interfaces so consumers can import from a single place if desired.
export type { FileEntry, AcEntry };

/**
 * Merges files_changed across output packets.
 * Last packet that mentions a path wins (AC-014).
 */
export function mergeFiles(packets: (Record<string, unknown> | null)[]): FileEntry[] {
  const map = new Map<string, FileEntry>();
  for (const op of packets) {
    if (!isRecord(op)) continue;
    for (const f of extractFilesChanged(op)) {
      map.set(f.path, f);
    }
  }
  return Array.from(map.values());
}

/**
 * Merges ac_evidence across output packets.
 * Last packet that mentions an AC id wins (AC-015).
 */
export function mergeAcs(packets: (Record<string, unknown> | null)[]): AcEntry[] {
  const map = new Map<string, AcEntry>();
  for (const op of packets) {
    if (!isRecord(op)) continue;
    for (const ac of extractAcsCovered(op)) {
      map.set(ac.id, ac);
    }
  }
  return Array.from(map.values());
}

/**
 * Merges tasks_covered across output packets.
 * Deduplicates by task id (AC-005).
 */
export function mergeTasks(packets: (Record<string, unknown> | null)[]): string[] {
  const set = new Set<string>();
  for (const op of packets) {
    if (!isRecord(op)) continue;
    for (const t of extractTasksCovered(op)) {
      set.add(t);
    }
  }
  return Array.from(set);
}
