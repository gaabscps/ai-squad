import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { SKILL_TEMPLATES } from '../lib/deploy.js';

// Source of truth lives at repo-root squads/ (sync copies it to components/,
// deploy injects per-skill from there). Guarding the source guards the chain.
const SQUADS_DIR = fileURLToPath(new URL('../../../squads/', import.meta.url));
const TEMPLATE_REF = /\b([a-z][a-z0-9-]*\.template\.md)\b/g;

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function listSkills() {
  const out = [];
  for (const squad of await readdir(SQUADS_DIR)) {
    const skillsDir = join(SQUADS_DIR, squad, 'skills');
    if (!(await exists(skillsDir))) continue;
    for (const skill of await readdir(skillsDir)) {
      const skillMd = join(skillsDir, skill, 'skill.md');
      if (await exists(skillMd)) {
        out.push({ squad, skill, skillMd, templatesDir: join(SQUADS_DIR, squad, 'templates') });
      }
    }
  }
  return out;
}

// Forward guard: a skill.md that references `<name>.template.md` must have a
// SKILL_TEMPLATES mapping producing that destName, and the mapped source file
// must exist. Without this, a skill could reference a template that the deploy
// never injects — a dead reference that only fails inside a consumer repo.
test('every *.template.md referenced in a skill.md is mapped and its source exists', async () => {
  const skills = await listSkills();
  assert.ok(skills.length > 0, 'expected skills under squads/*/skills/');
  for (const { squad, skill, skillMd, templatesDir } of skills) {
    const body = await readFile(skillMd, 'utf8');
    const referenced = new Set([...body.matchAll(TEMPLATE_REF)].map((m) => m[1]));
    for (const dstName of referenced) {
      const mapping = SKILL_TEMPLATES[skill];
      assert.ok(mapping, `${squad}/${skill}/skill.md references ${dstName} but has no SKILL_TEMPLATES entry`);
      const pair = mapping.find(([, dst]) => dst === dstName);
      assert.ok(pair, `${squad}/${skill}/skill.md references ${dstName} but no SKILL_TEMPLATES pair produces it`);
      const srcPath = join(templatesDir, pair[0]);
      assert.ok(await exists(srcPath), `SKILL_TEMPLATES maps ${skill} -> ${dstName} from ${pair[0]}, but ${srcPath} is missing`);
    }
  }
});

// Reverse guard: a mapping must point at a skill that exists and a source
// template that exists — no orphan or dangling entries.
test('every SKILL_TEMPLATES entry targets a real skill and an existing source template', async () => {
  const skills = await listSkills();
  const skillToSquad = new Map(skills.map((s) => [s.skill, s.squad]));
  for (const [skill, pairs] of Object.entries(SKILL_TEMPLATES)) {
    const squad = skillToSquad.get(skill);
    assert.ok(squad, `SKILL_TEMPLATES has '${skill}' but no such skill exists under squads/*/skills/`);
    for (const [srcName] of pairs) {
      const srcPath = join(SQUADS_DIR, squad, 'templates', srcName);
      assert.ok(await exists(srcPath), `SKILL_TEMPLATES[${skill}] source ${srcName} missing at ${srcPath}`);
    }
  }
});
