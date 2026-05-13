/**
 * cli.ts — CLI entry point for @ai-squad/agentops
 * Wires 4 subcommands (report, capture, doctor, install-hooks) via commander.
 * AC-004: CLI entry; AC-005: exit 1 on empty scan; AC-006/AC-007: doctor routing.
 */

import { Command } from 'commander';

import { ConfigError, loadConfig } from './config';
import { doctor } from './doctor';
import { installHooks } from './install-hooks';
import { EmptyScanError, main } from './index';

const VERSION = '0.1.0';

export function makeProgram(): Command {
  const program = new Command();

  program.name('agentops').description('AgentOps observability CLI').version(VERSION);

  // ---------------------------------------------------------------------------
  // report — generate observability reports for agent sessions
  // ---------------------------------------------------------------------------
  program
    .command('report')
    .description('Generate observability reports for agent sessions')
    .action(async () => {
      try {
        const config = await loadConfig(process.cwd());
        await main({
          sessionPrefix: config.sessionPrefix.value,
          priorFlows: config.priorFlows.value,
          bypassFlows: config.bypassFlows.value,
        });
      } catch (err) {
        if (err instanceof ConfigError) {
          process.stderr.write(`${err.message}\n`);
          process.exit(1);
        }
        if (err instanceof EmptyScanError) {
          // message already written to stderr by main()
          process.exit(1);
        }
        throw err;
      }
    });

  // ---------------------------------------------------------------------------
  // capture — capture PM session (invoked by Claude Stop hook)
  // ---------------------------------------------------------------------------
  program
    .command('capture')
    .description('Capture PM session (invoked by Claude Stop hook)')
    .action(async () => {
      try {
        // Dynamically import to avoid pulling in the module-level side-effect
        // guard that runs `main()` when the hook is loaded as CLI.
        const captureMod = await import('./hooks/capture-pm-session');
        const repoRoot = captureMod.findRepoRoot(process.cwd());
        // maybeRegenerateReport is exported and safe to call directly
        await captureMod.maybeRegenerateReport(repoRoot);
        // Full hook flow reads stdin; for CLI invocation, the hook's main() is
        // intentionally not exported (guarded by require.main). Graceful no-op.
      } catch {
        // Hooks must not fail the session — always exit 0
      }
    });

  // ---------------------------------------------------------------------------
  // doctor — diagnose configuration and report resolved values
  // ---------------------------------------------------------------------------
  program
    .command('doctor')
    .description('Diagnose configuration and report resolved values')
    .action(async () => {
      try {
        await doctor(process.cwd());
      } catch (err) {
        if (err instanceof ConfigError) {
          process.stderr.write(`${err.message}\n`);
          process.exit(1);
        }
        throw err;
      }
    });

  // ---------------------------------------------------------------------------
  // install-hooks — install Claude Code Stop hook
  // ---------------------------------------------------------------------------
  program
    .command('install-hooks')
    .description('Install Claude Code Stop hook in .claude/settings.local.json')
    .action(async () => {
      try {
        const result = await installHooks(process.cwd());
        if (result.installed) {
          // eslint-disable-next-line no-console
          console.log('[agentops] Hook installed.');
        } else {
          // eslint-disable-next-line no-console
          console.log('[agentops] Hook already present.');
        }
        // eslint-disable-next-line no-console
        console.log(
          '[agentops] note: for the full SDD framework (Python pipeline guards + ' +
            'subagent usage capture + tier-calibration enforcement), run ' +
            '`ai-squad deploy` from @ai-squad/cli — it covers this hook and the ' +
            'rest in one step.',
        );
      } catch (err) {
        if (err instanceof SyntaxError) {
          process.stderr.write(`[agentops] error: malformed settings file: ${err.message}\n`);
          process.exit(1);
        }
        throw err;
      }
    });

  return program;
}

/* istanbul ignore next */
if (require.main === module) {
  const program = makeProgram();
  program.parseAsync(process.argv).catch((err: unknown) => {
    process.stderr.write(`[agentops] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
