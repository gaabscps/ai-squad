import fs from 'fs/promises';
import path from 'path';

import type { ClaudeHookEntry, ClaudeSettings } from './types';

export const HOOK_COMMAND = 'npx @ai-squad/agentops capture';

export async function installHooks(cwd: string = process.cwd()): Promise<{ installed: boolean }> {
  const settingsPath = path.join(cwd, '.claude', 'settings.local.json');

  // Read existing settings or start fresh
  let settings: ClaudeSettings = {};
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    settings = JSON.parse(raw) as ClaudeSettings;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err; // propagate: permission errors, malformed JSON → caller must handle
    }
    // File not found — start with empty settings
  }

  // Ensure hooks.Stop exists
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.Stop) settings.hooks.Stop = [];

  const stopHooks = settings.hooks.Stop;

  // Idempotency check — already installed?
  if (stopHooks.some((h: ClaudeHookEntry) => h.hooks?.some((c) => c.command === HOOK_COMMAND))) {
    return { installed: false };
  }

  // Insert the hook in the nested Claude Code format
  stopHooks.push({ matcher: '', hooks: [{ type: 'command', command: HOOK_COMMAND }] });

  // Atomic write: tmp file + rename
  const dir = path.dirname(settingsPath);
  await fs.mkdir(dir, { recursive: true });
  const tmpPath = path.join(dir, `.settings.local.json.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmpPath, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(tmpPath, settingsPath);

  return { installed: true };
}
