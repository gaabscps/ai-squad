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

// Creates a non-skill subdir under skills/ (mirrors squads/<squad>/skills/__tests__/):
// a directory holding only a .md file and crucially NO skill.md. It must never be
// treated as a deployable skill.
async function makeNonSkillDir(skillsDir, name, fileName) {
  const dst = join(skillsDir, name);
  await mkdir(dst, { recursive: true });
  await writeFile(join(dst, fileName), '# not a skill — test fixture\n');
}

// Builds a temp components/ tree with a real squad skill (sdd/spec-writer) and a
// real shared-tier skill (shared/ship), each polluted with a sibling __tests__
// dir that carries no skill.md. Returns { root, pkgRoot, home, repoRoot }.
async function makeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'ai-squad-skip-nonskill-'));
  const pkgRoot = join(root, 'pkg');
  const home = join(root, 'home');
  const repoRoot = join(root, 'repo');
  await mkdir(home, { recursive: true });
  await mkdir(repoRoot, { recursive: true });

  const components = join(pkgRoot, 'components');

  const sddSkills = join(components, 'sdd', 'skills');
  await makeSkill(sddSkills, 'spec-writer');
  await makeNonSkillDir(sddSkills, '__tests__', 'test_pm_bypass_integration.md');

  const sharedSkills = join(components, 'shared', 'skills');
  await makeSkill(sharedSkills, 'ship');
  await makeNonSkillDir(sharedSkills, '__tests__', 'test_ship.md');

  return { root, pkgRoot, home, repoRoot };
}

test('runDeploy: a __tests__ dir under skills/ is NOT deployed as a skill (squad + shared tiers)', async () => {
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
    'real squad skill (spec-writer) should deploy',
  );
  assert.ok(
    await pathExists(join(home, '.claude', 'skills', 'ship', 'skill.md')),
    'real shared-tier skill (ship) should deploy',
  );
  assert.equal(
    await pathExists(join(home, '.claude', 'skills', '__tests__')),
    false,
    '__tests__ has no skill.md and MUST NOT be deployed (covers both the squad and shared loops)',
  );

  await rm(root, { recursive: true, force: true });
});
