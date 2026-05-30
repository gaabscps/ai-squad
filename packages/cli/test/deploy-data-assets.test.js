import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyHookDataAssets, copySkillTemplates } from '../lib/deploy.js';

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function makeDirs() {
  const base = await mkdtemp(join(tmpdir(), 'aisquad-deploy-'));
  const hooksSrc = join(base, 'src');
  const destDir = join(base, 'dst');
  await mkdir(hooksSrc, { recursive: true });
  await mkdir(destDir, { recursive: true });
  return { hooksSrc, destDir };
}

test('copyHookDataAssets: copies model_prices.json when present', async () => {
  const { hooksSrc, destDir } = await makeDirs();
  await writeFile(join(hooksSrc, 'model_prices.json'), '{"models":{}}');

  const copied = await copyHookDataAssets({ hooksSrc, destDir });

  assert.deepEqual(copied, ['model_prices.json']);
  assert.ok(await exists(join(destDir, 'model_prices.json')));
  assert.equal(await readFile(join(destDir, 'model_prices.json'), 'utf8'), '{"models":{}}');
});

test('copyHookDataAssets: no-op when asset absent (no crash)', async () => {
  const { hooksSrc, destDir } = await makeDirs();

  const copied = await copyHookDataAssets({ hooksSrc, destDir });

  assert.deepEqual(copied, []);
  assert.ok(!(await exists(join(destDir, 'model_prices.json'))));
});

test('copySkillTemplates: copies the mapped template into the skill dir, renamed', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aisquad-tpl-'));
  const squadRoot = join(base, 'sdd');
  await mkdir(join(squadRoot, 'templates'), { recursive: true });
  await writeFile(join(squadRoot, 'templates', 'spec.md'), '# spec template');
  const destDir = join(base, 'spec-writer');
  await mkdir(destDir, { recursive: true });

  const copied = await copySkillTemplates({ squadRoot, skill: 'spec-writer', destDir });

  assert.deepEqual(copied, ['spec.template.md']);
  assert.equal(await readFile(join(destDir, 'spec.template.md'), 'utf8'), '# spec template');
});

test('copySkillTemplates: no-op for a skill with no mapped template', async () => {
  const base = await mkdtemp(join(tmpdir(), 'aisquad-tpl-'));
  const squadRoot = join(base, 'sdd');
  await mkdir(join(squadRoot, 'templates'), { recursive: true });
  const destDir = join(base, 'orchestrator');
  await mkdir(destDir, { recursive: true });

  const copied = await copySkillTemplates({ squadRoot, skill: 'orchestrator', destDir });

  assert.deepEqual(copied, []);
});
