import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { join } from 'node:path';

import { bundleFilter } from '../scripts/sync-components.mjs';

test('bundleFilter: keeps real skill assets', () => {
  assert.equal(bundleFilter(join('squads', 'sdd', 'skills', 'orchestrator', 'skill.md')), true);
  assert.equal(bundleFilter(join('squads', 'sdd', 'hooks', 'verify-output-packet.py')), true);
});

test('bundleFilter: drops a __tests__ dir under skills/ (the deploy-as-skill bug source)', () => {
  assert.equal(bundleFilter(join('squads', 'sdd', 'skills', '__tests__')), false);
  assert.equal(
    bundleFilter(join('squads', 'sdd', 'skills', '__tests__', 'test_pm_bypass_integration.md')),
    false,
  );
});

test('bundleFilter: drops python caches and bytecode', () => {
  assert.equal(bundleFilter(join('squads', 'sdd', 'hooks', '__pycache__')), false);
  assert.equal(bundleFilter(join('squads', 'sdd', 'hooks', 'verify-output-packet.cpython-312.pyc')), false);
});
