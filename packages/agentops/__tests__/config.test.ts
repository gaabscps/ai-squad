import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

import { ConfigError, loadConfig } from '../src/config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'agentops-config-test-'));
}

async function writeConfigFile(dir: string, data: unknown): Promise<void> {
  await fsp.writeFile(path.join(dir, '.agentops.json'), JSON.stringify(data), 'utf8');
}

// Env var keys used by loadConfig
const ENV_KEYS = [
  'AGENTOPS_SESSION_PREFIX',
  'AGENTOPS_REPORT_COMMAND',
  'AGENTOPS_PRIOR_FLOWS',
  'AGENTOPS_BYPASS_FLOWS',
  'AGENTOPS_ROOT_DIR',
];

// Save and restore env vars around each test
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  // AC-1: throws ConfigError when sessionPrefix absent from both env and file
  it('throws ConfigError when sessionPrefix absent from env and file', async () => {
    const dir = await makeTmpDir();
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/sessionPrefix is required/);
  });

  // AC-2: reads sessionPrefix from env
  it('reads sessionPrefix from AGENTOPS_SESSION_PREFIX env var', async () => {
    const dir = await makeTmpDir();
    process.env['AGENTOPS_SESSION_PREFIX'] = 'from-env';
    const cfg = await loadConfig(dir);
    expect(cfg.sessionPrefix).toEqual({ value: 'from-env', source: 'env' });
  });

  // AC-3: reads sessionPrefix from .agentops.json file
  it('reads sessionPrefix from .agentops.json file', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'from-file' });
    const cfg = await loadConfig(dir);
    expect(cfg.sessionPrefix).toEqual({ value: 'from-file', source: 'config' });
  });

  // AC-3b: sessionPrefix as string array from file
  it('reads sessionPrefix as string array from file', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: ['FEAT', 'TASK'] });
    const cfg = await loadConfig(dir);
    expect(cfg.sessionPrefix).toEqual({ value: ['FEAT', 'TASK'], source: 'config' });
  });

  // AC-4: env takes precedence over file (sessionPrefix)
  it('env takes precedence over file for sessionPrefix', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'from-file' });
    process.env['AGENTOPS_SESSION_PREFIX'] = 'from-env';
    const cfg = await loadConfig(dir);
    expect(cfg.sessionPrefix).toEqual({ value: 'from-env', source: 'env' });
  });

  // AC-4b: env takes precedence over file (reportCommand)
  it('env takes precedence over file for reportCommand', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', reportCommand: 'file-cmd' });
    process.env['AGENTOPS_REPORT_COMMAND'] = 'env-cmd';
    const cfg = await loadConfig(dir);
    expect(cfg.reportCommand).toEqual({ value: 'env-cmd', source: 'env' });
  });

  // AC-4c: env takes precedence over file (priorFlows)
  it('env takes precedence over file for priorFlows', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', priorFlows: ['file-flow'] });
    process.env['AGENTOPS_PRIOR_FLOWS'] = JSON.stringify(['env-flow']);
    const cfg = await loadConfig(dir);
    expect(cfg.priorFlows).toEqual({ value: ['env-flow'], source: 'env' });
  });

  // AC-4d: env takes precedence over file (bypassFlows)
  it('env takes precedence over file for bypassFlows', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', bypassFlows: ['file-bypass'] });
    process.env['AGENTOPS_BYPASS_FLOWS'] = JSON.stringify(['env-bypass']);
    const cfg = await loadConfig(dir);
    expect(cfg.bypassFlows).toEqual({ value: ['env-bypass'], source: 'env' });
  });

  // AC-4e: env takes precedence over file (rootDir)
  it('env takes precedence over file for rootDir', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', rootDir: 'file-root' });
    process.env['AGENTOPS_ROOT_DIR'] = 'env-root';
    const cfg = await loadConfig(dir);
    expect(cfg.rootDir).toEqual({ value: 'env-root', source: 'env' });
  });

  // AC-5: file takes precedence over defaults (reportCommand)
  it('file value for reportCommand takes precedence over default', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', reportCommand: 'my-cmd' });
    const cfg = await loadConfig(dir);
    expect(cfg.reportCommand).toEqual({ value: 'my-cmd', source: 'config' });
  });

  // AC-5b: file value for priorFlows takes precedence over default
  it('file value for priorFlows takes precedence over default', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', priorFlows: ['FEAT-001'] });
    const cfg = await loadConfig(dir);
    expect(cfg.priorFlows).toEqual({ value: ['FEAT-001'], source: 'config' });
  });

  // AC-5c: file value for bypassFlows takes precedence over default
  it('file value for bypassFlows takes precedence over default', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', bypassFlows: ['FEAT-999'] });
    const cfg = await loadConfig(dir);
    expect(cfg.bypassFlows).toEqual({ value: ['FEAT-999'], source: 'config' });
  });

  // AC-5d: file value for rootDir takes precedence over default
  it('file value for rootDir takes precedence over default', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', rootDir: 'custom-root' });
    const cfg = await loadConfig(dir);
    expect(cfg.rootDir).toEqual({ value: 'custom-root', source: 'config' });
  });

  // AC-6: defaults when nothing provided
  it('uses defaults: reportCommand=null, priorFlows=[], bypassFlows=[], rootDir=.agent-session', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x' });
    const cfg = await loadConfig(dir);
    expect(cfg.reportCommand).toEqual({ value: null, source: 'default' });
    expect(cfg.priorFlows).toEqual({ value: [], source: 'default' });
    expect(cfg.bypassFlows).toEqual({ value: [], source: 'default' });
    expect(cfg.rootDir).toEqual({ value: '.agent-session', source: 'default' });
  });

  // AC-7: parseJsonEnv — valid JSON array → parsed
  it('parses valid JSON array from AGENTOPS_PRIOR_FLOWS env var', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x' });
    process.env['AGENTOPS_PRIOR_FLOWS'] = JSON.stringify(['flow-a', 'flow-b']);
    const cfg = await loadConfig(dir);
    expect(cfg.priorFlows).toEqual({ value: ['flow-a', 'flow-b'], source: 'env' });
  });

  // AC-7b: parseJsonEnv — invalid JSON → null (falls through to default)
  it('treats invalid JSON in AGENTOPS_PRIOR_FLOWS as absent (uses default)', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x' });
    process.env['AGENTOPS_PRIOR_FLOWS'] = 'not-valid-json{{{';
    const cfg = await loadConfig(dir);
    expect(cfg.priorFlows).toEqual({ value: [], source: 'default' });
  });

  // AC-7c: parseJsonEnv — invalid JSON → null (falls through to file config)
  it('treats invalid JSON in AGENTOPS_BYPASS_FLOWS as absent (uses file config)', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', bypassFlows: ['from-file'] });
    process.env['AGENTOPS_BYPASS_FLOWS'] = 'bad-json';
    const cfg = await loadConfig(dir);
    expect(cfg.bypassFlows).toEqual({ value: ['from-file'], source: 'config' });
  });

  // AC-8: reportCommand null in file is preserved
  it('preserves explicit null for reportCommand from file', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', reportCommand: null });
    const cfg = await loadConfig(dir);
    expect(cfg.reportCommand).toEqual({ value: null, source: 'config' });
  });

  // No .agentops.json file at all → graceful degradation (only env or error)
  it('works without .agentops.json when sessionPrefix provided via env', async () => {
    const dir = await makeTmpDir();
    // No config file written
    process.env['AGENTOPS_SESSION_PREFIX'] = 'env-only';
    const cfg = await loadConfig(dir);
    expect(cfg.sessionPrefix).toEqual({ value: 'env-only', source: 'env' });
    expect(cfg.reportCommand).toEqual({ value: null, source: 'default' });
    expect(cfg.priorFlows).toEqual({ value: [], source: 'default' });
    expect(cfg.bypassFlows).toEqual({ value: [], source: 'default' });
    expect(cfg.rootDir).toEqual({ value: '.agent-session', source: 'default' });
  });

  // AC-007: malformed .agentops.json throws ConfigError with parse-error message
  it('throws ConfigError with parse-error message for malformed .agentops.json', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, '.agentops.json'), '{bad json{{', 'utf8');
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/invalid JSON/);
  });

  // AC-001: AGENTOPS_SESSION_PREFIX="" treated as absent → falls through to file
  it('treats AGENTOPS_SESSION_PREFIX="" as absent (falls through to file)', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'from-file' });
    process.env['AGENTOPS_SESSION_PREFIX'] = '';
    const cfg = await loadConfig(dir);
    expect(cfg.sessionPrefix).toEqual({ value: 'from-file', source: 'config' });
  });

  // AC-001: AGENTOPS_SESSION_PREFIX="" treated as absent → throws when no file prefix
  it('treats AGENTOPS_SESSION_PREFIX="" as absent (throws when no file prefix)', async () => {
    const dir = await makeTmpDir();
    process.env['AGENTOPS_SESSION_PREFIX'] = '';
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/sessionPrefix is required/);
  });

  // AC-002: sessionPrefix as number in file throws ConfigError
  it('throws ConfigError when sessionPrefix is a number in .agentops.json', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 42 });
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/sessionPrefix must be/);
  });

  // AC-007: priorFlows as string (not array) throws ConfigError
  it('throws ConfigError when priorFlows is a string (not array) in .agentops.json', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', priorFlows: 'single-string' });
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/priorFlows must be/);
  });

  // AC-007: bypassFlows as non-array throws ConfigError
  it('throws ConfigError when bypassFlows is a non-array in .agentops.json', async () => {
    const dir = await makeTmpDir();
    await writeConfigFile(dir, { sessionPrefix: 'x', bypassFlows: 123 });
    await expect(loadConfig(dir)).rejects.toThrow(ConfigError);
    await expect(loadConfig(dir)).rejects.toThrow(/bypassFlows must be/);
  });
});
