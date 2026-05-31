#!/usr/bin/env node
/**
 * sync-components — copies squads/<squad>/{skills,agents,hooks,templates,docs}/
 * from the monorepo source-of-truth into packages/cli/components/ so that
 * `npm pack` / `npm publish` ships a self-contained tarball.
 *
 * Runs automatically on `npm pack` / `npm publish` via the package's `prepack`
 * script. Also runnable manually via `npm run sync`.
 *
 * Source-of-truth stays in squads/<squad>/. We never edit components/ by hand —
 * it is regenerated on every publish. The directory is gitignored.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * cp() filter for the bundle. Drops artifacts that must never reach the
 * published tarball:
 *   - Python bytecode caches (`__pycache__/`, `*.pyc`)
 *   - test fixtures (`__tests__/`) — these are not deployable assets, and a
 *     `skills/__tests__/` dir would otherwise be bundled and then installed
 *     into ~/.claude/skills/ by deploy as if it were a skill.
 * Matched on path *segments* so a file merely named like one isn't dropped.
 */
export function bundleFilter(src) {
  if (src.endsWith('.pyc')) return false;
  const segments = src.split(sep);
  return !segments.includes('__pycache__') && !segments.includes('__tests__');
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const SQUADS_SRC = join(REPO_ROOT, 'squads');
const SHARED_SRC = join(REPO_ROOT, 'shared');
const COMPONENTS_DST = join(PKG_ROOT, 'components');

// Subdirs of each squad to bundle. Hooks include .py scripts;
// skills/agents are markdown; templates/docs are referenced by skills.
const SQUAD_SUBDIRS = ['skills', 'agents', 'hooks', 'templates', 'docs'];

// The `shared` tier holds cross-squad assets that must ship regardless of
// which squad is installed. Only `skills` (e.g. /ship) need bundling today;
// concepts/schemas/lib are docs/runtime read by deployed prompts, not copied
// into ~/.claude. Bundled into components/shared/ and deployed unconditionally.
const SHARED_SUBDIRS = ['skills'];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listSquads() {
  const entries = await readdir(SQUADS_SRC, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function syncSquad(squad) {
  const srcRoot = join(SQUADS_SRC, squad);
  const dstRoot = join(COMPONENTS_DST, squad);
  await mkdir(dstRoot, { recursive: true });

  for (const sub of SQUAD_SUBDIRS) {
    const src = join(srcRoot, sub);
    if (!(await exists(src))) continue;
    const dst = join(dstRoot, sub);
    await rm(dst, { recursive: true, force: true });
    await cp(src, dst, { recursive: true, filter: bundleFilter });
    console.log(`  [sync] ${squad}/${sub}`);
  }
}

async function syncShared() {
  const dstRoot = join(COMPONENTS_DST, 'shared');
  await mkdir(dstRoot, { recursive: true });

  for (const sub of SHARED_SUBDIRS) {
    const src = join(SHARED_SRC, sub);
    if (!(await exists(src))) continue;
    const dst = join(dstRoot, sub);
    await rm(dst, { recursive: true, force: true });
    await cp(src, dst, { recursive: true, filter: bundleFilter });
    console.log(`  [sync] shared/${sub}`);
  }
}

async function main() {
  console.log('ai-squad cli: syncing components from squads/ + shared/ -> packages/cli/components/');
  await rm(COMPONENTS_DST, { recursive: true, force: true });
  await mkdir(COMPONENTS_DST, { recursive: true });
  const squads = await listSquads();
  for (const squad of squads) {
    console.log(`[squad: ${squad}]`);
    await syncSquad(squad);
  }
  console.log('[shared tier]');
  await syncShared();
  console.log(`Done. squads bundled: ${squads.join(', ')}; shared tier bundled.`);
}

// Only run the sync when invoked as a script (`node sync-components.mjs`), not
// when imported by a test that just wants to exercise bundleFilter.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('sync-components failed:', err);
    process.exit(1);
  });
}
