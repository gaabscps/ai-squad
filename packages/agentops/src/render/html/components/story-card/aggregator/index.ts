/**
 * Rich aggregator — FEAT-005 T-005.
 * Aggregates session dispatches into fully-populated BatchData[].
 * Covers: AC-001, AC-005, AC-007, AC-009, AC-010, AC-011, AC-014, AC-015, AC-016, AC-017.
 *
 * NOTE: escape() is intentionally NOT applied here. The aggregator is a pure
 * data layer; HTML escaping is the renderer's responsibility (see T-006..T-011).
 */

import type { Session, Role } from '../../../../../types';
import { computeBatchState } from '../state';
import type { BatchData, BatchDispatchRow } from '../types';

import {
  isRecord,
  asString,
  asNumber,
  firstNSentences,
  extractBatchId,
  extractSummary,
  extractRetryEntries,
} from './extract';
import { mergeFiles, mergeAcs, mergeTasks } from './merge';

// ---------------------------------------------------------------------------
// Main aggregator
// ---------------------------------------------------------------------------

/**
 * Aggregates session dispatches into BatchData[], one entry per batchId.
 * Sorted by first dispatch startedAt ascending.
 */
export function aggregateBatchesFromSession(session: Session): BatchData[] {
  if (session.dispatches.length === 0) return [];

  // Build lookup: groupKey → pipeline entry (for title, acScope, tasksCovered).
  // Pipeline entries may be keyed by batchId (legacy) or taskId (current SDD manifests).
  const pipelineByBatch = new Map<string, (typeof session.expectedPipeline)[0]>();
  for (const entry of session.expectedPipeline) {
    if (entry.batchId) pipelineByBatch.set(entry.batchId, entry);
    if (entry.taskId) pipelineByBatch.set(entry.taskId, entry);
  }

  // Group dispatches by taskId when present (current manifests), falling back to
  // extractBatchId(dispatchId) for legacy manifests and virtual dispatches.
  const batchMap = new Map<string, typeof session.dispatches>();
  for (const dispatch of session.dispatches) {
    const batchId = dispatch.taskId ?? extractBatchId(dispatch.dispatchId);
    if (!batchMap.has(batchId)) batchMap.set(batchId, []);
    batchMap.get(batchId)!.push(dispatch);
  }

  const batches: BatchData[] = [];

  for (const [batchId, dispatches] of batchMap) {
    // Sort chronologically by startedAt
    const sorted = [...dispatches].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

    // --- title (AC-001) ---
    const pipelineEntry = pipelineByBatch.get(batchId);
    const title = pipelineEntry?.title ?? batchId;

    // --- acScope from manifest (AC-005) ---
    const acScope = pipelineEntry?.acScope ?? null;

    // --- duration (null if any dispatch incomplete) ---
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const durationMs =
      last.completedAt != null
        ? new Date(last.completedAt).getTime() - new Date(first.startedAt).getTime()
        : null;

    // --- Aggregate from Output Packets ---
    const outputPackets = sorted.map((d) => d.outputPacket);

    // Files: last-wins by path (AC-014)
    const filesChanged = mergeFiles(outputPackets);
    // ACs: last-wins by id (AC-015)
    const acsCovered = mergeAcs(outputPackets);
    // Tasks: dedup by id (AC-005)
    const tasksCovered = mergeTasks(outputPackets);

    // Cost (AC-007): sum cost_usd from dispatches that have it
    let costUsd: number | null = null;
    for (const dispatch of sorted) {
      const costUsdDispatch =
        dispatch.usage?.cost_usd !== undefined ? asNumber(dispatch.usage.cost_usd) : null;
      if (costUsdDispatch !== null) {
        costUsd = (costUsd ?? 0) + costUsdDispatch;
      }
    }

    // Summary: from dev dispatch with lowest loop (AC-009)
    let devSummary: string | null = null;
    let devSummaryLoop = Infinity;

    // PM note: last non-null (AC-017)
    let pmNote: string | null = null;

    // Roles pipeline: unique roles in chronological order (AC-005/AC-006)
    const rolesSeenOrder: Role[] = [];
    const rolesSeen = new Set<Role>();

    // Dispatch rows (AC-016)
    const dispatchRows: BatchDispatchRow[] = [];

    // loops
    let maxLoop = 0;

    for (const dispatch of sorted) {
      const op = dispatch.outputPacket;

      // Roles pipeline (AC-005)
      if (!rolesSeen.has(dispatch.role)) {
        rolesSeen.add(dispatch.role);
        rolesSeenOrder.push(dispatch.role);
      }

      // Usage
      const durationMsDispatch = dispatch.usage?.duration_ms ?? null;
      const totalTokens = dispatch.usage?.total_tokens ?? null;

      // Dispatch row
      const loop = dispatch.loop;
      const row: BatchDispatchRow = {
        dispatchId: dispatch.dispatchId,
        role: dispatch.role,
        loop,
        durationMs: typeof durationMsDispatch === 'number' ? durationMsDispatch : null,
        totalTokens: typeof totalTokens === 'number' ? totalTokens : null,
        status: dispatch.status,
      };
      // Report rule: real data only.
      // - model: from usage.model (what actually ran). tier_calibration.model
      //   records the *requested* model and can diverge from the runtime
      //   (Claude Code may ignore the param), so it's not authoritative here.
      // - effort: from tier_calibration.effort. There is no post-hoc effort
      //   reported by the runtime, so the dispatch-time config IS the data.
      const actualModel = dispatch.usage?.model;
      if (actualModel && actualModel !== 'unknown') {
        row.model = actualModel;
      }
      if (dispatch.tierCalibration?.effort) row.effort = dispatch.tierCalibration.effort;
      const dispatchCost =
        dispatch.usage?.cost_usd !== undefined ? asNumber(dispatch.usage.cost_usd) : null;
      if (dispatchCost !== null) row.costUsd = dispatchCost;
      dispatchRows.push(row);

      // Max loop
      const loopNum = loop ?? 0;
      if (loopNum > maxLoop) maxLoop = loopNum;

      // PM note (AC-017): last non-null
      if (dispatch.pmNote !== null) pmNote = dispatch.pmNote;

      // Summary (AC-009): from dev dispatch with lowest loop
      if (dispatch.role === 'dev' && isRecord(op)) {
        const dispatchLoop = loop ?? 0;
        if (dispatchLoop < devSummaryLoop) {
          const extracted = extractSummary(op);
          if (extracted !== null) {
            devSummary = extracted;
            devSummaryLoop = dispatchLoop;
          }
        }
      }
    }

    // Retry entries (AC-010, AC-011): dispatches with loop >= 2
    const retryEntries = extractRetryEntries(
      sorted.map((d) => ({ role: d.role, loop: d.loop, pmNote: d.pmNote })),
    );

    // Final summary: dev summary_for_reviewers → pmNote fallback → null (AC-009)
    let summary: string | null = devSummary;
    if (summary === null && pmNote !== null) {
      const raw = asString(pmNote);
      if (raw) summary = firstNSentences(raw, 2);
    }

    // State via state machine (AC-002..004)
    const state = computeBatchState(
      sorted.map((d) => ({
        role: d.role,
        status: d.status,
        loop: d.loop,
        startedAt: d.startedAt,
      })),
    );

    batches.push({
      batchId,
      title,
      state,
      durationMs,
      costUsd,
      tasksCovered,
      acsCovered,
      acScope,
      filesChanged,
      rolesPipeline: rolesSeenOrder,
      dispatches: dispatchRows,
      summary,
      retryEntries,
      pmNote,
      loops: maxLoop,
    });
  }

  // Sort batches by first dispatch startedAt
  return batches.sort((a, b) => {
    const aStart = batchMap.get(a.batchId)?.[0]?.startedAt ?? '';
    const bStart = batchMap.get(b.batchId)?.[0]?.startedAt ?? '';
    return aStart.localeCompare(bStart);
  });
}
