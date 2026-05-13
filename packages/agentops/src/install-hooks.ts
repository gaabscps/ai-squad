import fs from 'fs/promises';
import path from 'path';

import type { ClaudeHookEntry, ClaudeSettings } from './types';

/**
 * Stop hook — invokes `agentops capture` after a session, which regenerates
 * the HTML report from `.agent-session/<task_id>/` artifacts.
 *
 * NOTE: For the full SDD framework (hooks + subagent usage capture + tier
 * calibration enforcement), prefer `ai-squad deploy` from @ai-squad/cli —
 * it covers this hook plus the Python pipeline guards in one step. This
 * command remains for standalone agentops use cases.
 */
export const HOOK_COMMAND = 'npx @ai-squad/agentops capture';

/**
 * Detect whether `cwd` is a git worktree.
 *
 * In a worktree, `<cwd>/.git` is a FILE (not a directory) with contents like:
 *   gitdir: /path/to/main-repo/.git/worktrees/<name>
 *
 * Returns the absolute path to the main repo root if we're in a worktree,
 * or null if this is a plain checkout.
 */
async function detectWorktreeMainRoot(cwd: string): Promise<string | null> {
  const dotGit = path.join(cwd, '.git');

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(dotGit);
  } catch {
    // No .git at all — can't determine; treat as non-worktree
    return null;
  }

  // If .git is a directory → normal checkout (or bare; not a worktree)
  if (stat.isDirectory()) {
    return null;
  }

  // .git is a file → worktree.  Read it to get the gitdir path.
  const dotGitContent = await fs.readFile(dotGit, 'utf8');
  const match = /^gitdir:\s*(.+)$/m.exec(dotGitContent.trim());
  if (!match) return null;

  const worktreeGitDir = match[1].trim(); // e.g. /main/.git/worktrees/my-wt

  // The commondir file inside the worktree gitdir tells us where the main .git lives.
  // It contains either an absolute path or a relative path from worktreeGitDir.
  let commonDir: string;
  try {
    const commondirContent = await fs.readFile(
      path.join(worktreeGitDir, 'commondir'),
      'utf8',
    );
    const raw = commondirContent.trim();
    // Relative paths are relative to worktreeGitDir
    commonDir = path.isAbsolute(raw) ? raw : path.resolve(worktreeGitDir, raw);
  } catch {
    // No commondir file — fall back to structural inference.  Real-world git
    // writes commondir, but older or non-standard setups may omit it.
    // worktreeGitDir: /main/.git/worktrees/<name>  →  dirname×2 = /main/.git
    commonDir = path.dirname(path.dirname(worktreeGitDir));
    // commonDir is now the .git dir itself; main root is its parent
    return path.dirname(commonDir);
  }

  // commonDir is the main .git directory; main repo root is its parent
  return path.dirname(commonDir);
}

/**
 * Read + merge + write a single settings file idempotently.
 * Returns true if the Stop hook was newly inserted, false if already present.
 */
async function installHookToSettings(settingsPath: string): Promise<boolean> {
  let settings: ClaudeSettings = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    settings = JSON.parse(raw) as ClaudeSettings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
    // File not found — start with empty settings
  }

  if (!settings.hooks) settings.hooks = {};
  const stopHooks = (settings.hooks.Stop ??= []);
  if (stopHooks.some((h: ClaudeHookEntry) => h.hooks?.some((c) => c.command === HOOK_COMMAND))) {
    return false;
  }
  stopHooks.push({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });

  const dir = path.dirname(settingsPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.settings.local.json.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
  try {
    await fs.rename(tmpPath, settingsPath);
  } finally {
    // Best-effort cleanup: remove tmp if rename failed (ignore ENOENT — already moved).
    await fs.unlink(tmpPath).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }

  return true;
}

export interface InstallHooksResult {
  /** True if this call wrote a new hook entry in at least one location. */
  installed: boolean;
  /** Paths where this call newly registered the hook (empty when fully idempotent). */
  locations: string[];
}

export async function installHooks(cwd: string = process.cwd()): Promise<InstallHooksResult> {
  const worktreeSettingsPath = path.join(cwd, '.claude', 'settings.local.json');
  const mainRoot = await detectWorktreeMainRoot(cwd);

  if (mainRoot !== null) {
    // Worktree path: write to both locations.  Both must succeed atomically; if
    // the main-repo write fails after the worktree write, throw clearly so the
    // caller knows the state is partial and the main-repo side needs a retry.
    const locations: string[] = [];

    let worktreeInstalled: boolean;
    try {
      worktreeInstalled = await installHookToSettings(worktreeSettingsPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `installHooks: worktree write failed — worktree: ${worktreeSettingsPath}. ` +
          `Original error: ${msg}`,
      );
    }
    if (worktreeInstalled) locations.push(worktreeSettingsPath);

    const mainSettingsPath = path.join(mainRoot, '.claude', 'settings.local.json');
    let mainInstalled: boolean;
    try {
      mainInstalled = await installHookToSettings(mainSettingsPath);
    } catch (err) {
      // Worktree write already completed — surface which side failed so callers
      // can detect the partial state and retry the main-repo side.
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `installHooks: worktree write succeeded but main repo write failed — ` +
          `worktree: ${worktreeSettingsPath}, main repo: ${mainSettingsPath}. ` +
          `Original error: ${msg}`,
      );
    }
    if (mainInstalled) locations.push(mainSettingsPath);

    return { installed: locations.length > 0, locations };
  }

  // Non-worktree path: original single-file behavior
  const installed = await installHookToSettings(worktreeSettingsPath);
  return {
    installed,
    locations: installed ? [worktreeSettingsPath] : [],
  };
}
