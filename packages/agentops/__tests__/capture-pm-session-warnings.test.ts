/**
 * Tests for AC-007: warning entries written to dispatch-manifest.json
 * when capture-pm-session Stop hook encounters failure modes.
 *
 * Three failure modes tested via runCapture() (the live production path):
 *   1. transcript_path is missing (no transcript path provided)
 *   2. transcript has zero assistant turns (empty transcript)
 *   3. manifest file is not found
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { appendSessionWarning, runCapture } from '../src/hooks/capture-pm-session';

/** Build a minimal .agent-session layout so pickActiveTaskId resolves to taskId. */
function makeRepoRoot(base: string, taskId: string): { repoRoot: string; manifestPath: string } {
  const repoRoot = base;
  const sessionsDir = path.join(repoRoot, '.agent-session');
  const taskDir = path.join(sessionsDir, taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, '.current'), `${taskId}\n`);
  const manifestPath = path.join(taskDir, 'dispatch-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      schema_version: 1,
      task_id: taskId,
      expected_pipeline: [],
      actual_dispatches: [],
    }),
  );
  return { repoRoot, manifestPath };
}

describe('AC-007: capture-pm-session warning entries (via runCapture live path)', () => {
  let tmpDir: string;
  let repoRoot: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-warnings-test-'));
    ({ repoRoot, manifestPath } = makeRepoRoot(tmpDir, 'FEAT-TEST'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('appends warning with reason "missing_transcript_path" when transcript_path is not provided', async () => {
    await runCapture({
      transcriptPath: undefined,
      sessionId: 'sess-abc',
      repoRoot,
      skipRegenReport: true,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings = manifest.pm_orchestrator_session_warnings as Record<string, unknown>[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!['reason']).toBe('missing_transcript_path');
    expect(warnings[0]!['session_id']).toBe('sess-abc');
    expect(typeof warnings[0]!['timestamp']).toBe('string');
  });

  it('appends warning with reason "zero_assistant_turns" when transcript has no assistant turns', async () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    // Write a transcript with only human turns (no assistant)
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({ type: 'human', message: { content: 'hello' } }) + '\n',
    );

    await runCapture({
      transcriptPath,
      sessionId: 'sess-def',
      repoRoot,
      skipRegenReport: true,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings = manifest.pm_orchestrator_session_warnings as Record<string, unknown>[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!['reason']).toBe('zero_assistant_turns');
    expect(warnings[0]!['session_id']).toBe('sess-def');
    expect(typeof warnings[0]!['timestamp']).toBe('string');
  });

  it('does not throw when manifest file does not exist (missing_manifest path is stderr-only)', async () => {
    // Remove the manifest to trigger missing-manifest path
    fs.rmSync(manifestPath);
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          model: 'claude-sonnet-4-6',
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }) + '\n',
    );

    // When manifest is missing, runCapture logs to stderr only and does NOT throw.
    await expect(
      runCapture({
        transcriptPath,
        sessionId: 'sess-ghi',
        repoRoot,
        skipRegenReport: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('appendSessionWarning writes entry with correct shape to existing manifest', () => {
    appendSessionWarning(manifestPath, {
      timestamp: '2026-01-01T00:00:00Z',
      reason: 'missing_transcript_path',
      session_id: 'sess-xyz',
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings = manifest.pm_orchestrator_session_warnings as Record<string, unknown>[];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      timestamp: '2026-01-01T00:00:00Z',
      reason: 'missing_transcript_path',
      session_id: 'sess-xyz',
    });
  });

  it('appendSessionWarning accumulates multiple warnings (does not overwrite)', () => {
    appendSessionWarning(manifestPath, {
      timestamp: '2026-01-01T00:00:00Z',
      reason: 'missing_transcript_path',
      session_id: 'sess-1',
    });
    appendSessionWarning(manifestPath, {
      timestamp: '2026-01-01T00:01:00Z',
      reason: 'zero_assistant_turns',
      session_id: 'sess-2',
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings = manifest.pm_orchestrator_session_warnings as Record<string, unknown>[];
    expect(warnings).toHaveLength(2);
    expect(warnings[0]!['reason']).toBe('missing_transcript_path');
    expect(warnings[1]!['reason']).toBe('zero_assistant_turns');
  });
});

// ---------------------------------------------------------------------------
// AC-007 main()-level integration tests (via runCapture)
// These verify that production code paths through main() actually write
// pm_orchestrator_session_warnings[] entries — not just captureWithWarnings().
// ---------------------------------------------------------------------------

describe('AC-007: runCapture() integration — warnings written via main() code path', () => {
  let tmpDir: string;
  let repoRoot: string;
  let taskDir: string;
  let manifestPath: string;

  beforeEach(() => {
    // Build a minimal .agent-session layout so pickActiveTaskId resolves
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runCapture-test-'));
    repoRoot = tmpDir;
    const sessionsDir = path.join(repoRoot, '.agent-session');
    taskDir = path.join(sessionsDir, 'FEAT-INTEG');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, '.current'), 'FEAT-INTEG\n');
    manifestPath = path.join(taskDir, 'dispatch-manifest.json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        schema_version: 1,
        task_id: 'FEAT-INTEG',
        expected_pipeline: [],
        actual_dispatches: [],
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes missing_transcript_path warning to manifest when transcriptPath is undefined', async () => {
    await runCapture({
      transcriptPath: undefined,
      sessionId: 'sess-main-001',
      repoRoot,
      skipRegenReport: true,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings = manifest.pm_orchestrator_session_warnings as Record<string, unknown>[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!['reason']).toBe('missing_transcript_path');
    expect(warnings[0]!['session_id']).toBe('sess-main-001');
    expect(typeof warnings[0]!['timestamp']).toBe('string');
  });

  it('writes zero_assistant_turns warning to manifest when transcript has no assistant turns', async () => {
    const transcriptPath = path.join(tmpDir, 'empty-transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({ type: 'human', message: { content: 'hi' } }) + '\n',
    );

    await runCapture({
      transcriptPath,
      sessionId: 'sess-main-002',
      repoRoot,
      skipRegenReport: true,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const warnings = manifest.pm_orchestrator_session_warnings as Record<string, unknown>[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!['reason']).toBe('zero_assistant_turns');
    expect(warnings[0]!['session_id']).toBe('sess-main-002');
  });

  it('does not throw when manifest is missing (missing_manifest path is stderr-only)', async () => {
    // Remove the manifest to trigger the missing-manifest path
    fs.rmSync(manifestPath);
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          model: 'claude-sonnet-4-6',
          content: [],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      }) + '\n',
    );

    await expect(
      runCapture({
        transcriptPath,
        sessionId: 'sess-main-003',
        repoRoot,
        skipRegenReport: true,
      }),
    ).resolves.toBeUndefined();
    // Manifest was deleted — can't verify written warning, but confirms no throw
  });

  it('upserts entry normally (no warning) when transcript has valid assistant turns', async () => {
    const transcriptPath = path.join(tmpDir, 'valid-transcript.jsonl');
    fs.writeFileSync(
      transcriptPath,
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          model: 'claude-sonnet-4-6',
          content: [],
          usage: { input_tokens: 200, output_tokens: 100 },
        },
      }) + '\n',
    );

    await runCapture({
      transcriptPath,
      sessionId: 'sess-main-004',
      repoRoot,
      skipRegenReport: true,
    });

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    // No warnings — successful capture
    expect(manifest.pm_orchestrator_session_warnings).toBeUndefined();
    // Session entry written
    const sessions = manifest.pm_orchestrator_sessions as Record<string, unknown>[];
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!['session_id']).toBe('sess-main-004');
  });
});
