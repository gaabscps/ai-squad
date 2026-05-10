import { promises as fsp } from 'fs';
import os from 'os';
import path from 'path';

import { installHooks, HOOK_COMMAND } from '../src/install-hooks';
import type { ClaudeSettings } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'agentops-hooks-test-'));
}

async function readSettings(dir: string): Promise<ClaudeSettings> {
  const raw = await fsp.readFile(path.join(dir, '.claude', 'settings.local.json'), 'utf8');
  return JSON.parse(raw) as ClaudeSettings;
}

async function writeSettings(dir: string, data: ClaudeSettings): Promise<void> {
  const settingsDir = path.join(dir, '.claude');
  await fsp.mkdir(settingsDir, { recursive: true });
  await fsp.writeFile(
    path.join(settingsDir, 'settings.local.json'),
    JSON.stringify(data, null, 2),
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installHooks', () => {
  // AC-009: create from scratch — .claude/settings.local.json does not exist
  it('creates settings.local.json with hook when file absent, returns { installed: true }', async () => {
    const dir = await makeTmpDir();

    const result = await installHooks(dir);

    expect(result).toEqual({ installed: true });

    const settings = await readSettings(dir);
    expect(settings.hooks?.Stop).toBeDefined();
    const stopHooks = settings.hooks!.Stop;
    expect(stopHooks).toHaveLength(1);
    expect(stopHooks[0]).toEqual({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  });

  // AC-010: idempotency — running twice does not duplicate the hook entry
  it('returns { installed: false } on second run and does not duplicate hook', async () => {
    const dir = await makeTmpDir();

    const first = await installHooks(dir);
    expect(first).toEqual({ installed: true });

    const second = await installHooks(dir);
    expect(second).toEqual({ installed: false });

    const settings = await readSettings(dir);
    const stopHooks = settings.hooks!.Stop;
    const matchingHooks = stopHooks.filter((h) => h.hooks?.some((c) => c.command === HOOK_COMMAND));
    expect(matchingHooks).toHaveLength(1);
  });

  // AC-009 variant: file exists with empty object {}
  it('inserts hook into partial settings (hooks absent), returns { installed: true }', async () => {
    const dir = await makeTmpDir();
    await writeSettings(dir, {});

    const result = await installHooks(dir);

    expect(result).toEqual({ installed: true });
    const settings = await readSettings(dir);
    expect(settings.hooks?.Stop).toBeDefined();
    expect(settings.hooks!.Stop[0]).toEqual({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  });

  // AC-009 variant: file exists with hooks: {} but no Stop key
  it('inserts hook when hooks exists but Stop is absent, returns { installed: true }', async () => {
    const dir = await makeTmpDir();
    await writeSettings(dir, { hooks: {} });

    const result = await installHooks(dir);

    expect(result).toEqual({ installed: true });
    const settings = await readSettings(dir);
    expect(settings.hooks!.Stop).toBeDefined();
    expect(settings.hooks!.Stop[0]).toEqual({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  });

  // AC-009 variant: file has other Stop hooks — our hook appended, others preserved
  it('appends hook alongside existing Stop hooks without removing them', async () => {
    const dir = await makeTmpDir();
    await writeSettings(dir, {
      hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'other-cmd' }] }] },
    });

    const result = await installHooks(dir);

    expect(result).toEqual({ installed: true });
    const settings = await readSettings(dir);
    const stopHooks = settings.hooks!.Stop;
    expect(stopHooks).toHaveLength(2);
    expect(stopHooks.some((h) => h.hooks?.some((c) => c.command === 'other-cmd'))).toBe(true);
    expect(stopHooks.some((h) => h.hooks?.some((c) => c.command === HOOK_COMMAND))).toBe(true);
  });

  // AC-011: atomic write verification — file is valid JSON after install
  it('produces valid JSON after install (atomic write)', async () => {
    const dir = await makeTmpDir();

    await installHooks(dir);

    const raw = await fsp.readFile(path.join(dir, '.claude', 'settings.local.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as ClaudeSettings;
    expect(parsed.hooks?.Stop).toHaveLength(1);
    expect(parsed.hooks!.Stop[0]).toEqual({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  });

  // AC-011: idempotent second run also produces valid JSON
  it('produces valid JSON after second (idempotent) run', async () => {
    const dir = await makeTmpDir();

    await installHooks(dir);
    await installHooks(dir); // second run — no-op

    const raw = await fsp.readFile(path.join(dir, '.claude', 'settings.local.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw) as ClaudeSettings;
    const stopHooks = parsed.hooks!.Stop;
    expect(stopHooks.filter((h) => h.hooks?.some((c) => c.command === HOOK_COMMAND))).toHaveLength(1);
  });
});
