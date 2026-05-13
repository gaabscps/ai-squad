/**
 * deploy — install ai-squad components in two scopes:
 *   - Skills + agents → ~/.claude/{skills,agents}/ (user-global, Claude Code
 *     discovery via Skills user-level path)
 *   - Hooks → <cwd>/.claude/hooks/ (per-repo, referenced via
 *     $CLAUDE_PROJECT_DIR/.claude/hooks/X.py in subagent/skill frontmatter)
 *
 * Rationale: hooks are operational, low-trust scripts that should be
 * (a) inspectable in the consuming repo, (b) versioned together with
 * the agentops data they emit, and (c) deployable in CI without a
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
import { appendFile, chmod, cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const SKILL_LINE_CAP = 300;
const AGENT_LINE_CAP = 150;
const GITIGNORE_BLOCK = '\n# ai-squad per-repo hook install (managed by `ai-squad deploy`)\n.claude/hooks/\n';

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
    for (const skill of await listDirs(skillsSrc)) {
      const src = join(skillsSrc, skill);
      const dst = join(skillsDst, skill);
      const action = (await exists(dst)) ? '[update skill]' : '[install skill]';
      console.log(`  ${action}   ${skill}`);
      await checkLength(join(src, 'skill.md'), SKILL_LINE_CAP, `${skill}/skill.md`);
      await mkdir(dst, { recursive: true });
      await cp(src, dst, { recursive: true });
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
  }

  await ensureGitignore(repoRoot);
  await registerClaudeCodeHooks({ componentsRoot, squads, repoRoot });
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
async function registerClaudeCodeHooks({ componentsRoot, squads, repoRoot }) {
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

  if (totalAdded === 0) {
    console.log(`  [settings] no new hook registrations needed (${settingsPath})`);
    return;
  }

  await mkdir(join(repoRoot, '.claude'), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log(`  [settings] wrote ${totalAdded} hook update(s) in ${settingsPath}`);
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
 *   "npx @ai-squad/agentops capture"                → "npx:@ai-squad/agentops:capture"
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

  const repoRootResolved = repoRoot ?? process.cwd();

  if (!hooksOnly) {
    await deployClaudeCodeGlobal({ componentsRoot, squads: target });
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
