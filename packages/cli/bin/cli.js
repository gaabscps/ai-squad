#!/usr/bin/env node
/**
 * ai-squad — CLI entrypoint.
 *
 * Subcommands:
 *   deploy [--squad NAME ...] [--cursor] [--force]   Install squads to ~/.claude/
 *   help                                             Print usage
 *
 * Future: report (proxy to @ai-squad/agentops), new, doctor.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDeploy } from '../lib/deploy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { squads: [], cursor: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--squad' || a === '-s') {
      args.squads.push(argv[++i]);
    } else if (a === '--cursor') {
      args.cursor = true;
    } else if (a === '--force' || a === '-f') {
      args.force = true;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      args._ ??= [];
      args._.push(a);
    }
  }
  return args;
}

function printUsage() {
  console.log(`ai-squad — Spec-Driven Development squads for Claude Code

Usage:
  ai-squad deploy [options]            Install squads to ~/.claude/
  ai-squad help                        Show this help

Options for deploy:
  --squad NAME, -s NAME    Deploy only the named squad (repeatable). Default: all.
  --cursor                 Also sync Cursor hooks to ~/.cursor/.
  --force, -f              Overwrite existing components without prompting.

Examples:
  ai-squad deploy                      # all squads to Claude Code
  ai-squad deploy --squad sdd          # only sdd
  ai-squad deploy --cursor             # all squads + Cursor

After deploy, components are available globally: skills/agents in ~/.claude/skills,
~/.claude/agents; Python hooks in ~/.claude/hooks (chmod +x). Subagent frontmatter
references hooks via $HOME/.claude/hooks/<name>.py — no per-project setup.
`);
}

async function main() {
  const [, , subcommand, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (!subcommand || subcommand === 'help' || args.help) {
    printUsage();
    process.exit(subcommand ? 0 : 1);
  }

  if (subcommand === 'deploy') {
    await runDeploy({ pkgRoot: PKG_ROOT, ...args });
    return;
  }

  console.error(`ai-squad: unknown command '${subcommand}'`);
  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error('ai-squad: fatal error');
  console.error(err.stack || err.message || err);
  process.exit(1);
});
