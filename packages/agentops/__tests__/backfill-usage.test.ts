/**
 * Tests for backfill-usage.ts
 * Covers: idempotency, parsing, validation (AC-018)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  isBackfillJsonEntry,
  applyBackfillToManifest,
  runBackfill,
  type BackfillJsonEntry,
} from '../src/backfill-usage';

// ---------------------------------------------------------------------------
// isBackfillJsonEntry
// ---------------------------------------------------------------------------

describe('isBackfillJsonEntry', () => {
  it('returns true for a valid entry', () => {
    const entry = {
      task_id: 'FEAT-001',
      dispatch_id: 'batch-a-dev',
      total_tokens: 46175,
      tool_uses: 24,
      duration_ms: 123173,
      model: 'sonnet-4-6',
      backfill_source: 'conversation_log_estimate',
    };
    expect(isBackfillJsonEntry(entry)).toBe(true);
  });

  it('returns true for backfill_source=manual', () => {
    const entry = {
      task_id: 'FEAT-001',
      dispatch_id: 'batch-a-dev',
      total_tokens: 100,
      tool_uses: 1,
      duration_ms: 1000,
      model: 'haiku-4-5',
      backfill_source: 'manual',
    };
    expect(isBackfillJsonEntry(entry)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isBackfillJsonEntry(null)).toBe(false);
  });

  it('returns false for missing task_id', () => {
    const entry = {
      dispatch_id: 'batch-a-dev',
      total_tokens: 100,
      tool_uses: 1,
      duration_ms: 1000,
      model: 'sonnet-4-6',
      backfill_source: 'conversation_log_estimate',
    };
    expect(isBackfillJsonEntry(entry)).toBe(false);
  });

  it('returns false for non-number total_tokens', () => {
    const entry = {
      task_id: 'FEAT-001',
      dispatch_id: 'batch-a-dev',
      total_tokens: 'not-a-number',
      tool_uses: 1,
      duration_ms: 1000,
      model: 'sonnet-4-6',
      backfill_source: 'conversation_log_estimate',
    };
    expect(isBackfillJsonEntry(entry)).toBe(false);
  });

  it('returns false for invalid backfill_source', () => {
    const entry = {
      task_id: 'FEAT-001',
      dispatch_id: 'batch-a-dev',
      total_tokens: 100,
      tool_uses: 1,
      duration_ms: 1000,
      model: 'sonnet-4-6',
      backfill_source: 'unknown-source',
    };
    expect(isBackfillJsonEntry(entry)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// applyBackfillToManifest
// ---------------------------------------------------------------------------

describe('applyBackfillToManifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-backfill-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeManifest(data: object): string {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2), 'utf-8');
    return manifestPath;
  }

  function readManifest(manifestPath: string): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  }

  const sampleEntry: BackfillJsonEntry = {
    task_id: 'FEAT-001',
    dispatch_id: 'batch-a-dev',
    total_tokens: 46175,
    tool_uses: 24,
    duration_ms: 123173,
    model: 'sonnet-4-6',
    backfill_source: 'conversation_log_estimate',
  };

  it('adds pre_feat_003_backfilled_usage to a manifest without it', () => {
    const manifestPath = writeManifest({
      schema_version: 1,
      task_id: 'FEAT-001',
      actual_dispatches: [],
    });

    const result = applyBackfillToManifest(manifestPath, [sampleEntry]);
    expect(result).toBe(true);

    const updated = readManifest(manifestPath);
    expect(Array.isArray(updated.pre_feat_003_backfilled_usage)).toBe(true);
    const backfilled = updated.pre_feat_003_backfilled_usage as BackfillJsonEntry[];
    expect(backfilled).toHaveLength(1);
    expect(backfilled[0]!.dispatch_id).toBe('batch-a-dev');
    expect(backfilled[0]!.total_tokens).toBe(46175);
  });

  it('is idempotent: running twice does not duplicate entries', () => {
    const manifestPath = writeManifest({
      schema_version: 1,
      task_id: 'FEAT-001',
      actual_dispatches: [],
    });

    applyBackfillToManifest(manifestPath, [sampleEntry]);
    applyBackfillToManifest(manifestPath, [sampleEntry]); // second run

    const updated = readManifest(manifestPath);
    const backfilled = updated.pre_feat_003_backfilled_usage as BackfillJsonEntry[];
    expect(backfilled).toHaveLength(1); // not duplicated
  });

  it('appends new entries without overwriting existing ones', () => {
    const existingEntry: BackfillJsonEntry = {
      task_id: 'FEAT-001',
      dispatch_id: 'batch-a-code-reviewer',
      total_tokens: 32303,
      tool_uses: 18,
      duration_ms: 89294,
      model: 'sonnet-4-6',
      backfill_source: 'conversation_log_estimate',
    };

    const manifestPath = writeManifest({
      schema_version: 1,
      task_id: 'FEAT-001',
      pre_feat_003_backfilled_usage: [existingEntry],
      actual_dispatches: [],
    });

    applyBackfillToManifest(manifestPath, [sampleEntry]); // new entry with different dispatch_id

    const updated = readManifest(manifestPath);
    const backfilled = updated.pre_feat_003_backfilled_usage as BackfillJsonEntry[];
    expect(backfilled).toHaveLength(2);
    const ids = backfilled.map((e) => e.dispatch_id);
    expect(ids).toContain('batch-a-dev');
    expect(ids).toContain('batch-a-code-reviewer');
  });

  it('returns false and logs warning for non-existent manifest path', () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const nonExistentPath = path.join(tmpDir, 'nonexistent.json');
    const result = applyBackfillToManifest(nonExistentPath, [sampleEntry]);
    expect(result).toBe(false);
    stderrSpy.mockRestore();
  });

  it('returns false when no new entries to add (all dispatch_ids already present)', () => {
    const manifestPath = writeManifest({
      schema_version: 1,
      task_id: 'FEAT-001',
      pre_feat_003_backfilled_usage: [sampleEntry],
      actual_dispatches: [],
    });

    const result = applyBackfillToManifest(manifestPath, [sampleEntry]);
    expect(result).toBe(false);
  });

  it('preserves all existing manifest fields when adding backfill', () => {
    const manifestPath = writeManifest({
      schema_version: 1,
      task_id: 'FEAT-001',
      pm_strategy_note: 'important note',
      expected_pipeline: [{ batch_id: 'BATCH-A' }],
      actual_dispatches: [{ dispatch_id: 'batch-a-dev', role: 'dev', status: 'done' }],
    });

    applyBackfillToManifest(manifestPath, [sampleEntry]);

    const updated = readManifest(manifestPath);
    expect(updated.schema_version).toBe(1);
    expect(updated.task_id).toBe('FEAT-001');
    expect(updated.pm_strategy_note).toBe('important note');
    expect(Array.isArray(updated.actual_dispatches)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// runBackfill (integration)
// ---------------------------------------------------------------------------

describe('runBackfill', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentops-run-backfill-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createManifest(taskId: string): string {
    const taskDir = path.join(tmpDir, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const manifestPath = path.join(taskDir, 'dispatch-manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          schema_version: 1,
          task_id: taskId,
          actual_dispatches: [{ dispatch_id: 'batch-a-dev', role: 'dev', status: 'done' }],
        },
        null,
        2,
      ),
    );
    return manifestPath;
  }

  function createBackfillJson(entries: BackfillJsonEntry[]): string {
    const backfillPath = path.join(tmpDir, 'usage-backfill.json');
    fs.writeFileSync(backfillPath, JSON.stringify({ entries }, null, 2));
    return backfillPath;
  }

  it('applies backfill entries to the corresponding manifest', () => {
    const manifestPath = createManifest('FEAT-TEST');
    const backfillPath = createBackfillJson([
      {
        task_id: 'FEAT-TEST',
        dispatch_id: 'batch-a-dev',
        total_tokens: 46175,
        tool_uses: 24,
        duration_ms: 123173,
        model: 'sonnet-4-6',
        backfill_source: 'conversation_log_estimate',
      },
    ]);

    runBackfill({ backfillJsonPath: backfillPath, agentSessionRoot: tmpDir });

    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(Array.isArray(updated.pre_feat_003_backfilled_usage)).toBe(true);
    expect(updated.pre_feat_003_backfilled_usage).toHaveLength(1);
    expect(updated.pre_feat_003_backfilled_usage[0].dispatch_id).toBe('batch-a-dev');
  });

  it('is idempotent when runBackfill is called twice', () => {
    const manifestPath = createManifest('FEAT-TEST');
    const entries: BackfillJsonEntry[] = [
      {
        task_id: 'FEAT-TEST',
        dispatch_id: 'batch-a-dev',
        total_tokens: 46175,
        tool_uses: 24,
        duration_ms: 123173,
        model: 'sonnet-4-6',
        backfill_source: 'conversation_log_estimate',
      },
    ];
    const backfillPath = createBackfillJson(entries);

    runBackfill({ backfillJsonPath: backfillPath, agentSessionRoot: tmpDir });
    runBackfill({ backfillJsonPath: backfillPath, agentSessionRoot: tmpDir }); // second run

    const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(updated.pre_feat_003_backfilled_usage).toHaveLength(1); // no duplication
  });

  it('skips invalid entries in backfill JSON and logs a warning', () => {
    createManifest('FEAT-TEST');
    // Mix valid + invalid entries
    const rawEntries = [
      {
        task_id: 'FEAT-TEST',
        dispatch_id: 'batch-a-dev',
        total_tokens: 'not-a-number', // invalid
        tool_uses: 1,
        duration_ms: 1000,
        model: 'sonnet-4-6',
        backfill_source: 'conversation_log_estimate',
      },
    ];
    const backfillPath = path.join(tmpDir, 'usage-backfill.json');
    fs.writeFileSync(backfillPath, JSON.stringify({ entries: rawEntries }, null, 2));

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    runBackfill({ backfillJsonPath: backfillPath, agentSessionRoot: tmpDir });
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'));
    stderrSpy.mockRestore();
  });

  it('handles missing manifest gracefully (logs warning, does not crash)', () => {
    // No manifest created for FEAT-MISSING
    const backfillPath = createBackfillJson([
      {
        task_id: 'FEAT-MISSING',
        dispatch_id: 'batch-a-dev',
        total_tokens: 100,
        tool_uses: 1,
        duration_ms: 1000,
        model: 'sonnet-4-6',
        backfill_source: 'conversation_log_estimate',
      },
    ]);

    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => {
      runBackfill({ backfillJsonPath: backfillPath, agentSessionRoot: tmpDir });
    }).not.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('WARN'));
    stderrSpy.mockRestore();
  });
});
