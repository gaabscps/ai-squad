import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyHookDataAssets } from '../lib/deploy.js';

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
