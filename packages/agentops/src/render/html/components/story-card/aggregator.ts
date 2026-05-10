/**
 * Re-export shim — FEAT-005 split.
 * The aggregator was split into sub-modules under aggregator/:
 *   aggregator/index.ts  — top-level orchestration
 *   aggregator/extract.ts — parseOutputPacket, extractRetryEntries, extractSummary, extractBatchId
 *   aggregator/merge.ts  — mergeFiles, mergeAcs, mergeTasks
 *
 * Existing consumers that import from './aggregator' continue to resolve here.
 */
export { aggregateBatchesFromSession } from './aggregator/index';
