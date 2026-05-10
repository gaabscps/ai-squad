/**
 * deploy — port of tools/deploy.sh in pure Node.js (ESM, stdlib only).
 *
 * Copies bundled squad components from packages/cli/components/<squad>/
 * into ~/.claude/{skills,agents,hooks}/ (flat — Claude Code has no
 * per-squad namespace; names must be globally unique within the bundle).
 *
 * Hook scripts get chmod +x. Length warnings emitted for skills > 300 lines
 * and agents > 150 lines (system prompt budget for fan-out subagents).
 *
 * Cursor mirror (--cursor): copies *.py hooks to ~/.cursor/hooks/ai-squad/
 * and merges <squad>/hooks/cursor-hooks.json into ~/.cursor/hooks.json
 * (additive, deduped by command path).
 */
import { chmod, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const SKILL_LINE_CAP = 300;
const AGENT_LINE_CAP = 150;

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function listDirs(p) {
  if (!(await isDir(p))) return [];
  const entries = await readdir(p, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function listFiles(p, ext) {
  if (!(await isDir(p))) return [];
  const entries = await readdir(p, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name);
}

async function lineCount(filePath) {
  const txt = await readFile(filePath, 'utf8');
  return txt.split('\n').length;
}

async function checkLength(file, cap, label) {
  if (!(await exists(file))) return;
  const lines = await lineCount(file);
  if (lines > cap) {
    console.log(`  [WARN] ${label}: ${lines} lines (cap: ${cap})`);
  }
}

async function deployClaudeCode({ componentsRoot, squads }) {
  const home = homedir();
  const skillsDst = join(home, '.claude', 'skills');
  const agentsDst = join(home, '.claude', 'agents');
  const hooksDst = join(home, '.claude', 'hooks');

  await mkdir(skillsDst, { recursive: true });
  await mkdir(agentsDst, { recursive: true });
  await mkdir(hooksDst, { recursive: true });

  console.log('ai-squad deploy (Claude Code)');
  console.log(`  squads:  ${squads.join(', ')}`);
  console.log(`  skills:  -> ${skillsDst}  (cap: ${SKILL_LINE_CAP} lines)`);
  console.log(`  agents:  -> ${agentsDst}  (cap: ${AGENT_LINE_CAP} lines)`);
  console.log(`  hooks:   -> ${hooksDst}   (Python 3 stdlib; chmod +x preserved)`);
  console.log('');

  for (const squad of squads) {
    console.log(`[squad: ${squad}]`);
    const squadRoot = join(componentsRoot, squad);

    // Skills (each is a directory with skill.md + optional resources)
    const skillsSrc = join(squadRoot, 'skills');
    for (const skill of await listDirs(skillsSrc)) {
      const src = join(skillsSrc, skill);
      const dst = join(skillsDst, skill);
      const action = (await exists(dst)) ? '[update skill]' : '[install skill]';
      console.log(`  ${action}   ${skill}`);
      await checkLength(join(src, 'skill.md'), SKILL_LINE_CAP, `${skill}/skill.md`);
      await mkdir(dst, { recursive: true });
      await cp(src, dst, { recursive: true });
    }

    // Agents (flat *.md files)
    const agentsSrc = join(squadRoot, 'agents');
    for (const agentFile of await listFiles(agentsSrc, '.md')) {
      const src = join(agentsSrc, agentFile);
      const dst = join(agentsDst, agentFile);
      const action = (await exists(dst)) ? '[update agent]' : '[install agent]';
      console.log(`  ${action}   ${basename(agentFile, '.md')}`);
      await checkLength(src, AGENT_LINE_CAP, agentFile);
      await cp(src, dst);
    }

    // Hooks (flat *.py files; chmod +x)
    const hooksSrc = join(squadRoot, 'hooks');
    for (const hookFile of await listFiles(hooksSrc, '.py')) {
      const src = join(hooksSrc, hookFile);
      const dst = join(hooksDst, hookFile);
      const action = (await exists(dst)) ? '[update hook]' : '[install hook]';
      console.log(`  ${action}    ${hookFile}`);
      await cp(src, dst);
      await chmod(dst, 0o755);
    }
  }

  console.log('');
  console.log('Done. ai-squad available in Claude Code.');
}

async function deployCursor({ componentsRoot, squads }) {
  const home = homedir();
  const cursorHooksDst = join(home, '.cursor', 'hooks', 'ai-squad');
  const cursorConfigPath = join(home, '.cursor', 'hooks.json');

  await mkdir(cursorHooksDst, { recursive: true });

  console.log('');
  console.log('ai-squad deploy (Cursor)');
  console.log(`  hooks:   -> ${cursorHooksDst}`);
  console.log(`  config:  -> ${cursorConfigPath} (merged additively)`);
  console.log('');

  let cursorConfig = { version: 1, hooks: {} };
  if (await exists(cursorConfigPath)) {
    try {
      cursorConfig = JSON.parse(await readFile(cursorConfigPath, 'utf8'));
      cursorConfig.hooks ??= {};
    } catch (err) {
      console.error(`  [WARN] could not parse existing ${cursorConfigPath}: ${err.message}`);
      console.error('  [WARN] aborting Cursor merge to avoid clobbering it. Run with care.');
      return;
    }
  }

  for (const squad of squads) {
    console.log(`[squad: ${squad}]`);
    const hooksSrc = join(componentsRoot, squad, 'hooks');

    for (const hookFile of await listFiles(hooksSrc, '.py')) {
      const src = join(hooksSrc, hookFile);
      const dst = join(cursorHooksDst, hookFile);
      console.log(`  [sync hook]   ${hookFile}`);
      await cp(src, dst);
      await chmod(dst, 0o755);
    }

    // Merge cursor-hooks.json
    const squadHooksJson = join(hooksSrc, 'cursor-hooks.json');
    if (await exists(squadHooksJson)) {
      const squadConfig = JSON.parse(await readFile(squadHooksJson, 'utf8'));
      for (const [eventName, entries] of Object.entries(squadConfig.hooks || {})) {
        cursorConfig.hooks[eventName] ??= [];
        const existingCmds = new Set(cursorConfig.hooks[eventName].map((e) => e.command));
        for (const entry of entries) {
          if (!existingCmds.has(entry.command)) {
            cursorConfig.hooks[eventName].push(entry);
            console.log(`  [add hook]    ${eventName}: ${entry.command}`);
          }
        }
      }
    }
  }

  await writeFile(cursorConfigPath, JSON.stringify(cursorConfig, null, 2) + '\n');
  console.log('');
  console.log('Done. ai-squad available in Cursor.');
}

export async function runDeploy({ pkgRoot, squads = [], cursor = false }) {
  const componentsRoot = join(pkgRoot, 'components');

  if (!(await isDir(componentsRoot))) {
    throw new Error(
      `components directory not found at ${componentsRoot}. ` +
        `If running from source, run 'npm run sync' first to bundle squads.`,
    );
  }

  const available = await listDirs(componentsRoot);
  if (available.length === 0) {
    throw new Error(`no squads found under ${componentsRoot}`);
  }

  let target;
  if (squads.length > 0) {
    for (const s of squads) {
      if (!available.includes(s)) {
        throw new Error(`unknown squad '${s}' (available: ${available.join(', ')})`);
      }
    }
    target = squads;
  } else {
    target = available;
  }

  await deployClaudeCode({ componentsRoot, squads: target });
  if (cursor) {
    await deployCursor({ componentsRoot, squads: target });
  }
}
