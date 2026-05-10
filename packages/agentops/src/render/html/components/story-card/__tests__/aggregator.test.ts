/**
 * FEAT-005 BLOCKER-2 split: this file was 479 lines (> 250 cap).
 * All assertions redistributed into 3 topic files:
 *   - aggregator-core.test.ts               — state, title, pipeline, files, ACs, tasks
 *   - aggregator-cost-and-pipeline.test.ts  — cost USD, sort order, XSS, AC-015 dedup
 *   - aggregator-summary-and-retry.test.ts  — summary fallback chain (AC-009)
 *
 * This file exists only to satisfy Jest's "must contain a test" constraint.
 */

import { aggregateBatchesFromSession } from '../aggregator';

describe('aggregator re-export shim', () => {
  it('aggregateBatchesFromSession is exported from the shim', () => {
    expect(typeof aggregateBatchesFromSession).toBe('function');
  });
});
