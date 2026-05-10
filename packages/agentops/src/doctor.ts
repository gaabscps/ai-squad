import { ConfigError, loadConfig } from './config';

export async function doctor(cwd: string = process.cwd()): Promise<void> {
  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
      return; // unreachable at runtime; allows Jest to mock process.exit without propagating
    }
    throw err; // non-ConfigError (e.g. EACCES) — CLI entry handles exit code
  }

  const rows: Array<{ field: string; value: string; source: string; warn: boolean }> = [
    {
      field: 'sessionPrefix',
      value: Array.isArray(config.sessionPrefix.value)
        ? config.sessionPrefix.value.join(', ')
        : config.sessionPrefix.value,
      source: config.sessionPrefix.source,
      warn: config.sessionPrefix.source === 'default',
    },
    {
      field: 'reportCommand',
      value: config.reportCommand.value === '' ? '(empty)' : (config.reportCommand.value ?? '(none)'),
      source: config.reportCommand.source,
      warn: config.reportCommand.source === 'default',
    },
    {
      field: 'priorFlows',
      value: config.priorFlows.value.length > 0 ? config.priorFlows.value.join(', ') : '(empty)',
      source: config.priorFlows.source,
      warn: config.priorFlows.source === 'default',
    },
    {
      field: 'bypassFlows',
      value: config.bypassFlows.value.length > 0 ? config.bypassFlows.value.join(', ') : '(empty)',
      source: config.bypassFlows.source,
      warn: config.bypassFlows.source === 'default',
    },
    {
      field: 'rootDir',
      value: config.rootDir.value,
      source: config.rootDir.source,
      warn: config.rootDir.source === 'default',
    },
  ];

  // Print table
  const colWidths = {
    field: Math.max(5, ...rows.map((r) => r.field.length)),
    value: Math.max(5, ...rows.map((r) => r.value.length)),
    source: Math.max(6, ...rows.map((r) => r.source.length)),
  };

  const header = `${'Field'.padEnd(colWidths.field)}  ${'Value'.padEnd(colWidths.value)}  ${'Source'.padEnd(colWidths.source)}`;
  const separator = `${'-'.repeat(colWidths.field)}  ${'-'.repeat(colWidths.value)}  ${'-'.repeat(colWidths.source)}`;

  process.stdout.write(`${header}\n${separator}\n`);
  for (const row of rows) {
    const warn = row.warn ? ' ⚠ using default' : '';
    process.stdout.write(
      `${row.field.padEnd(colWidths.field)}  ${row.value.padEnd(colWidths.value)}  ${row.source}${warn}\n`,
    );
  }
}
