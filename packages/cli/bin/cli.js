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
  const args = { squads: [], cursor: false, force: false, globalOnly: false, hooksOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--squad' || a === '-s') {
      args.squads.push(argv[++i]);
    } else if (a === '--cursor') {
      args.cursor = true;
    } else if (a === '--global-only') {
      args.globalOnly = true;
    } else if (a === '--hooks-only') {
      args.hooksOnly = true;
    } else if (a === '--repo-root') {
      args.repoRoot = argv[++i];
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
  ai-squad deploy [options]            Install squads (skills+agents global, hooks per-repo)
  ai-squad help                        Show this help

Options for deploy:
  --squad NAME, -s NAME    Deploy only the named squad (repeatable). Default: all.
  --cursor                 Also sync Cursor hooks to ~/.cursor/.
  --global-only            Skip per-repo hook install (only deploy skills+agents).
  --hooks-only             Skip global skills+agents install (only deploy hooks to current repo).
  --repo-root PATH         Target repo for hook install (default: cwd).
  --force, -f              Overwrite existing components without prompting.

Deploy layout:
  ~/.claude/skills/<skill>/             — user-global, shared across all repos
  ~/.claude/agents/<agent>.md           — user-global
  <repo>/.claude/hooks/<hook>.py        — per-repo, gitignored, referenced via
                                          $CLAUDE_PROJECT_DIR/.claude/hooks/<X>.py

Examples:
  ai-squad deploy                      # full install into current repo
  ai-squad deploy --squad sdd          # only the sdd squad
  ai-squad deploy --cursor             # full install + Cursor mirror
  ai-squad deploy --global-only        # CI/dotfiles flow — skip per-repo hooks
  cd <consumer-repo> && ai-squad deploy --hooks-only   # re-sync hooks only
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
