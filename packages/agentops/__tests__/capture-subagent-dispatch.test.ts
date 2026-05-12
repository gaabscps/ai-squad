/**
 * Tests for subagent dispatch usage capture in capture-pm-session hook.
 * Covers: findDispatchOutputPath, aggregateToUsage, patchOutputPacketUsage,
 * patchManifestDispatchUsage, and runCapture integration (subagent branch).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  findDispatchOutputPath,
  aggregateToUsage,
  patchOutputPacketUsage,
  patchManifestDispatchUsage,
  runCapture,
  type ModelAgg,
} from '../src/hooks/capture-pm-session';

// Mock maybeRegenerateReport to avoid spawning
jest.mock('../src/config', () => ({
  loadConfig: jest.fn().mockResolvedValue({
    sessionPrefix: { value: 'FEAT-', source: 'config' },
    reportCommand: { value: null, source: 'default' },
    priorFlows: { value: [], source: 'default' },
    bypassFlows: { value: [], source: 'default' },
    rootDir: { value: '.agent-session', source: 'default' },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAgg(overrides: Partial<ModelAgg> = {}): ModelAgg {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreate: 20,
    cacheRead: 10,
    toolUses: 5,
    firstTs: '2026-01-01T00:00:00.000Z',
    lastTs: '2026-01-01T00:01:00.000Z',
    turns: 3,
    ...overrides,
  };
}

/** Write a minimal transcript JSONL with a Write tool_use to given path. */
function writeTranscriptWithWrite(transcriptPath: string, writePath: string | null): void {
  const lines: string[] = [];

  // assistant turn with usage
  const turn = {
    type: 'assistant',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: {
      model: 'claude-sonnet-4-6',
      content: writePath
        ? [{ type: 'tool_use', name: 'Write', input: { file_path: writePath, content: '{}' } }]
        : [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  lines.push(JSON.stringify(turn));
  fs.writeFileSync(transcriptPath, lines.join('\n') + '\n', 'utf-8');
}

/** Write a minimal output packet JSON. */
function writeOutputPacket(filePath: string, overrides: Record<string, unknown> = {}): void {
  const packet = {
    dispatch_id: 'd-042',
    status: 'done',
    role: 'dev',
    usage: null,
    ...overrides,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(packet, null, 2) + '\n', 'utf-8');
}

/** Write a minimal dispatch manifest JSON. */
function writeManifest(filePath: string, dispatches: unknown[] = []): void {
  const manifest = {
    schema_version: 1,
    task_id: 'FEAT-TEST',
    expected_pipeline: [],
    actual_dispatches: dispatches,
    pm_orchestrator_sessions: [],
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// findDispatchOutputPath
// ---------------------------------------------------------------------------

describe('findDispatchOutputPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-dispatch-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns the file_path when transcript has Write to outputs/d-*.json', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    writeTranscriptWithWrite(transcriptPath, '.agent-session/FEAT-001/outputs/d-042.json');
    const result = findDispatchOutputPath(transcriptPath);
    expect(result).toBe('.agent-session/FEAT-001/outputs/d-042.json');
  });

  it('returns null when transcript has no Write tool calls', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    writeTranscriptWithWrite(transcriptPath, null);
    const result = findDispatchOutputPath(transcriptPath);
    expect(result).toBeNull();
  });

  it('returns null when Write goes to non-output path', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    writeTranscriptWithWrite(transcriptPath, '/tmp/some-other-file.txt');
    const result = findDispatchOutputPath(transcriptPath);
    expect(result).toBeNull();
  });

  it('returns last matching path when multiple Write calls exist', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const turn1 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'tool_use', name: 'Write', input: { file_path: '.agent-session/FEAT-001/outputs/d-001.json', content: '{}' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    const turn2 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:01:00.000Z',
      message: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'tool_use', name: 'Write', input: { file_path: '.agent-session/FEAT-001/outputs/d-042.json', content: '{}' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    fs.writeFileSync(transcriptPath, turn1 + '\n' + turn2 + '\n', 'utf-8');
    const result = findDispatchOutputPath(transcriptPath);
    expect(result).toBe('.agent-session/FEAT-001/outputs/d-042.json');
  });

  it('returns null for non-existent transcript', () => {
    const result = findDispatchOutputPath(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateToUsage
// ---------------------------------------------------------------------------

describe('aggregateToUsage', () => {
  it('aggregates a single model correctly', () => {
    const byModel: Record<string, ModelAgg> = {
      'sonnet-4-6': makeAgg(),
    };
    const result = aggregateToUsage(byModel);
    expect(result.total_tokens).toBe(100 + 50 + 20 + 10); // 180
    expect(result.tool_uses).toBe(5);
    expect(result.model).toBe('sonnet-4-6');
    expect(result.breakdown).toEqual({
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 20,
      cache_read_input_tokens: 10,
    });
  });

  it('aggregates multiple models summing all tokens', () => {
    const byModel: Record<string, ModelAgg> = {
      'sonnet-4-6': makeAgg({ inputTokens: 100, outputTokens: 50, cacheCreate: 0, cacheRead: 0, toolUses: 3 }),
      'opus-4-7': makeAgg({ inputTokens: 200, outputTokens: 100, cacheCreate: 10, cacheRead: 5, toolUses: 2 }),
    };
    const result = aggregateToUsage(byModel);
    expect(result.total_tokens).toBe(100 + 50 + 200 + 100 + 10 + 5); // 465
    expect(result.tool_uses).toBe(5);
    expect(result.breakdown.input_tokens).toBe(300);
    expect(result.breakdown.output_tokens).toBe(150);
    expect(result.breakdown.cache_creation_input_tokens).toBe(10);
    expect(result.breakdown.cache_read_input_tokens).toBe(5);
  });

  it('uses first non-unknown model as model field', () => {
    const byModel: Record<string, ModelAgg> = {
      'unknown': makeAgg({ firstTs: '2026-01-01T00:00:00.000Z', lastTs: '2026-01-01T00:00:30.000Z' }),
      'sonnet-4-6': makeAgg({ firstTs: '2026-01-01T00:00:01.000Z', lastTs: '2026-01-01T00:01:00.000Z' }),
    };
    const result = aggregateToUsage(byModel);
    expect(result.model).toBe('sonnet-4-6');
  });

  it('falls back to unknown when only unknown model exists', () => {
    const byModel: Record<string, ModelAgg> = {
      'unknown': makeAgg(),
    };
    const result = aggregateToUsage(byModel);
    expect(result.model).toBe('unknown');
  });

  it('computes duration_ms from firstTs and lastTs across models', () => {
    const byModel: Record<string, ModelAgg> = {
      'sonnet-4-6': makeAgg({
        firstTs: '2026-01-01T00:00:00.000Z',
        lastTs: '2026-01-01T00:01:00.000Z',
      }),
    };
    const result = aggregateToUsage(byModel);
    expect(result.duration_ms).toBe(60000);
  });

  it('clamps duration_ms to >= 0', () => {
    const byModel: Record<string, ModelAgg> = {
      'sonnet-4-6': makeAgg({
        firstTs: '2026-01-01T00:01:00.000Z',
        lastTs: '2026-01-01T00:00:00.000Z', // reversed
      }),
    };
    const result = aggregateToUsage(byModel);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('uses 0 for duration_ms when timestamps are null', () => {
    const byModel: Record<string, ModelAgg> = {
      'sonnet-4-6': makeAgg({ firstTs: null, lastTs: null }),
    };
    const result = aggregateToUsage(byModel);
    expect(result.duration_ms).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// patchOutputPacketUsage
// ---------------------------------------------------------------------------

describe('patchOutputPacketUsage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-packet-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns null when file does not exist', () => {
    const result = patchOutputPacketUsage(path.join(tmpDir, 'nonexistent.json'), { total_tokens: 100 });
    expect(result).toBeNull();
  });

  it('returns null when file is invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not json', 'utf-8');
    const result = patchOutputPacketUsage(filePath, { total_tokens: 100 });
    expect(result).toBeNull();
  });

  it('writes usage and returns dispatch_id when usage is null', () => {
    const filePath = path.join(tmpDir, 'outputs', 'd-042.json');
    writeOutputPacket(filePath, { dispatch_id: 'd-042', usage: null });

    const usageObj = { total_tokens: 180, tool_uses: 5, duration_ms: 60000, model: 'sonnet-4-6' };
    const dispatchId = patchOutputPacketUsage(filePath, usageObj);

    expect(dispatchId).toBe('d-042');
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    expect(written.usage).toEqual(usageObj);
  });

  it('does not overwrite when usage is already non-null', () => {
    const filePath = path.join(tmpDir, 'outputs', 'd-042.json');
    const existingUsage = { total_tokens: 999, tool_uses: 1, duration_ms: 100, model: 'opus-4-7' };
    writeOutputPacket(filePath, { dispatch_id: 'd-042', usage: existingUsage });

    const newUsage = { total_tokens: 1, tool_uses: 0, duration_ms: 0, model: 'unknown' };
    const dispatchId = patchOutputPacketUsage(filePath, newUsage);

    expect(dispatchId).toBe('d-042'); // returns id without writing
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    expect(written.usage).toEqual(existingUsage); // unchanged
  });

  it('uses atomic tmp+rename (no lingering tmp file)', () => {
    const filePath = path.join(tmpDir, 'outputs', 'd-042.json');
    writeOutputPacket(filePath, { dispatch_id: 'd-042', usage: null });

    patchOutputPacketUsage(filePath, { total_tokens: 10 });

    const tmpFile = filePath + '.dispatch-usage.tmp';
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// patchManifestDispatchUsage
// ---------------------------------------------------------------------------

describe('patchManifestDispatchUsage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-manifest-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('is a no-op when manifest does not exist', () => {
    expect(() => {
      patchManifestDispatchUsage(
        path.join(tmpDir, 'nonexistent.json'),
        'd-042',
        { total_tokens: 100 },
      );
    }).not.toThrow();
  });

  it('is a no-op when manifest is invalid JSON', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, 'not json', 'utf-8');
    expect(() => {
      patchManifestDispatchUsage(manifestPath, 'd-042', { total_tokens: 100 });
    }).not.toThrow();
  });

  it('is a no-op when dispatch_id not found', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    writeManifest(manifestPath, [{ dispatch_id: 'd-001', status: 'done' }]);
    patchManifestDispatchUsage(manifestPath, 'd-999', { total_tokens: 100 });
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const dispatches = manifest.actual_dispatches as Record<string, unknown>[];
    expect(dispatches[0]!['usage']).toBeUndefined();
  });

  it('writes usage to the correct dispatch entry', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    writeManifest(manifestPath, [
      { dispatch_id: 'd-001', status: 'done' },
      { dispatch_id: 'd-042', status: 'done', usage: null },
    ]);

    const usageObj = { total_tokens: 180, tool_uses: 5, duration_ms: 60000, model: 'sonnet-4-6' };
    patchManifestDispatchUsage(manifestPath, 'd-042', usageObj);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const dispatches = manifest.actual_dispatches as Record<string, unknown>[];
    const d042 = dispatches.find((d) => d.dispatch_id === 'd-042');
    expect(d042!['usage']).toEqual(usageObj);

    // d-001 is unchanged
    const d001 = dispatches.find((d) => d.dispatch_id === 'd-001');
    expect(d001!['usage']).toBeUndefined();
  });

  it('does not overwrite when entry already has non-null usage', () => {
    const existingUsage = { total_tokens: 999, tool_uses: 1, duration_ms: 100, model: 'opus-4-7' };
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    writeManifest(manifestPath, [{ dispatch_id: 'd-042', status: 'done', usage: existingUsage }]);

    patchManifestDispatchUsage(manifestPath, 'd-042', { total_tokens: 1 });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const dispatches = manifest.actual_dispatches as Record<string, unknown>[];
    const d042 = dispatches.find((d) => d.dispatch_id === 'd-042');
    expect(d042!['usage']).toEqual(existingUsage);
  });

  it('uses atomic tmp+rename (no lingering tmp file)', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    writeManifest(manifestPath, [{ dispatch_id: 'd-042', status: 'done', usage: null }]);

    patchManifestDispatchUsage(manifestPath, 'd-042', { total_tokens: 100 });

    const tmpFile = manifestPath + '.dispatch-usage.tmp';
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// runCapture integration — subagent branch
// ---------------------------------------------------------------------------

describe('runCapture: subagent branch', () => {
  let tmpDir: string;
  const origEnv = process.env.AGENTOPS_TASK_ID;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-capture-subagent-test-'));
    delete process.env.AGENTOPS_TASK_ID;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    if (origEnv !== undefined) {
      process.env.AGENTOPS_TASK_ID = origEnv;
    } else {
      delete process.env.AGENTOPS_TASK_ID;
    }
  });

  function setupSession(taskId: string): {
    sessionDir: string;
    manifestPath: string;
    outputPacketPath: string;
    transcriptPath: string;
  } {
    const sessionDir = path.join(tmpDir, '.agent-session', taskId);
    const outputsDir = path.join(sessionDir, 'outputs');
    fs.mkdirSync(outputsDir, { recursive: true });

    const manifestPath = path.join(sessionDir, 'dispatch-manifest.json');
    const outputPacketPath = path.join(outputsDir, 'd-042.json');
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');

    // session.yml — non-done
    fs.writeFileSync(path.join(sessionDir, 'session.yml'), 'current_phase: implementation\n');

    // dispatch manifest with the d-042 entry
    writeManifest(manifestPath, [{ dispatch_id: 'd-042', status: 'done', usage: null }]);

    // output packet
    writeOutputPacket(outputPacketPath, { dispatch_id: 'd-042', status: 'done', usage: null });

    // transcript: Write to d-042.json (relative path matching the pattern)
    const relativePath = `.agent-session/${taskId}/outputs/d-042.json`;
    writeTranscriptWithWrite(transcriptPath, relativePath);

    return { sessionDir, manifestPath, outputPacketPath, transcriptPath };
  }

  it('writes usage to output packet and manifest when transcript has Write to outputs/d-*.json', async () => {
    const taskId = 'FEAT-SUBAGENT';
    process.env.AGENTOPS_TASK_ID = taskId;
    const { manifestPath, outputPacketPath, transcriptPath } = setupSession(taskId);

    await runCapture({
      transcriptPath,
      sessionId: 'sess-test-001',
      repoRoot: tmpDir,
      skipRegenReport: true,
    });

    const packet = JSON.parse(fs.readFileSync(outputPacketPath, 'utf-8')) as Record<string, unknown>;
    expect(packet.usage).not.toBeNull();
    expect(typeof (packet.usage as Record<string, unknown>)['total_tokens']).toBe('number');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const dispatches = manifest.actual_dispatches as Record<string, unknown>[];
    const d042 = dispatches.find((d) => d.dispatch_id === 'd-042');
    expect(d042!['usage']).not.toBeNull();
  });

  it('does NOT write to pm_orchestrator_sessions when subagent branch runs', async () => {
    const taskId = 'FEAT-SUBAGENT2';
    process.env.AGENTOPS_TASK_ID = taskId;
    const { manifestPath, transcriptPath } = setupSession(taskId);

    await runCapture({
      transcriptPath,
      sessionId: 'sess-test-002',
      repoRoot: tmpDir,
      skipRegenReport: true,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const pmSessions = manifest.pm_orchestrator_sessions as unknown[];
    expect(pmSessions).toHaveLength(0); // unchanged from initial empty array
  });

  it('resolves absolute output path when path is relative to repoRoot', async () => {
    const taskId = 'FEAT-SUBAGENT3';
    process.env.AGENTOPS_TASK_ID = taskId;
    const { outputPacketPath, transcriptPath } = setupSession(taskId);

    await runCapture({
      transcriptPath,
      sessionId: 'sess-test-003',
      repoRoot: tmpDir,
      skipRegenReport: true,
    });

    const packet = JSON.parse(fs.readFileSync(outputPacketPath, 'utf-8')) as Record<string, unknown>;
    expect(packet.usage).not.toBeNull();
  });
});
