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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '..', '..');
const SQUADS_SRC = join(REPO_ROOT, 'squads');
const COMPONENTS_DST = join(PKG_ROOT, 'components');

// Subdirs of each squad to bundle. Hooks include .py scripts;
// skills/agents are markdown; templates/docs are referenced by skills.
const SQUAD_SUBDIRS = ['skills', 'agents', 'hooks', 'templates', 'docs'];

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
    await cp(src, dst, { recursive: true });
    console.log(`  [sync] ${squad}/${sub}`);
  }
}

async function main() {
  console.log('ai-squad cli: syncing components from squads/ -> packages/cli/components/');
  await rm(COMPONENTS_DST, { recursive: true, force: true });
  await mkdir(COMPONENTS_DST, { recursive: true });
  const squads = await listSquads();
  for (const squad of squads) {
    console.log(`[squad: ${squad}]`);
    await syncSquad(squad);
  }
  console.log(`Done. squads bundled: ${squads.join(', ')}`);
}

main().catch((err) => {
  console.error('sync-components failed:', err);
  process.exit(1);
});
