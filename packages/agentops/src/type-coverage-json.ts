/**
 * type-coverage JSON wrapper — FEAT-003 AC-008, T-004.
 *
 * Spawns `type-coverage --strict --detail`, parses stdout line-by-line,
 * and emits `reports/type-coverage/type-coverage.json`.
 *
 * Output shape:
 * {
 *   percent: number;
 *   total: number;
 *   correct: number;
 *   anyCount: number;
 *   files: Array<{ path: string; line: number; col: number; identifier: string }>;
 *   measured_at: string;
 * }
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

interface AnyLocation {
  path: string;
  line: number;
  col: number;
  identifier: string;
}

interface TypeCoverageReport {
  percent: number;
  total: number;
  correct: number;
  anyCount: number;
  files: AnyLocation[];
  measured_at: string;
}

/**
 * Parse type-coverage stdout into a structured report.
 *
 * type-coverage --detail outputs lines like:
 *   path/to/file.ts:10:5: identifier
 * And a summary line like:
 *   123/456 99.12%
 */
export function parseTypeCoverageOutput(stdout: string): Omit<TypeCoverageReport, 'measured_at'> {
  const lines = stdout.split('\n');
  const files: AnyLocation[] = [];

  let percent = 0;
  let total = 0;
  let correct = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Summary line: "(2816 / 2841) 99.12%" or "123/456 99.12%"
    const summaryRe = /\(?(\d+)\s*\/\s*(\d+)\)?\s+([\d.]+)%/;
    const summaryMatch = summaryRe.exec(trimmed);
    if (summaryMatch?.[1] != null && summaryMatch[2] != null && summaryMatch[3] != null) {
      correct = parseInt(summaryMatch[1], 10);
      total = parseInt(summaryMatch[2], 10);
      percent = parseFloat(summaryMatch[3]);
      continue;
    }

    // Any location line: "/abs/path/to/file.ts:10:5: someIdentifier"
    // type-coverage --detail format: "<path>:<line>:<col>: <identifier>"
    // Must look like a file path (contains a dot and slash, or starts with /)
    const locationRe = /^((?:\/|\.\/|[A-Za-z]:)[^:]+\.[a-z]+):(\d+):(\d+):\s*(.*)$/;
    const locationMatch = locationRe.exec(trimmed);
    if (
      locationMatch?.[1] != null &&
      locationMatch[2] != null &&
      locationMatch[3] != null &&
      locationMatch[4] != null
    ) {
      const filePath = locationMatch[1];
      const lineNum = parseInt(locationMatch[2], 10);
      const col = parseInt(locationMatch[3], 10);
      const identifier = locationMatch[4].trim();

      files.push({
        path: filePath,
        line: lineNum,
        col,
        identifier,
      });
    }
  }

  return {
    percent,
    total,
    correct,
    anyCount: files.length,
    files,
  };
}

/* istanbul ignore next */
async function run(): Promise<void> {
  const reportsDir = path.join(process.cwd(), 'reports', 'type-coverage');
  await fs.mkdir(reportsDir, { recursive: true });

  const outputPath = path.join(reportsDir, 'type-coverage.json');

  process.stderr.write('[type-coverage-json] Running type-coverage --strict --detail...\n');

  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    (resolve) => {
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];

      const child = spawn(
        'node_modules/.bin/type-coverage',
        ['--strict', '--detail', '--reportSemanticError'],
        {
          cwd: process.cwd(),
          env: process.env,
        },
      );

      child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

      child.on('close', (code) => {
        resolve({
          stdout: Buffer.concat(chunks).toString('utf8'),
          stderr: Buffer.concat(errChunks).toString('utf8'),
          exitCode: code ?? 0,
        });
      });
    },
  );

  if (result.stderr) {
    process.stderr.write(`[type-coverage-json] stderr: ${result.stderr}\n`);
  }

  const parsed = parseTypeCoverageOutput(result.stdout);
  const report: TypeCoverageReport = {
    ...parsed,
    measured_at: new Date().toISOString(),
  };

  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  process.stdout.write(
    `[type-coverage-json] Report written to ${outputPath}\n` +
      `[type-coverage-json] Coverage: ${report.percent.toFixed(2)}% (${report.correct}/${report.total} typed)\n` +
      `[type-coverage-json] Any count: ${report.anyCount}\n`,
  );
}

/* istanbul ignore next */
run().catch((err: unknown) => {
  process.stderr.write(`[type-coverage-json] Fatal error: ${String(err)}\n`);
  process.exit(1);
});
