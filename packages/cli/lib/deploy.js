/**
 * deploy — install ai-squad components in two scopes:
 *   - Skills + agents → ~/.claude/{skills,agents}/ (user-global, Claude Code
 *     discovery via Skills user-level path)
 *   - Hooks → <cwd>/.claude/hooks/ (per-repo, referenced via
 *     $CLAUDE_PROJECT_DIR/.claude/hooks/X.py in subagent/skill frontmatter)
 *
 * Rationale: hooks are operational, low-trust scripts that should be
 * (a) inspectable in the consuming repo, (b) versioned together with
 * the pipeline data they validate, and (c) deployable in CI without a
 * pre-seeded $HOME. Skills+agents are declarative prompt content and
 * can stay user-global without ergonomic loss.
 *
 * Hook scripts get chmod +x. The per-repo hook dir is appended to the
 * repo's .gitignore (idempotent) so deployed scripts don't pollute git
 * history; users re-run `ai-squad deploy` whenever they update the CLI.
 *
 * Cursor mirror (--cursor): copies *.py hooks to ~/.cursor/hooks/ai-squad/
 * (still global — Cursor lacks per-project hook config) and merges
 * <squad>/hooks/cursor-hooks.json into ~/.cursor/hooks.json (additive,
 * deduped by command path).
 */
