import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runDeploy } from '../lib/deploy.js';

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Writes a minimal <dir>/<name>/skill.md so the deploy loop has a real skill
// to copy (and checkLength has a file to read).
async function makeSkill(skillsDir, name) {
  const dst = join(skillsDir, name);
  await mkdir(dst, { recursive: true });
  const body = ['---', `name: ${name}`, 'description: test skill', '---', `# ${name}`].join('\n');
  await writeFile(join(dst, 'skill.md'), body + '\n');
}

// Builds a temp components/ tree with one squad skill (sdd/spec-writer) and one
// shared-tier skill (shared/ship). Returns { root, pkgRoot, home, repoRoot }.
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ai-squad-shared-'));
  const pkgRoot = join(root, 'pkg');
  const home = join(root, 'home');
  const repoRoot = join(root, 'repo');
  await mkdir(home, { recursive: true });
  await mkdir(repoRoot, { recursive: true });

  const components = join(pkgRoot, 'components');
  await makeSkill(join(components, 'sdd', 'skills'), 'spec-writer');
  await makeSkill(join(components, 'shared', 'skills'), 'ship');

  return { root, pkgRoot, home, repoRoot };
}

test('runDeploy: shared-tier skills deploy even for a single --squad install', async () => {
  const { root, pkgRoot, home, repoRoot } = await makeFixture();
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  try {
    await runDeploy({ pkgRoot, squads: ['sdd'], repoRoot, globalOnly: true });
  } finally {
    process.env.HOME = prevHome;
  }

  assert.ok(
    await pathExists(join(home, '.claude', 'skills', 'spec-writer', 'skill.md')),
    'selected squad skill (spec-writer) should deploy',
  );
  assert.ok(
    await pathExists(join(home, '.claude', 'skills', 'ship', 'skill.md')),
    'shared-tier /ship MUST deploy even when only --squad sdd is selected',
  );

  await rm(root, { recursive: true, force: true });
});

test('runDeploy: `shared` is not a selectable --squad target', async () => {
  const { root, pkgRoot, repoRoot } = await makeFixture();

  await assert.rejects(
    () => runDeploy({ pkgRoot, squads: ['shared'], repoRoot, globalOnly: true }),
    /unknown squad 'shared'/,
    'shared is a cross-squad tier, never a squad you can target directly',
  );

  await rm(root, { recursive: true, force: true });
});
