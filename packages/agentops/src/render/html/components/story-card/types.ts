/**
 * Story-card component types — FEAT-005 T-001.
 * Consumed by story-card format utilities and the HTML renderer.
 */

import type { Role, DispatchStatus } from '../../../../types';

export type BatchState = 'done' | 'done-retried' | 'escalated' | 'blocked' | 'running';

export interface BatchDispatchRow {
  dispatchId: string;
  role: Role;
  loop: number | null;
  durationMs: number | null;
  totalTokens: number | null;
  status: DispatchStatus;
  /** From usage.model — what actually ran. Undefined when no usage was captured. */
  model?: string;
  /**
   * From tier_calibration.effort — the effort parameter the orchestrator
   * dispatched with. There is no "actual effort" reported back from the model
   * runtime, so this is the only real signal for the effort dimension.
   */
  effort?: string;
  /** From usage.cost_usd — undefined when the dispatch has no captured usage. */
  costUsd?: number;
}

/** Replaces the legacy BatchData from ../story-card.ts (deleted in T-016). */
export interface BatchData {
  batchId: string;
  title: string;
  state: BatchState;
  durationMs: number | null;
  costUsd: number | null;
  tasksCovered: string[];
  acsCovered: { id: string; evidence: string }[];
  acScope: string[] | null;
  filesChanged: { path: string; action: string; tasksCovered: string[] }[];
  rolesPipeline: Role[];
  dispatches: BatchDispatchRow[];
  summary: string | null;
  retryEntries: { role: Role; loop: number; reason: string }[];
  pmNote: string | null;
  loops: number;
}
