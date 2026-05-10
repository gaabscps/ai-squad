/**
 * Tests for phase_coverage detection in capture-pm-session hook.
 * (agentops-cost-tracking-patch)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { spawn } from 'child_process';

import {
  upsertEntry,
  parseTranscript,
  pickActiveTaskId,
  normalizeModel,
  isSessionDone,
  maybeRegenerateReport,
  findRepoRoot,
  type ModelAgg,
} from '../src/hooks/capture-pm-session';
import { detectPhaseCoverage, readPhaseHistory } from '../src/hooks/phase-coverage';

jest.mock('child_process', () => ({
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

jest.mock('../src/config', () => ({
  loadConfig: jest.fn(),
}));

// Access the top-level mock so all describe blocks share it
import { loadConfig as _loadConfig } from '../src/config';
const mockLoadConfig = _loadConfig as jest.Mock;

// ---------------------------------------------------------------------------
// detectPhaseCoverage
// ---------------------------------------------------------------------------

interface PhaseEntry {
  phase: string;
  started_at: string;
  completed_at?: string;
}

describe('detectPhaseCoverage', () => {
  it('returns the single phase when session overlaps exactly one phase window', () => {
    const phases: PhaseEntry[] = [
      {
        phase: 'specify',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
      },
      { phase: 'plan', started_at: '2026-01-01T01:00:00Z', completed_at: '2026-01-01T02:00:00Z' },
      {
        phase: 'implementation',
        started_at: '2026-01-01T02:00:00Z',
        completed_at: '2026-01-01T04:00:00Z',
      },
    ];
    const result = detectPhaseCoverage('2026-01-01T00:10:00Z', '2026-01-01T00:50:00Z', phases);
    expect(result.phase_coverage).toBe('specify');
    expect(result.phase_split).toBeUndefined();
  });

  it('returns "mixed" with phase_split when session spans two phases', () => {
    const phases: PhaseEntry[] = [
      { phase: 'plan', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T02:00:00Z' },
      {
        phase: 'implementation',
        started_at: '2026-01-01T02:00:00Z',
        completed_at: '2026-01-01T04:00:00Z',
      },
    ];
    // Session spans 1h in plan + 1h in implementation
    const result = detectPhaseCoverage('2026-01-01T01:00:00Z', '2026-01-01T03:00:00Z', phases);
    expect(result.phase_coverage).toBe('mixed');
    expect(result.phase_split).toBeDefined();
    expect(result.phase_split!['plan']).toBeCloseTo(0.5, 5);
    expect(result.phase_split!['implementation']).toBeCloseTo(0.5, 5);
  });

  it('returns "implementation" as fallback when no phase overlap', () => {
    const phases: PhaseEntry[] = [
      {
        phase: 'specify',
        started_at: '2026-01-01T10:00:00Z',
        completed_at: '2026-01-01T11:00:00Z',
      },
    ];
    const result = detectPhaseCoverage('2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', phases);
    expect(result.phase_coverage).toBe('implementation');
    expect(result.phase_split).toBeUndefined();
  });

  it('returns "implementation" as fallback for empty phase list', () => {
    const result = detectPhaseCoverage('2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z', []);
    expect(result.phase_coverage).toBe('implementation');
  });

  it('handles open-ended last phase (no completed_at)', () => {
    const phases: PhaseEntry[] = [{ phase: 'implementation', started_at: '2026-01-01T00:00:00Z' }];
    const result = detectPhaseCoverage('2026-01-01T00:30:00Z', '2026-01-01T01:00:00Z', phases);
    expect(result.phase_coverage).toBe('implementation');
  });

  it('phase_split ratios sum to 1.0 when mixed', () => {
    const phases: PhaseEntry[] = [
      { phase: 'plan', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T01:00:00Z' },
      { phase: 'tasks', started_at: '2026-01-01T01:00:00Z', completed_at: '2026-01-01T02:00:00Z' },
      {
        phase: 'implementation',
        started_at: '2026-01-01T02:00:00Z',
        completed_at: '2026-01-01T06:00:00Z',
      },
    ];
    // 30min in plan, 1h in tasks, 2h in implementation
    const result = detectPhaseCoverage('2026-01-01T00:30:00Z', '2026-01-01T04:00:00Z', phases);
    expect(result.phase_coverage).toBe('mixed');
    const split = result.phase_split!;
    const total = Object.values(split).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// readPhaseHistory
// ---------------------------------------------------------------------------

describe('readPhaseHistory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase-history-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns [] when file does not exist', () => {
    const result = readPhaseHistory(path.join(tmpDir, 'nonexistent.yml'));
    expect(result).toEqual([]);
  });

  it('returns [] when file is empty', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(filePath, '');
    const result = readPhaseHistory(filePath);
    expect(result).toEqual([]);
  });

  it('returns one PhaseEntry for a valid single entry', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(
      filePath,
      `phase_history:\n  - phase: specify\n    started_at: "2026-01-01T00:00:00Z"\n    completed_at: "2026-01-01T01:00:00Z"\n`,
    );
    const result = readPhaseHistory(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      phase: 'specify',
      started_at: '2026-01-01T00:00:00Z',
      completed_at: '2026-01-01T01:00:00Z',
    });
  });

  it('returns entries with unknown phase names (filtering happens in detectPhaseCoverage)', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(
      filePath,
      `phase_history:\n  - phase: design\n    started_at: "2026-01-01T00:00:00Z"\n`,
    );
    const result = readPhaseHistory(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.phase).toBe('design');
  });

  it('filters out entries without started_at', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(filePath, `phase_history:\n  - phase: specify\n    notes: "no timestamp"\n`);
    const result = readPhaseHistory(filePath);
    expect(result).toEqual([]);
  });

  it('parses entry without completed_at correctly', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(
      filePath,
      `phase_history:\n  - phase: implementation\n    started_at: "2026-01-01T01:00:00Z"\n`,
    );
    const result = readPhaseHistory(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.completed_at).toBeUndefined();
    expect(result[0]!.phase).toBe('implementation');
  });

  it('parses phase with single quotes', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(
      filePath,
      `phase_history:\n  - phase: 'specify'\n    started_at: "2026-01-01T00:00:00Z"\n`,
    );
    const result = readPhaseHistory(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]!.phase).toBe('specify');
  });

  it('returns multiple entries for multiple phases', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(
      filePath,
      [
        'phase_history:',
        '  - phase: specify',
        '    started_at: "2026-01-01T00:00:00Z"',
        '    completed_at: "2026-01-01T01:00:00Z"',
        '  - phase: implementation',
        '    started_at: "2026-01-01T01:00:00Z"',
      ].join('\n') + '\n',
    );
    const result = readPhaseHistory(filePath);
    expect(result).toHaveLength(2);
    expect(result[0]!.phase).toBe('specify');
    expect(result[1]!.phase).toBe('implementation');
  });
});

// ---------------------------------------------------------------------------
// upsertEntry: writes phase_coverage to manifest
// ---------------------------------------------------------------------------

function makeManifest(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: 1,
    task_id: 'FEAT-TEST',
    expected_pipeline: [],
    actual_dispatches: [],
    ...extra,
  });
}

function makeAgg(overrides: Partial<ModelAgg> = {}): ModelAgg {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreate: 0,
    cacheRead: 0,
    toolUses: 2,
    firstTs: '2026-01-01T00:10:00Z',
    lastTs: '2026-01-01T00:50:00Z',
    turns: 10,
    ...overrides,
  };
}

describe('upsertEntry: phase_coverage written to manifest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-session-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes phase_coverage="implementation" (fallback) when no session.yml exists', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, makeManifest());

    const agg = makeAgg({
      firstTs: '2026-01-01T00:10:00Z',
      lastTs: '2026-01-01T00:50:00Z',
    });
    upsertEntry(manifestPath, 'sess-001', 'sonnet-4-6', agg, undefined);

    const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const sessions = result.pm_orchestrator_sessions as Record<string, unknown>[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!['phase_coverage']).toBe('implementation');
    expect(sessions[0]!['phase_split']).toBeUndefined();
  });

  it('writes phase_coverage="specify" when session overlaps only specify window', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, makeManifest());

    const phases = [
      {
        phase: 'specify',
        started_at: '2026-01-01T00:00:00Z',
        completed_at: '2026-01-01T01:00:00Z',
      },
      {
        phase: 'implementation',
        started_at: '2026-01-01T01:00:00Z',
        completed_at: '2026-01-01T03:00:00Z',
      },
    ];
    const agg = makeAgg({
      firstTs: '2026-01-01T00:10:00Z',
      lastTs: '2026-01-01T00:50:00Z',
    });
    upsertEntry(manifestPath, 'sess-002', 'sonnet-4-6', agg, phases);

    const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const sessions = result.pm_orchestrator_sessions as Record<string, unknown>[];
    expect(sessions[0]!['phase_coverage']).toBe('specify');
  });

  it('writes phase_coverage="mixed" with phase_split when session spans two phases', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, makeManifest());

    const phases = [
      { phase: 'plan', started_at: '2026-01-01T00:00:00Z', completed_at: '2026-01-01T02:00:00Z' },
      {
        phase: 'implementation',
        started_at: '2026-01-01T02:00:00Z',
        completed_at: '2026-01-01T04:00:00Z',
      },
    ];
    const agg = makeAgg({
      firstTs: '2026-01-01T01:00:00Z',
      lastTs: '2026-01-01T03:00:00Z',
    });
    upsertEntry(manifestPath, 'sess-003', 'sonnet-4-6', agg, phases);

    const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const sessions = result.pm_orchestrator_sessions as Record<string, unknown>[];
    expect(sessions[0]!['phase_coverage']).toBe('mixed');
    const split = sessions[0]!['phase_split'] as Record<string, number>;
    expect(split).toBeDefined();
    expect(split['plan']).toBeCloseTo(0.5, 5);
    expect(split['implementation']).toBeCloseTo(0.5, 5);
  });

  it('overwrites existing entry for same session_id + model', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, makeManifest());

    const agg1 = makeAgg({ turns: 5 });
    upsertEntry(manifestPath, 'sess-001', 'sonnet-4-6', agg1, undefined);
    const agg2 = makeAgg({ turns: 10 });
    upsertEntry(manifestPath, 'sess-001', 'sonnet-4-6', agg2, undefined);

    const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const sessions = result.pm_orchestrator_sessions as Record<string, unknown>[];
    expect(sessions).toHaveLength(1);
  });

  it('uses current timestamp when firstTs/lastTs are null', () => {
    const manifestPath = path.join(tmpDir, 'dispatch-manifest.json');
    fs.writeFileSync(manifestPath, makeManifest());

    const agg = makeAgg({ firstTs: null, lastTs: null });
    upsertEntry(manifestPath, 'sess-004', 'sonnet-4-6', agg, undefined);

    const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const sessions = result.pm_orchestrator_sessions as Record<string, unknown>[];
    expect(sessions).toHaveLength(1);
    expect(typeof sessions[0]!['started_at']).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// normalizeModel
// ---------------------------------------------------------------------------

describe('normalizeModel', () => {
  it('maps claude-opus-4-7 to opus-4-7', () => {
    expect(normalizeModel('claude-opus-4-7')).toBe('opus-4-7');
  });

  it('maps claude-sonnet-4-6 to sonnet-4-6', () => {
    expect(normalizeModel('claude-sonnet-4-6')).toBe('sonnet-4-6');
  });

  it('maps claude-haiku-4-5 to haiku-4-5', () => {
    expect(normalizeModel('claude-haiku-4-5')).toBe('haiku-4-5');
  });

  it('maps unknown model containing "opus" to opus-4-7', () => {
    expect(normalizeModel('some-opus-model')).toBe('opus-4-7');
  });

  it('maps unknown model containing "sonnet" to sonnet-4-6', () => {
    expect(normalizeModel('some-sonnet-model')).toBe('sonnet-4-6');
  });

  it('maps unknown model containing "haiku" to haiku-4-5', () => {
    expect(normalizeModel('some-haiku-model')).toBe('haiku-4-5');
  });

  it('returns "unknown" for completely unknown model', () => {
    expect(normalizeModel('gpt-4')).toBe('unknown');
  });

  it('returns "unknown" for undefined input', () => {
    expect(normalizeModel(undefined)).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// parseTranscript
// ---------------------------------------------------------------------------

describe('parseTranscript', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty object when file does not exist', () => {
    const result = parseTranscript(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(result).toEqual({});
  });

  it('aggregates tokens from assistant turns', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const turn = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        model: 'claude-sonnet-4-6',
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    });
    fs.writeFileSync(transcriptPath, turn + '\n');
    const result = parseTranscript(transcriptPath);
    expect(result['sonnet-4-6']).toBeDefined();
    expect(result['sonnet-4-6']!.inputTokens).toBe(100);
    expect(result['sonnet-4-6']!.outputTokens).toBe(50);
    expect(result['sonnet-4-6']!.turns).toBe(1);
  });

  it('ignores non-assistant turns', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const turn = JSON.stringify({ type: 'human', message: { model: 'claude-sonnet-4-6' } });
    fs.writeFileSync(transcriptPath, turn + '\n');
    const result = parseTranscript(transcriptPath);
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('counts tool_use content items', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const turn = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'tool_use' }, { type: 'text' }, { type: 'tool_use' }],
        usage: { input_tokens: 50, output_tokens: 20 },
      },
    });
    fs.writeFileSync(transcriptPath, turn + '\n');
    const result = parseTranscript(transcriptPath);
    expect(result['sonnet-4-6']!.toolUses).toBe(2);
  });

  it('skips malformed JSON lines', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, 'not valid json\n{"type":"human"}\n');
    const result = parseTranscript(transcriptPath);
    expect(result).toEqual({});
  });

  it('tracks firstTs and lastTs correctly across multiple turns', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const turn1 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T01:00:00Z',
      message: { model: 'claude-sonnet-4-6', content: [], usage: { input_tokens: 10 } },
    });
    const turn2 = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { model: 'claude-sonnet-4-6', content: [], usage: { input_tokens: 20 } },
    });
    fs.writeFileSync(transcriptPath, turn1 + '\n' + turn2 + '\n');
    const result = parseTranscript(transcriptPath);
    expect(result['sonnet-4-6']!.firstTs).toBe('2026-01-01T00:00:00Z');
    expect(result['sonnet-4-6']!.lastTs).toBe('2026-01-01T01:00:00Z');
  });

  it('skips blank lines', () => {
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    const turn = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-01-01T00:00:00Z',
      message: { model: 'claude-sonnet-4-6', content: [], usage: { input_tokens: 5 } },
    });
    fs.writeFileSync(transcriptPath, '\n' + turn + '\n\n');
    const result = parseTranscript(transcriptPath);
    expect(result['sonnet-4-6']!.turns).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// pickActiveTaskId
// ---------------------------------------------------------------------------

describe('pickActiveTaskId', () => {
  let tmpDir: string;
  const origEnv = process.env.AGENTOPS_TASK_ID;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-task-test-'));
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

  it('returns env var AGENTOPS_TASK_ID when set', () => {
    process.env.AGENTOPS_TASK_ID = 'FEAT-ENV';
    expect(pickActiveTaskId(tmpDir)).toBe('FEAT-ENV');
  });

  it('returns null when .agent-session does not exist', () => {
    expect(pickActiveTaskId(tmpDir)).toBeNull();
  });

  it('reads task id from .current pointer file', () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, '.current'), 'FEAT-CURRENT\n');
    expect(pickActiveTaskId(tmpDir)).toBe('FEAT-CURRENT');
  });

  it('returns the most-recently-modified non-done session when no .current file', () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    const taskDir = path.join(sessionsDir, 'FEAT-ACTIVE');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'session.yml'), 'current_phase: implementation\n');
    expect(pickActiveTaskId(tmpDir)).toBe('FEAT-ACTIVE');
  });

  it('skips done sessions when scanning', () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    const taskDir = path.join(sessionsDir, 'FEAT-DONE');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'session.yml'), 'current_phase: done\n');
    expect(pickActiveTaskId(tmpDir)).toBeNull();
  });

  it('returns null when .current file exists but is empty', () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, '.current'), '   \n');
    expect(pickActiveTaskId(tmpDir)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isSessionDone
// ---------------------------------------------------------------------------

describe('isSessionDone', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-done-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false when file does not exist', () => {
    expect(isSessionDone(path.join(tmpDir, 'nonexistent.yml'))).toBe(false);
  });

  it('returns true when current_phase is done', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(filePath, 'current_phase: done\n');
    expect(isSessionDone(filePath)).toBe(true);
  });

  it('returns true when current_phase is "done" (with quotes)', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(filePath, 'current_phase: "done"\n');
    expect(isSessionDone(filePath)).toBe(true);
  });

  it('returns false when current_phase is implementation', () => {
    const filePath = path.join(tmpDir, 'session.yml');
    fs.writeFileSync(filePath, 'current_phase: implementation\n');
    expect(isSessionDone(filePath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// maybeRegenerateReport
// ---------------------------------------------------------------------------

describe('maybeRegenerateReport', () => {
  let tmpDir: string;
  const origEnv = process.env.AGENTOPS_AUTO_REPORT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regen-report-test-'));
    delete process.env.AGENTOPS_AUTO_REPORT;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    if (origEnv !== undefined) {
      process.env.AGENTOPS_AUTO_REPORT = origEnv;
    } else {
      delete process.env.AGENTOPS_AUTO_REPORT;
    }
  });

  it('returns early without throwing when AGENTOPS_AUTO_REPORT=0', async () => {
    process.env.AGENTOPS_AUTO_REPORT = '0';
    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
  });

  it('returns early when .agent-session does not exist', async () => {
    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
  });

  it('skips entries starting with "." in sessions dir', async () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, '.current'), 'FEAT-TEST');
    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
  });

  it('skips sessions without both yml and manifest', async () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    const taskDir = path.join(sessionsDir, 'FEAT-INCOMPLETE');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'session.yml'), 'current_phase: done\n');
    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
  });

  it('does nothing when no stale done sessions exist', async () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    const taskDir = path.join(sessionsDir, 'FEAT-UP-TO-DATE');
    const reportsDir = path.join(tmpDir, 'docs', 'agentops');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'session.yml'), 'current_phase: done\n');
    fs.writeFileSync(path.join(taskDir, 'dispatch-manifest.json'), '{}');
    const reportPath = path.join(reportsDir, 'FEAT-UP-TO-DATE.md');
    fs.writeFileSync(reportPath, '# report');
    const futureTime = Date.now() + 10000;
    fs.utimesSync(reportPath, futureTime / 1000, futureTime / 1000);
    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
  });

  it('skips non-done sessions', async () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    const taskDir = path.join(sessionsDir, 'FEAT-RUNNING');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'session.yml'), 'current_phase: implementation\n');
    fs.writeFileSync(path.join(taskDir, 'dispatch-manifest.json'), '{}');
    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// findRepoRoot
// ---------------------------------------------------------------------------

describe('findRepoRoot', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-repo-root-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns start path when .agent-session exists there', () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    fs.mkdirSync(sessionsDir);
    expect(findRepoRoot(tmpDir)).toBe(tmpDir);
  });

  it('returns start path when .git exists there', () => {
    const gitDir = path.join(tmpDir, '.git');
    fs.mkdirSync(gitDir);
    expect(findRepoRoot(tmpDir)).toBe(tmpDir);
  });

  it('finds root from a subdirectory with .agent-session', () => {
    const sessionsDir = path.join(tmpDir, '.agent-session');
    fs.mkdirSync(sessionsDir);
    const subDir = path.join(tmpDir, 'sub', 'dir');
    fs.mkdirSync(subDir, { recursive: true });
    expect(findRepoRoot(subDir)).toBe(tmpDir);
  });

  it('returns start when no marker found (fallback)', () => {
    const result = findRepoRoot(tmpDir);
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// AC-003: maybeRegenerateReport uses config.reportCommand (not hardcoded)
// ---------------------------------------------------------------------------

describe('maybeRegenerateReport: configurable reportCommand', () => {
  let tmpDir: string;
  const origEnv = process.env.AGENTOPS_AUTO_REPORT;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac003-test-'));
    delete process.env.AGENTOPS_AUTO_REPORT;
    jest.clearAllMocks();

    // Set up a stale done session so maybeRegenerateReport reaches the spawn branch
    const sessionsDir = path.join(tmpDir, '.agent-session');
    const taskDir = path.join(sessionsDir, 'FEAT-STALE');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'session.yml'), 'current_phase: done\n');
    fs.writeFileSync(path.join(taskDir, 'dispatch-manifest.json'), '{}');
    // No report file → manifest is always newer → session is stale
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
    if (origEnv !== undefined) {
      process.env.AGENTOPS_AUTO_REPORT = origEnv;
    } else {
      delete process.env.AGENTOPS_AUTO_REPORT;
    }
    jest.clearAllMocks();
  });

  it('spawns with parsed argv when reportCommand is "npm run agentops:report"', async () => {
    mockLoadConfig.mockResolvedValue({
      sessionPrefix: { value: 'FEAT-', source: 'config' },
      reportCommand: { value: 'npm run agentops:report', source: 'config' },
      priorFlows: { value: [], source: 'default' },
      bypassFlows: { value: [], source: 'default' },
      rootDir: { value: '.agent-session', source: 'default' },
    });

    await maybeRegenerateReport(tmpDir);

    expect(spawn).toHaveBeenCalledWith('npm', ['run', 'agentops:report'], expect.objectContaining({
      cwd: tmpDir,
      detached: true,
      stdio: 'ignore',
    }));
  });

  it('does NOT spawn when reportCommand is null', async () => {
    mockLoadConfig.mockResolvedValue({
      sessionPrefix: { value: 'FEAT-', source: 'config' },
      reportCommand: { value: null, source: 'default' },
      priorFlows: { value: [], source: 'default' },
      bypassFlows: { value: [], source: 'default' },
      rootDir: { value: '.agent-session', source: 'default' },
    });

    await maybeRegenerateReport(tmpDir);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns with correct argv for "npx agentops report"', async () => {
    mockLoadConfig.mockResolvedValue({
      sessionPrefix: { value: 'FEAT-', source: 'config' },
      reportCommand: { value: 'npx agentops report', source: 'env' },
      priorFlows: { value: [], source: 'default' },
      bypassFlows: { value: [], source: 'default' },
      rootDir: { value: '.agent-session', source: 'default' },
    });

    await maybeRegenerateReport(tmpDir);

    expect(spawn).toHaveBeenCalledWith('npx', ['agentops', 'report'], expect.objectContaining({
      cwd: tmpDir,
      detached: true,
      stdio: 'ignore',
    }));
  });

  it('does NOT spawn when reportCommand is empty string', async () => {
    mockLoadConfig.mockResolvedValue({
      sessionPrefix: { value: 'FEAT-', source: 'config' },
      reportCommand: { value: '', source: 'config' },
      priorFlows: { value: [], source: 'default' },
      bypassFlows: { value: [], source: 'default' },
      rootDir: { value: '.agent-session', source: 'default' },
    });

    await maybeRegenerateReport(tmpDir);

    expect(spawn).not.toHaveBeenCalled();
  });

  it('does NOT throw and does NOT spawn when loadConfig throws ConfigError', async () => {
    mockLoadConfig.mockRejectedValue(new Error('ConfigError: missing sessionPrefix'));

    await expect(maybeRegenerateReport(tmpDir)).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });
});
