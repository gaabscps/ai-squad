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

/**
 * Simulate a git worktree layout on the filesystem (fallback path — no commondir file):
 *
 *   <mainRoot>/.git/                            ← common git dir
 *   <mainRoot>/.git/worktrees/<name>/           ← worktree entry (no commondir file)
 *   <worktreeRoot>/                             ← the worktree working dir
 *   <worktreeRoot>/.git                         ← file (not dir) pointing to common dir
 *
 * Returns { mainRoot, worktreeRoot }.
 */
async function makeWorktreeLayout(base: string): Promise<{ mainRoot: string; worktreeRoot: string }> {
  const mainRoot = path.join(base, 'main-repo');
  const worktreeRoot = path.join(base, 'my-worktree');

  // Main repo .git dir
  await fsp.mkdir(path.join(mainRoot, '.git', 'worktrees', 'my-worktree'), { recursive: true });

  // Worktree working dir — .git is a FILE pointing to the gitdir inside .git/worktrees/
  await fsp.mkdir(worktreeRoot, { recursive: true });
  const gitDirForWorktree = path.join(mainRoot, '.git', 'worktrees', 'my-worktree');
  await fsp.writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${gitDirForWorktree}\n`, 'utf8');

  return { mainRoot, worktreeRoot };
}

/**
 * Simulate a git worktree layout where the worktree gitdir contains a
 * `commondir` file with a relative path — the real-world git default for
 * `git worktree add`.  The relative path `"../.."` resolves from
 * `<mainRoot>/.git/worktrees/<name>` to `<mainRoot>/.git`.
 *
 * Returns { mainRoot, worktreeRoot }.
 */
async function makeWorktreeLayoutWithCommondir(
  base: string,
): Promise<{ mainRoot: string; worktreeRoot: string }> {
  const mainRoot = path.join(base, 'main-repo');
  const worktreeRoot = path.join(base, 'my-worktree');

  const gitDirForWorktree = path.join(mainRoot, '.git', 'worktrees', 'my-worktree');
  await fsp.mkdir(gitDirForWorktree, { recursive: true });

  // Write commondir with relative path — "../.." → <mainRoot>/.git
  await fsp.writeFile(path.join(gitDirForWorktree, 'commondir'), '../..\n', 'utf8');

  // Worktree working dir — .git is a FILE pointing to the gitdir
  await fsp.mkdir(worktreeRoot, { recursive: true });
  await fsp.writeFile(path.join(worktreeRoot, '.git'), `gitdir: ${gitDirForWorktree}\n`, 'utf8');

  return { mainRoot, worktreeRoot };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('installHooks', () => {
  // AC-009: create from scratch — .claude/settings.local.json does not exist
  it('creates settings.local.json with hook when file absent, returns { installed: true, locations: [...] }', async () => {
    const dir = await makeTmpDir();

    const result = await installHooks(dir);

    expect(result.installed).toBe(true);
    expect(result.locations).toEqual([path.join(dir, '.claude', 'settings.local.json')]);

    const settings = await readSettings(dir);
    expect(settings.hooks?.Stop).toBeDefined();
    const stopHooks = settings.hooks!.Stop;
    expect(stopHooks).toHaveLength(1);
    expect(stopHooks[0]).toEqual({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  });

  // AC-010: idempotency — running twice does not duplicate the hook entry
  it('returns { installed: false, locations: [] } on second run and does not duplicate hook', async () => {
    const dir = await makeTmpDir();

    const first = await installHooks(dir);
    expect(first.installed).toBe(true);

    const second = await installHooks(dir);
    expect(second.installed).toBe(false);
    expect(second.locations).toEqual([]);

    const settings = await readSettings(dir);
    const stopHooks = settings.hooks!.Stop;
    const matchingHooks = stopHooks.filter((h) => h.hooks?.some((c) => c.command === HOOK_COMMAND));
    expect(matchingHooks).toHaveLength(1);
  });

  // AC-009 variant: file exists with empty object {}
  it('inserts hook into partial settings (hooks absent), returns { installed: true, locations: [...] }', async () => {
    const dir = await makeTmpDir();
    await writeSettings(dir, {});

    const result = await installHooks(dir);

    expect(result.installed).toBe(true);
    expect(result.locations).toHaveLength(1);
    const settings = await readSettings(dir);
    expect(settings.hooks?.Stop).toBeDefined();
    expect(settings.hooks!.Stop[0]).toEqual({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });
  });

  // AC-009 variant: file exists with hooks: {} but no Stop key
  it('inserts hook when hooks exists but Stop is absent, returns { installed: true, locations: [...] }', async () => {
    const dir = await makeTmpDir();
    await writeSettings(dir, { hooks: {} });

    const result = await installHooks(dir);

    expect(result.installed).toBe(true);
    expect(result.locations).toHaveLength(1);
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

    expect(result.installed).toBe(true);
    expect(result.locations).toHaveLength(1);
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

  // -------------------------------------------------------------------------
  // AC-005: Worktree-aware hook installation
  // -------------------------------------------------------------------------

  // (a) Non-worktree: existing behavior unchanged — only cwd/.claude/settings.local.json written
  it('AC-005(a): non-worktree — writes only to cwd/.claude/settings.local.json', async () => {
    const base = await makeTmpDir();
    // Plain repo: .git is a directory, not a worktree
    const repoRoot = path.join(base, 'plain-repo');
    await fsp.mkdir(path.join(repoRoot, '.git'), { recursive: true });
    // git-dir == git-common-dir → not a worktree

    const result = await installHooks(repoRoot);

    const expectedSettingsPath = path.join(repoRoot, '.claude', 'settings.local.json');
    expect(result.installed).toBe(true);
    expect(result.locations).toEqual([expectedSettingsPath]);

    // Settings written in repoRoot
    const settings = await readSettings(repoRoot);
    expect(settings.hooks?.Stop).toHaveLength(1);
    expect(settings.hooks!.Stop[0]).toEqual({
      matcher: '',
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
    // No extra files written — only one .claude dir exists
    const claudeDir = path.join(repoRoot, '.claude');
    const files = await fsp.readdir(claudeDir);
    expect(files.filter((f) => f === 'settings.local.json')).toHaveLength(1);
  });

  // (b) Worktree: hook written to BOTH worktree .claude and main repo .claude (fallback path)
  it('AC-005(b): worktree — writes hook to both worktree and main repo settings', async () => {
    const base = await makeTmpDir();
    const { mainRoot, worktreeRoot } = await makeWorktreeLayout(base);

    const result = await installHooks(worktreeRoot);

    expect(result.installed).toBe(true);
    expect(result.locations).toHaveLength(2);
    expect(result.locations).toContain(path.join(worktreeRoot, '.claude', 'settings.local.json'));
    expect(result.locations).toContain(path.join(mainRoot, '.claude', 'settings.local.json'));

    // Hook installed in worktree's own .claude dir
    const worktreeSettings = await readSettings(worktreeRoot);
    expect(worktreeSettings.hooks?.Stop).toBeDefined();
    expect(
      worktreeSettings.hooks!.Stop.some((h) =>
        h.hooks?.some((c) => c.command === HOOK_COMMAND),
      ),
    ).toBe(true);

    // Hook ALSO installed in main repo's .claude dir
    const mainSettings = await readSettings(mainRoot);
    expect(mainSettings.hooks?.Stop).toBeDefined();
    expect(
      mainSettings.hooks!.Stop.some((h) =>
        h.hooks?.some((c) => c.command === HOOK_COMMAND),
      ),
    ).toBe(true);
  });

  // (b2) Worktree with commondir file (relative path) — real-world git default
  it('AC-005(b2): worktree with commondir file (relative "../..") — resolves main root correctly', async () => {
    const base = await makeTmpDir();
    const { mainRoot, worktreeRoot } = await makeWorktreeLayoutWithCommondir(base);

    const result = await installHooks(worktreeRoot);

    expect(result.installed).toBe(true);
    expect(result.locations).toHaveLength(2);
    expect(result.locations).toContain(path.join(worktreeRoot, '.claude', 'settings.local.json'));
    expect(result.locations).toContain(path.join(mainRoot, '.claude', 'settings.local.json'));

    // Hook in worktree
    const worktreeSettings = await readSettings(worktreeRoot);
    expect(
      worktreeSettings.hooks!.Stop.some((h) =>
        h.hooks?.some((c) => c.command === HOOK_COMMAND),
      ),
    ).toBe(true);

    // Hook in main repo
    const mainSettings = await readSettings(mainRoot);
    expect(
      mainSettings.hooks!.Stop.some((h) =>
        h.hooks?.some((c) => c.command === HOOK_COMMAND),
      ),
    ).toBe(true);
  });

  // (c) Idempotent re-install in worktree: running twice must not duplicate entries
  it('AC-005(c): worktree — re-install is idempotent (no duplicate entries in either location)', async () => {
    const base = await makeTmpDir();
    const { mainRoot, worktreeRoot } = await makeWorktreeLayout(base);

    const first = await installHooks(worktreeRoot);
    expect(first.installed).toBe(true);
    expect(first.locations).toHaveLength(2);

    const second = await installHooks(worktreeRoot);
    expect(second.installed).toBe(false);
    expect(second.locations).toHaveLength(0);

    // Worktree: exactly one matching hook entry
    const worktreeSettings = await readSettings(worktreeRoot);
    const worktreeMatches = worktreeSettings.hooks!.Stop.filter((h) =>
      h.hooks?.some((c) => c.command === HOOK_COMMAND),
    );
    expect(worktreeMatches).toHaveLength(1);

    // Main repo: exactly one matching hook entry
    const mainSettings = await readSettings(mainRoot);
    const mainMatches = mainSettings.hooks!.Stop.filter((h) =>
      h.hooks?.some((c) => c.command === HOOK_COMMAND),
    );
    expect(mainMatches).toHaveLength(1);
  });

  // (d) Partial worktree state: worktree already has hook, main does not
  //     installed=true because main is a new write; locations contains only main path
  it('AC-005(d): worktree partial state — worktree has hook, main does not; installed=true, locations=[main]', async () => {
    const base = await makeTmpDir();
    const { mainRoot, worktreeRoot } = await makeWorktreeLayout(base);

    // Pre-install hook only in worktree
    await installHooks(worktreeRoot);
    // Manually remove the main-repo hook to simulate partial state
    const mainSettingsPath = path.join(mainRoot, '.claude', 'settings.local.json');
    await fsp.unlink(mainSettingsPath);

    const result = await installHooks(worktreeRoot);

    // Main had no hook → new write → installed=true, locations=[main]
    expect(result.installed).toBe(true);
    expect(result.locations).toEqual([mainSettingsPath]);

    // Worktree still has exactly one hook (no duplicate)
    const worktreeSettings = await readSettings(worktreeRoot);
    const worktreeMatches = worktreeSettings.hooks!.Stop.filter((h) =>
      h.hooks?.some((c) => c.command === HOOK_COMMAND),
    );
    expect(worktreeMatches).toHaveLength(1);

    // Main now has exactly one hook
    const mainSettings = await readSettings(mainRoot);
    const mainMatches = mainSettings.hooks!.Stop.filter((h) =>
      h.hooks?.some((c) => c.command === HOOK_COMMAND),
    );
    expect(mainMatches).toHaveLength(1);
  });

  // (e) Partial-failure: main write throws — error propagates, states accurately reported
  it('AC-005(e): worktree — if main write fails after worktree write, error indicates which side failed', async () => {
    const base = await makeTmpDir();
    const { mainRoot, worktreeRoot } = await makeWorktreeLayout(base);

    // Make main .claude dir a FILE so mkdir/writeFile fails
    const mainClaudeDir = path.join(mainRoot, '.claude');
    await fsp.writeFile(mainClaudeDir, 'not-a-dir');

    await expect(installHooks(worktreeRoot)).rejects.toThrow(/main repo/i);

    // Worktree write DID succeed before the main write failed
    const worktreeSettings = await readSettings(worktreeRoot);
    expect(
      worktreeSettings.hooks!.Stop.some((h) =>
        h.hooks?.some((c) => c.command === HOOK_COMMAND),
      ),
    ).toBe(true);
  });
});
