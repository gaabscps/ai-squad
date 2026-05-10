/**
 * Unit tests for parse.ts
 * T-008: 4+ tests covering happy path (Fixture A), spec-only (Fixture B),
 * corrupted manifest (Fixture C), and malformed session.yml.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { parse } from '../src/parse';

/* eslint-disable no-undef */
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');
/* eslint-enable no-undef */
const FIXTURE_A = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-A');
const FIXTURE_B = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-B');
const FIXTURE_C = path.join(FIXTURES_ROOT, 'FEAT-FIXTURE-C');

describe('parse', () => {
  it('fixture A: returns complete RawSession with manifest, 4 outputs, specMd', async () => {
    const raw = await parse(FIXTURE_A);
    expect(raw.taskId).toBe('FEAT-FIXTURE-A');
    expect(raw.sessionDirPath).toBe(FIXTURE_A);
    // manifest is present and not null
    expect(raw.manifest).not.toBeNull();
    // 4 output files
    expect(raw.outputs).toHaveLength(4);
    expect(raw.outputs.map((o) => o.filename)).toEqual(
      expect.arrayContaining([
        'audit-agent.json',
        'code-reviewer-1.json',
        'dev-1.json',
        'qa-1.json',
      ]),
    );
    // specMd is non-null string containing AC definitions
    expect(typeof raw.specMd).toBe('string');
    expect(raw.specMd).toContain('AC-001');
    // sessionYml is populated
    expect(raw.sessionYml).toBeTruthy();
  });

  it('fixture B: returns RawSession with manifest=null, outputs=[], specMd set', async () => {
    const raw = await parse(FIXTURE_B);
    expect(raw.taskId).toBe('FEAT-FIXTURE-B');
    expect(raw.manifest).toBeNull();
    expect(raw.outputs).toHaveLength(0);
    expect(typeof raw.specMd).toBe('string');
    expect(raw.specMd).toContain('AC-001');
  });

  it('fixture C: returns RawSession with manifest=null (JSON parse failed)', async () => {
    const raw = await parse(FIXTURE_C);
    expect(raw.taskId).toBe('FEAT-FIXTURE-C');
    // corrupted JSON produces null
    expect(raw.manifest).toBeNull();
    // specMd still readable
    expect(typeof raw.specMd).toBe('string');
  });

  it('throws when session.yml is missing', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-parse-'));
    try {
      await expect(parse(tmpDir)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when session.yml contains invalid YAML', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-parse-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'session.yml'), 'key: [unclosed bracket\n');
      await expect(parse(tmpDir)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns outputs sorted by filename', async () => {
    const raw = await parse(FIXTURE_A);
    const names = raw.outputs.map((o) => o.filename);
    expect(names).toEqual([...names].sort());
  });

  it('output data is accessible as unknown record (not null for valid JSON)', async () => {
    const raw = await parse(FIXTURE_A);
    const devOutput = raw.outputs.find((o) => o.filename === 'dev-1.json');
    expect(devOutput).toBeDefined();
    expect(devOutput!.data).not.toBeNull();
    // Type guard check: it is a record with expected fields
    const data = devOutput!.data as Record<string, unknown>;
    expect(data['role']).toBe('dev');
  });

  it('uses dirname as taskId when session.yml has no task_id field', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-parse-notaskid-'));
    try {
      // session.yml with no task_id key
      await fs.writeFile(
        path.join(tmpDir, 'session.yml'),
        'feature_name: "No task_id"\ncurrent_phase: specify\n',
      );
      const raw = await parse(tmpDir);
      // taskId falls back to directory name
      expect(raw.taskId).toBe(path.basename(tmpDir));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns specMd=null when spec.md does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-parse-nospec-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'session.yml'),
        'task_id: FEAT-NOSPEC\nfeature_name: "No spec"\n',
      );
      const raw = await parse(tmpDir);
      expect(raw.specMd).toBeNull();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips output files with invalid JSON (parse failure → omitted from outputs)', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-parse-badjson-'));
    try {
      await fs.writeFile(
        path.join(tmpDir, 'session.yml'),
        'task_id: FEAT-BADJSON\nfeature_name: "Bad JSON"\n',
      );
      await fs.mkdir(path.join(tmpDir, 'outputs'));
      await fs.writeFile(path.join(tmpDir, 'outputs', 'bad.json'), '{invalid json}');
      await fs.writeFile(path.join(tmpDir, 'outputs', 'good.json'), '{"role":"dev"}');

      const raw = await parse(tmpDir);
      // bad.json is skipped, good.json included
      expect(raw.outputs).toHaveLength(1);
      expect(raw.outputs[0]!.filename).toBe('good.json');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