import { appendFile, chmod, cp, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const SKILL_LINE_CAP = 300;
const AGENT_LINE_CAP = 150;
const GITIGNORE_BLOCK = '\n# ai-squad per-repo hook install (managed by `ai-squad deploy`)\n.claude/hooks/\n';

// Non-.py data assets a hook needs at runtime. The .py copy loops filter on
// `.endsWith('.py')`, so these must be copied explicitly or they never reach
// the consumer repo. Deployed in BOTH scopes (per-repo + global) so pricing.py's
// resolution chain (local -> global) always finds a price table; without it,
// cost capture degrades to tokens-only. This was the FEAT-010 cost-report gap.
const HOOK_DATA_ASSETS = ['model_prices.json'];

// Templates a skill READS/POPULATES at runtime. They live in <squad>/templates/
// (organized source of truth) but the skill can only resolve paths relative to
// its own base dir once deployed — so deploy copies each into the skill's dir as
// <name>.template.md. Without this, the skill falls back to the source repo (the
// "spec-writer looked in the local ai-squad repo" bug). Map: skill -> [[src, as]].
// Maps each skill to the runtime templates it populates: [sourceName in
// <squad>/templates/, destName injected into the deployed skill dir]. A skill's
// skill.md references the destName ("<name>.template.md in this skill's base
// directory") — copySkillTemplates puts it there at deploy time. The
// template-consistency test enforces that every referenced template is mapped
// here AND has a real source file, so a future skill can't ship a dead
// template reference that only surfaces in a consumer repo. Exported for that test.
export const SKILL_TEMPLATES = {
  'spec-writer': [['spec.md', 'spec.template.md']],
  'designer': [['plan.md', 'plan.template.md']],
  'task-builder': [['tasks.md', 'tasks.template.md']],
  'discovery-lead': [['memo.md', 'memo.template.md']],
};

/**
 * Known-defunct ai-squad hook registrations. Older deploys may have written
 * these into <repo>/.claude/settings.local.json; we strip them on every deploy
 * so the stale commands don't run (and fail noisily) at session events.
 *
 * The orphan-prune above only scopes `$CLAUDE_PROJECT_DIR/.claude/hooks/*.py`
 * commands by design (to avoid clobbering user-added hooks). This list covers
 * registrations the framework itself once shipped under different shapes
 * (npx-invoked packages, external scripts) that we have since retired.
 *
 * Add an entry every time we retire a registration the framework once shipped.
 */
const LEGACY_REGISTRATIONS = [
  {
    pattern: /@ai-squad\/agentops/,
    what: 'agentops capture pipeline',
    since: 'commit 3b30f82 (observability removal)',
  },
];

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

/**
 * Return the subdirectories of a skills/ dir that are actual skills — i.e. that
 * contain a `skill.md`. This is the Claude Code definition of a skill, and the
 * gate keeps non-skill siblings (notably `skills/__tests__/`, which holds test
 * fixtures, not a skill.md) from being copied into ~/.claude/skills/ as if they
 * were skills. Chosen over a hard-coded `__tests__` skip so any future non-skill
 * dir is excluded for free.
 */
async function listSkillDirs(skillsSrc) {
  const dirs = await listDirs(skillsSrc);
  const checks = await Promise.all(
    dirs.map(async (name) => (await exists(join(skillsSrc, name, 'skill.md'))) ? name : null),
  );
  return checks.filter((name) => name !== null);
}

async function lineCount(filePath) {
  const txt = await readFile(filePath, 'utf8');
  return txt.split('\n').length;
}

/**
 * Copy known non-.py hook data assets (HOOK_DATA_ASSETS) from a squad's hooks
 * source dir into destDir, when present. Returns the copied basenames.
 * Exported for unit testing; used in both the per-repo and global scopes.
 */
export async function copyHookDataAssets({ hooksSrc, destDir }) {
  const copied = [];
  for (const asset of HOOK_DATA_ASSETS) {
    const src = join(hooksSrc, asset);
    if (await exists(src)) {
      await cp(src, join(destDir, asset));
      copied.push(asset);
    }
  }
  return copied;
}

/**
 * Copy the runtime templates a skill populates (per SKILL_TEMPLATES) from
 * <squadRoot>/templates/ into the deployed skill dir, renamed to <name>.template.md.
 * Returns the copied destination basenames. Exported for unit testing.
 */
export async function copySkillTemplates({ squadRoot, skill, destDir }) {
  const copied = [];
  for (const [srcName, dstName] of SKILL_TEMPLATES[skill] || []) {
    const src = join(squadRoot, 'templates', srcName);
    if (await exists(src)) {
      await cp(src, join(destDir, dstName));
      copied.push(dstName);
    }
  }
  return copied;
}

async function checkLength(file, cap, label) {
  if (!(await exists(file))) return;
  const lines = await lineCount(file);
  if (lines > cap) {
    console.log(`  [WARN] ${label}: ${lines} lines (cap: ${cap})`);
  }
}

async function deployClaudeCodeGlobal({ componentsRoot, squads }) {
  const home = homedir();
  const skillsDst = join(home, '.claude', 'skills');
  const agentsDst = join(home, '.claude', 'agents');

  await mkdir(skillsDst, { recursive: true });
  await mkdir(agentsDst, { recursive: true });

  console.log('ai-squad deploy — Skills + Agents (user-global)');
  console.log(`  skills:  -> ${skillsDst}  (cap: ${SKILL_LINE_CAP} lines)`);
  console.log(`  agents:  -> ${agentsDst}  (cap: ${AGENT_LINE_CAP} lines)`);
  console.log('');

  for (const squad of squads) {
    console.log(`[squad: ${squad}]`);
    const squadRoot = join(componentsRoot, squad);

    const skillsSrc = join(squadRoot, 'skills');
    for (const skill of await listSkillDirs(skillsSrc)) {
      const src = join(skillsSrc, skill);
      const dst = join(skillsDst, skill);
      const action = (await exists(dst)) ? '[update skill]' : '[install skill]';
      console.log(`  ${action}   ${skill}`);
      await checkLength(join(src, 'skill.md'), SKILL_LINE_CAP, `${skill}/skill.md`);
      await mkdir(dst, { recursive: true });
      await cp(src, dst, { recursive: true });
      for (const tpl of await copySkillTemplates({ squadRoot, skill, destDir: dst })) {
        console.log(`  [template]       ${skill}/${tpl}`);
      }
    }

    const agentsSrc = join(squadRoot, 'agents');
    for (const agentFile of await listFiles(agentsSrc, '.md')) {
      const src = join(agentsSrc, agentFile);
      const dst = join(agentsDst, agentFile);
      const action = (await exists(dst)) ? '[update agent]' : '[install agent]';
      console.log(`  ${action}   ${basename(agentFile, '.md')}`);
      await checkLength(src, AGENT_LINE_CAP, agentFile);
      await cp(src, dst);
    }
  }

  // Global price-table fallback: pricing.py resolves local (per-repo) -> global
  // (~/.claude/hooks/). Install hook data assets globally so cost capture still
  // prices tokens in repos where `deploy --hooks-only` never ran.
  const hooksGlobalDst = join(home, '.claude', 'hooks');
  await mkdir(hooksGlobalDst, { recursive: true });
  for (const squad of squads) {
    const hooksSrc = join(componentsRoot, squad, 'hooks');
    for (const asset of await copyHookDataAssets({ hooksSrc, destDir: hooksGlobalDst })) {
      console.log(`  [data asset]     ${asset} -> ${hooksGlobalDst}`);
    }
  }
}

// Deploy the cross-squad `shared` tier's skills (e.g. /ship) into the same
// user-global skills dir. Called unconditionally (not per-squad) so cleanup
// skills survive a single-squad install like `deploy --squad sdd`. Shared
// skills carry no squad-bound templates, so copySkillTemplates is not invoked.
async function deploySharedSkills({ componentsRoot }) {
  const skillsSrc = join(componentsRoot, 'shared', 'skills');
  if (!(await isDir(skillsSrc))) return;
  const skillsDst = join(homedir(), '.claude', 'skills');
  await mkdir(skillsDst, { recursive: true });

  console.log('[shared tier]');
  for (const skill of await listSkillDirs(skillsSrc)) {
    const src = join(skillsSrc, skill);
    const dst = join(skillsDst, skill);
    const action = (await exists(dst)) ? '[update skill]' : '[install skill]';
    console.log(`  ${action}   ${skill}`);
    await checkLength(join(src, 'skill.md'), SKILL_LINE_CAP, `${skill}/skill.md`);
    await mkdir(dst, { recursive: true });
    await cp(src, dst, { recursive: true });
  }
}

async function deployHooksLocal({ componentsRoot, squads, repoRoot }) {
  const hooksDst = join(repoRoot, '.claude', 'hooks');
  await mkdir(hooksDst, { recursive: true });

  console.log('');
  console.log('ai-squad deploy — Hooks (per-repo)');
  console.log(`  hooks:   -> ${hooksDst}   (Python 3 stdlib; chmod +x preserved)`);
  console.log('');

  for (const squad of squads) {
    console.log(`[squad: ${squad}]`);
    const hooksSrc = join(componentsRoot, squad, 'hooks');
    for (const hookFile of await listFiles(hooksSrc, '.py')) {
      const src = join(hooksSrc, hookFile);
      const dst = join(hooksDst, hookFile);
      const action = (await exists(dst)) ? '[update hook]' : '[install hook]';
      console.log(`  ${action}    ${hookFile}`);
      await cp(src, dst);
      await chmod(dst, 0o755);
    }
    for (const asset of await copyHookDataAssets({ hooksSrc, destDir: hooksDst })) {
      console.log(`  [data asset]     ${asset}`);
    }
  }

  // Prune scope is computed across ALL bundled squads, not just the ones being
  // deployed in this invocation. Otherwise `ai-squad deploy --squad sdd` (with
  // discovery previously installed) would treat discovery's hooks as orphans
  // and nuke them. The desired set is the union of every bundled squad's hooks.
  const desiredHookFiles = await collectBundledHookFiles(componentsRoot);
  await pruneOrphanHookFiles({ hooksDst, desiredHookFiles });
  await ensureGitignore(repoRoot);
  await registerClaudeCodeHooks({ componentsRoot, squads, repoRoot, desiredHookFiles });
}

/**
 * Return the set of every `.py` hook basename present in any squad under
 * `componentsRoot`. Used to scope prune correctly during partial deploys.
 */
async function collectBundledHookFiles(componentsRoot) {
  const result = new Set();
  for (const squad of await listDirs(componentsRoot)) {
    const hooksSrc = join(componentsRoot, squad, 'hooks');
    for (const hookFile of await listFiles(hooksSrc, '.py')) {
      result.add(hookFile);
    }
  }
  return result;
}

/**
 * Remove `.py` files from <repo>/.claude/hooks/ that are no longer present in
 * any bundled squad. Mirrors the bundle as source-of-truth: removing a hook
 * upstream must propagate to consumer repos on `ai-squad deploy`.
 *
 * Why this matters: a stale on-disk hook file paired with a stale settings
 * registration is what caused calendarFR's pipeline to wedge — Claude Code
 * invoked the hook, the script existed at one point but did not, and the
 * Write tool was aborted. The settings prune (`pruneOrphanHookRegistrations`)
 * handles half of the problem; this prunes the other half so future drift
 * does not re-create the foot-gun.
 *
 * Scope: only `.py` files are pruned. Non-Python files in `.claude/hooks/`
 * (config, README, anything user-placed) are left alone.
 */
async function pruneOrphanHookFiles({ hooksDst, desiredHookFiles }) {
  if (!(await isDir(hooksDst))) return;
  const existing = await listFiles(hooksDst, '.py');
  for (const file of existing) {
    if (desiredHookFiles.has(file)) continue;
    const target = join(hooksDst, file);
    await unlink(target);
    console.log(`  [prune hook]     ${file} (no longer in bundle)`);
  }
}

/**
 * Merge each squad's claude-hooks.json into <repo>/.claude/settings.local.json.
 * Dedup by command string per event. Idempotent — re-running adds nothing if
 * everything is already present.
 *
 * Without this step the Python hooks live on disk but are never invoked by
 * Claude Code: only the orchestrator/pm Skills' frontmatter wire a subset,
 * and that scope is too narrow for guards like verify-tier-calibration to
 * fire reliably across all dispatch contexts.
 */
async function registerClaudeCodeHooks({ componentsRoot, squads, repoRoot, desiredHookFiles }) {
  const settingsPath = join(repoRoot, '.claude', 'settings.local.json');
  let settings = {};
  if (await exists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    } catch (err) {
      console.error(`  [WARN] could not parse ${settingsPath}: ${err.message}`);
      console.error('  [WARN] skipping Claude Code hook registration to avoid clobbering it.');
      return;
    }
  }
  settings.hooks ??= {};

  let totalAdded = 0;
  for (const squad of squads) {
    const claudeHooksPath = join(componentsRoot, squad, 'hooks', 'claude-hooks.json');
    if (!(await exists(claudeHooksPath))) continue;

    let squadConfig;
    try {
      squadConfig = JSON.parse(await readFile(claudeHooksPath, 'utf8'));
    } catch (err) {
      console.error(`  [WARN] could not parse ${claudeHooksPath}: ${err.message}`);
      continue;
    }

    for (const [eventName, eventEntries] of Object.entries(squadConfig.hooks || {})) {
      settings.hooks[eventName] ??= [];
      for (const entry of eventEntries) {
        const bucket = findOrCreateMatcherBucket(settings.hooks[eventName], entry.matcher ?? '');
        const { hooks, changes } = mergeBucketHooks(bucket.hooks, entry.hooks ?? []);
        bucket.hooks = hooks;
        for (const note of changes) {
          console.log(`  [${note.kind} hook]   ${eventName} (${entry.matcher || '*'}): ${note.command}`);
          totalAdded += 1;
        }
      }
    }
  }

  const pruned = pruneOrphanHookRegistrations(settings.hooks, desiredHookFiles ?? new Set());
  for (const note of pruned) {
    console.log(`  [prune hook]     ${note.event} (${note.matcher || '*'}): ${note.command}`);
  }

  const prunedLegacy = pruneLegacyRegistrations(settings.hooks);
  for (const note of prunedLegacy) {
    console.log(
      `  [prune legacy]   ${note.event} (${note.matcher || '*'}): ${note.command}  [${note.reason}]`,
    );
  }

  if (totalAdded === 0 && pruned.length === 0 && prunedLegacy.length === 0) {
    console.log(`  [settings] no hook registration changes needed (${settingsPath})`);
    return;
  }

  await mkdir(join(repoRoot, '.claude'), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(
    `  [settings] wrote ${totalAdded} new + ${pruned.length} pruned + ${prunedLegacy.length} legacy-removed hook update(s) in ${settingsPath}`,
  );
}

/**
 * Walk settings.hooks and remove any per-repo ai-squad hook registration
 * whose script no longer ships in the current bundle. Returns the list of
 * removed entries for logging.
 *
 * Detection scope: only commands referencing
 *   `$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.py`
 * are considered ai-squad-managed. User-placed hooks at other paths (e.g.,
 * `~/.claude/hooks/...` or absolute paths) are NEVER touched — this is
 * narrow on purpose so the prune cannot clobber non-ai-squad config.
 *
 * Empties: matcher buckets that lose all hooks are removed; events that
 * lose all buckets are removed from settings.hooks. Cosmetic but keeps the
 * file tidy.
 */
export function pruneOrphanHookRegistrations(hooksRoot, desiredHookFiles) {
  const removed = [];
  if (!hooksRoot || typeof hooksRoot !== 'object') return removed;

  for (const eventName of Object.keys(hooksRoot)) {
    const buckets = Array.isArray(hooksRoot[eventName]) ? hooksRoot[eventName] : [];
    const keptBuckets = [];
    for (const bucket of buckets) {
      const hooks = Array.isArray(bucket?.hooks) ? bucket.hooks : [];
      const keptHooks = [];
      for (const h of hooks) {
        const orphanName = extractAiSquadHookBasename(h?.command ?? '');
        if (orphanName && !desiredHookFiles.has(orphanName)) {
          removed.push({ event: eventName, matcher: bucket?.matcher ?? '', command: h.command });
          continue;
        }
        keptHooks.push(h);
      }
      if (keptHooks.length > 0) {
        bucket.hooks = keptHooks;
        keptBuckets.push(bucket);
      }
    }
    if (keptBuckets.length > 0) {
      hooksRoot[eventName] = keptBuckets;
    } else {
      delete hooksRoot[eventName];
    }
  }
  return removed;
}

/**
 * Strip hook registrations matching known-defunct framework patterns
 * (see LEGACY_REGISTRATIONS). Returns the same {event, matcher, command} shape
 * as pruneOrphanHookRegistrations, plus `reason` for the deprecation provenance.
 *
 * Operates in place on `hooksRoot` (the `settings.hooks` object). Mirrors the
 * empty-event cleanup behavior of pruneOrphanHookRegistrations.
 */
export function pruneLegacyRegistrations(hooksRoot) {
  const removed = [];
  if (!hooksRoot || typeof hooksRoot !== 'object') return removed;

  for (const eventName of Object.keys(hooksRoot)) {
    const buckets = Array.isArray(hooksRoot[eventName]) ? hooksRoot[eventName] : [];
    const keptBuckets = [];
    for (const bucket of buckets) {
      const hooks = Array.isArray(bucket?.hooks) ? bucket.hooks : [];
      const keptHooks = [];
      for (const h of hooks) {
        const cmd = h?.command ?? '';
        const match = LEGACY_REGISTRATIONS.find((entry) => entry.pattern.test(cmd));
        if (match) {
          removed.push({
            event: eventName,
            matcher: bucket?.matcher ?? '',
            command: cmd,
            reason: `${match.what} — removed ${match.since}`,
          });
          continue;
        }
        keptHooks.push(h);
      }
      if (keptHooks.length > 0) {
        bucket.hooks = keptHooks;
        keptBuckets.push(bucket);
      }
    }
    if (keptBuckets.length > 0) {
      hooksRoot[eventName] = keptBuckets;
    } else {
      delete hooksRoot[eventName];
    }
  }
  return removed;
}

/**
 * Return the .py basename if `command` references an ai-squad-managed
 * per-repo hook (`$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.py`), else null.
 * Tolerates the two registration shapes deploy emits — bare `python3 X.py`
 * and the fail-open guard `[ -f X.py ] || exit 0; python3 X.py`.
 */
export function extractAiSquadHookBasename(command) {
  if (typeof command !== 'string') return null;
  const m = /\$CLAUDE_PROJECT_DIR\/\.claude\/hooks\/([\w.-]+\.py)/.exec(command);
  return m ? m[1] : null;
}

/**
 * Merge a desired set of hooks into an existing bucket, keyed by `extractHookId`.
 * Collapses duplicate existing entries (defensive against past mis-merges),
 * upgrades stale forms to the desired form, and appends genuinely new hooks.
 *
 * Returns the new hooks array and a list of changes for logging.
 */
function mergeBucketHooks(existingHooks, desiredHooks) {
  const result = [];
  const indexById = new Map();
  for (const h of existingHooks) {
    const id = extractHookId(h.command);
    if (!indexById.has(id)) {
      indexById.set(id, result.length);
      result.push(h);
    }
    // else: silently drop duplicate-of-same-id within existing
  }

  const changes = [];
  for (const h of desiredHooks) {
    const id = extractHookId(h.command);
    if (indexById.has(id)) {
      const idx = indexById.get(id);
      if (result[idx].command !== h.command) {
        result[idx] = h;
        changes.push({ kind: 'migrate', command: h.command });
      }
    } else {
      indexById.set(id, result.length);
      result.push(h);
      changes.push({ kind: 'register', command: h.command });
    }
  }

  return { hooks: result, changes };
}

/**
 * Derive a stable identity for a hook command so we can dedup across cosmetic
 * differences (e.g. plain `python3 X.py` vs `[ -f X.py ] || exit 0; python3 X.py`).
 *
 *   "python3 ...verify-tier-calibration.py"         → "py:verify-tier-calibration.py"
 *   "[ -f X ] || exit 0; python3 X"                 → "py:<basename>"
 *   "npx <package> <subcommand>"                    → "npx:<package>:<subcommand>"
 *   anything else                                    → "raw:<full command>"
 */
function extractHookId(command) {
  const pyMatch = /([\w.-]+\.py)/.exec(command);
  if (pyMatch) return `py:${pyMatch[1]}`;
  const npxMatch = /npx\s+(@?[\w/-]+)\s+(\S+)/.exec(command);
  if (npxMatch) return `npx:${npxMatch[1]}:${npxMatch[2]}`;
  return `raw:${command}`;
}

/**
 * For a given event-array (e.g. settings.hooks.PreToolUse), find the entry
 * matching `matcher`. Create one if none exists. Returns a reference whose
 * `hooks[]` array can be appended to.
 */
function findOrCreateMatcherBucket(eventArray, matcher) {
  let bucket = eventArray.find((b) => (b.matcher ?? '') === matcher);
  if (!bucket) {
    bucket = { matcher, hooks: [] };
    eventArray.push(bucket);
  }
  bucket.hooks ??= [];
  return bucket;
}

async function ensureGitignore(repoRoot) {
  const gitignorePath = join(repoRoot, '.gitignore');
  let existing = '';
  try {
    existing = await readFile(gitignorePath, 'utf8');
  } catch {
    // Gitignore absent — create it.
  }
  // Idempotent: skip if the managed block (or a manually-added match) already
  // covers `.claude/hooks/`.
  if (/^\s*\.claude\/hooks\/?\s*$/m.test(existing)) {
    return;
  }
  await appendFile(gitignorePath, GITIGNORE_BLOCK, 'utf8');
  console.log(`  [gitignore] appended .claude/hooks/ to ${gitignorePath}`);
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

export async function runDeploy({ pkgRoot, squads = [], cursor = false, repoRoot, globalOnly = false, hooksOnly = false }) {
  const componentsRoot = join(pkgRoot, 'components');

  if (!(await isDir(componentsRoot))) {
    throw new Error(
      `components directory not found at ${componentsRoot}. ` +
        `If running from source, run 'npm run sync' first to bundle squads.`,
    );
  }

  // `shared` is a cross-squad tier, not a selectable squad: it is never a
  // valid `--squad` target and is always deployed (below), regardless of which
  // squads are selected. Excluding it here keeps `--squad sdd` from dropping it.
  const available = (await listDirs(componentsRoot)).filter((d) => d !== 'shared');
  if (available.length === 0) {
    throw new Error(`no squads found under ${componentsRoot}`);
  }
  const hasShared = await isDir(join(componentsRoot, 'shared'));

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

  const repoRootResolved = repoRoot ?? process.cwd();

  if (!hooksOnly) {
    await deployClaudeCodeGlobal({ componentsRoot, squads: target });
    if (hasShared) {
      await deploySharedSkills({ componentsRoot });
    }
  }

  if (!globalOnly) {
    await deployHooksLocal({ componentsRoot, squads: target, repoRoot: repoRootResolved });
  }

  console.log('');
  if (globalOnly) {
    console.log('Done. Skills+agents installed globally. (skipped hooks — --global-only)');
  } else if (hooksOnly) {
    console.log(`Done. Hooks installed to ${repoRootResolved}/.claude/hooks/. (skipped skills+agents — --hooks-only)`);
  } else {
    console.log(`Done. Skills+agents in ~/.claude/, hooks in ${repoRootResolved}/.claude/hooks/.`);
  }

  if (cursor) {
    await deployCursor({ componentsRoot, squads: target });
  }
}
