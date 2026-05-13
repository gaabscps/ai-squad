/**
 * Unit tests for extractBatchId — the fallback grouping key derivation used by
 * the story-card aggregator when Session.dispatches[].taskId is absent.
 */

import { extractBatchId } from '../aggregator/extract';

describe('extractBatchId', () => {
  it('extracts BATCH-X from legacy batch slugs', () => {
    expect(extractBatchId('feat-001-batch-a-dev')).toBe('BATCH-A');
    expect(extractBatchId('feat-005-batch-b2-qa')).toBe('BATCH-B2');
  });

  it('extracts T-NNN from current SDD dispatch ids', () => {
    expect(extractBatchId('d-T-001-dev-l1')).toBe('T-001');
    expect(extractBatchId('d-T-008-blocker-1')).toBe('T-008');
    expect(extractBatchId('d-T-009-dev-postblocker')).toBe('T-009');
  });

  it('recognises the audit-agent singleton', () => {
    expect(extractBatchId('d-audit-agent')).toBe('audit-agent');
  });

  it('recognises the pm-orchestrator virtual dispatch', () => {
    expect(extractBatchId('pm-orchestrator-c76a225a')).toBe('pm-orchestrator');
  });

  it('falls back to first-two-segments uppercased for unknown shapes', () => {
    expect(extractBatchId('something-weird-here')).toBe('SOMETHING-WEIRD');
  });
});
