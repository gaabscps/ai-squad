/**
 * Integration tests for scripts/agentops/index.ts — T-014
 * AC-001, AC-005, AC-016, AC-019, AC-020, NFR-001, NFR-005
 *
 * Setup: AGENTOPS_ROOT → fixtures dir, AGENTOPS_OUT → temp dir.
 * Asserts: correct files written, FIXTURE-C skipped with warning,
 * idempotency (byte-identical output except timestamp line), < 5s wall-clock.
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// eslint-disable-next-line no-undef
const FIXTURES_ROOT = path.resolve(__dirname, '../__fixtures__/.agent-session');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mask the "Generated at: <ISO>" line for idempotency comparison */
function maskTimestamps(md: string): string {
  return md.replace(/^> Generated at: .+$/gm, '> Generated at: <MASKED>');
}

/** Mask the "done in Xs" line for idempotency comparison */
function maskElapsed(log: string): string {
  return log.replace(/\[agentops\] done in [\d.]+s/, '[agentops] done in <ELAPSED>s');
}

// ---------------------------------------------------------------------------
// Main integration test suite
// ---------------------------------------------------------------------------

describe('agentops index.ts integration', () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-integration-'));
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterEach(() => {
    // Clean env vars after each test
    delete process.env.AGENTOPS_ROOT;
    delete process.env.AGENTOPS_OUT;
  });

  // -------------------------------------------------------------------------
  // Happy path: correct files generated
  // -------------------------------------------------------------------------

  describe('happy path — fixture dir', () => {
    let outDir: string;
    let capturedLog: string;
    let capturedWarn: string;
    let elapsedMs: number;

    beforeAll(async () => {
      outDir = path.join(tmpDir, 'run1');

      const logLines: string[] = [];
      const warnLines: string[] = [];
      const logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logLines.push(args.join(' '));
      });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warnLines.push(args.join(' '));
      });

      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir;

      const t0 = Date.now();
      const { main } = await import('../src/index');
      await main();
      elapsedMs = Date.now() - t0;

      capturedLog = logLines.join('\n');
      capturedWarn = warnLines.join('\n');

      logSpy.mockRestore();
      warnSpy.mockRestore();

      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;
    });

    it('generates index.md', async () => {
      const indexPath = path.join(outDir, 'index.md');
      const stat = await fs.stat(indexPath);
      expect(stat.isFile()).toBe(true);
    });

    it('index.md contains cross-flow table', async () => {
      const content = await fs.readFile(path.join(outDir, 'index.md'), 'utf-8');
      expect(content).toContain('## Cross-flow snapshot');
      expect(content).toMatch(/# AgentOps observability — overview/);
    });

    it('generates FEAT-FIXTURE-A.md', async () => {
      const filePath = path.join(outDir, 'FEAT-FIXTURE-A.md');
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    it('generates FEAT-FIXTURE-B.md', async () => {
      const filePath = path.join(outDir, 'FEAT-FIXTURE-B.md');
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
    });

    it('does NOT generate FEAT-FIXTURE-C.md (skipped due to corrupted manifest)', async () => {
      const filePath = path.join(outDir, 'FEAT-FIXTURE-C.md');
      await expect(fs.stat(filePath)).rejects.toThrow();
    });

    it('emitted a warning about FEAT-FIXTURE-C on stderr (console.warn)', () => {
      expect(capturedWarn).toContain('[agentops] skipped FEAT-FIXTURE-C');
    });

    it('logged scanning prefix on stdout (console.log)', () => {
      expect(capturedLog).toContain('[agentops] scanning');
    });

    it('logged "done in" completion line', () => {
      expect(capturedLog).toContain('[agentops] done in');
    });

    it('completed in < 5s (NFR-001)', () => {
      expect(elapsedMs).toBeLessThan(5000);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency: run twice, compare output (except timestamp lines)
  // -------------------------------------------------------------------------

  describe('idempotency — two consecutive runs produce byte-identical output (excluding timestamps)', () => {
    it('index.md is byte-identical except for timestamp line', async () => {
      const outDir1 = path.join(tmpDir, 'idempotency1');
      const outDir2 = path.join(tmpDir, 'idempotency2');

      const { main } = await import('../src/index');

      const ls1 = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws1 = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir1;
      await main();
      ls1.mockRestore();
      ws1.mockRestore();

      const ls2 = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws2 = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir2;
      await main();
      ls2.mockRestore();
      ws2.mockRestore();

      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;

      const content1 = maskTimestamps(await fs.readFile(path.join(outDir1, 'index.md'), 'utf-8'));
      const content2 = maskTimestamps(await fs.readFile(path.join(outDir2, 'index.md'), 'utf-8'));
      expect(content1).toBe(content2);
    });

    it('FEAT-FIXTURE-A.md is byte-identical except for timestamp line', async () => {
      const outDir1 = path.join(tmpDir, 'idempotency3');
      const outDir2 = path.join(tmpDir, 'idempotency4');

      const { main } = await import('../src/index');

      const ls1 = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws1 = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir1;
      await main();
      ls1.mockRestore();
      ws1.mockRestore();

      const ls2 = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws2 = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir2;
      await main();
      ls2.mockRestore();
      ws2.mockRestore();

      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;

      const content1 = maskTimestamps(
        await fs.readFile(path.join(outDir1, 'FEAT-FIXTURE-A.md'), 'utf-8'),
      );
      const content2 = maskTimestamps(
        await fs.readFile(path.join(outDir2, 'FEAT-FIXTURE-A.md'), 'utf-8'),
      );
      expect(content1).toBe(content2);
    });
  });

  // -------------------------------------------------------------------------
  // Empty root dir — AC-005
  // -------------------------------------------------------------------------

  describe('empty root — AC-005', () => {
    it('throws EmptyScanError with actionable message when scan finds no sessions', async () => {
      const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-empty-root-'));
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = emptyRoot;
      const { main, EmptyScanError: Err } = await import('../src/index');
      try {
        await expect(main()).rejects.toThrow(Err);
        const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(stderrOutput).toContain('no sessions found');
        expect(stderrOutput).toContain('FEAT-');
      } finally {
        stderrSpy.mockRestore();
        ls.mockRestore();
        delete process.env.AGENTOPS_ROOT;
        await fs.rm(emptyRoot, { recursive: true, force: true });
      }
    });
  });

  // -------------------------------------------------------------------------
  // Non-existent root dir — AC-005
  // -------------------------------------------------------------------------

  describe('non-existent root — AC-005', () => {
    it('throws EmptyScanError when root dir does not exist', async () => {
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = '/tmp/__does_not_exist_agentops__';
      const { main, EmptyScanError: Err } = await import('../src/index');
      try {
        await expect(main()).rejects.toThrow(Err);
        const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
        expect(stderrOutput).toContain('no sessions found');
      } finally {
        stderrSpy.mockRestore();
        ls.mockRestore();
        delete process.env.AGENTOPS_ROOT;
      }
    });
  });

  // -------------------------------------------------------------------------
  // Performance assertion (standalone) — NFR-001
  // -------------------------------------------------------------------------

  describe('performance — < 5s wall-clock (NFR-001)', () => {
    it('completes within 5 seconds for the fixture set', async () => {
      const outDir2 = path.join(tmpDir, 'perf-run');

      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir2;
      const { main } = await import('../src/index');
      const t0 = Date.now();
      await main();
      const elapsed = Date.now() - t0;
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;

      expect(elapsed).toBeLessThan(5000);
    });
  });

  // -------------------------------------------------------------------------
  // Twelve-Factor logs — NFR-005: stdout for progress, stderr for warnings
  // -------------------------------------------------------------------------

  describe('Twelve-Factor logs — NFR-005', () => {
    it('uses console.log (stdout) for progress messages', async () => {
      const outDir2 = path.join(tmpDir, 'tf-log-run');
      const capturedLog: string[] = [];

      const ls = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => capturedLog.push(args.join(' ')));
      const ws = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir2;
      const { main } = await import('../src/index');
      await main();
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;

      const allLog = capturedLog.join('\n');
      expect(allLog).toContain('[agentops] scanning');
      expect(allLog).toMatch(/\[agentops\] wrote /);
      expect(allLog).toContain('[agentops] done in');
    });

    it('uses console.warn (stderr) for skipped sessions warning', async () => {
      const outDir2 = path.join(tmpDir, 'tf-warn-run');
      const capturedWarn: string[] = [];

      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws = jest
        .spyOn(console, 'warn')
        .mockImplementation((...args: unknown[]) => capturedWarn.push(args.join(' ')));
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir2;
      const { main } = await import('../src/index');
      await main();
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;

      const allWarn = capturedWarn.join('\n');
      expect(allWarn).toContain('[agentops] skipped FEAT-FIXTURE-C');
    });
  });

  // -------------------------------------------------------------------------
  // Mask helper — maskElapsed is tested to ensure utility function works
  // -------------------------------------------------------------------------

  describe('maskElapsed helper', () => {
    it('masks elapsed time in log output', () => {
      const log = '[agentops] done in 0.42s';
      expect(maskElapsed(log)).toBe('[agentops] done in <ELAPSED>s');
    });
  });

  // -------------------------------------------------------------------------
  // T-022: RepoHealth integration — reports/ absent → "not measured" sections
  // AC-028, AC-032, AC-034
  // -------------------------------------------------------------------------

  describe('T-022: repo health absent — no reports/ dir', () => {
    let outDir: string;
    let capturedLog: string;

    beforeAll(async () => {
      outDir = path.join(tmpDir, 'no-reports-run');
      const logLines: string[] = [];
      const ls = jest
        .spyOn(console, 'log')
        .mockImplementation((...args: unknown[]) => logLines.push(args.join(' ')));
      const ws = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir;
      process.env.AGENTOPS_REPORTS = path.join(os.tmpdir(), '__does_not_exist_reports__');
      const { main } = await import('../src/index');
      await main();
      capturedLog = logLines.join('\n');
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;
      delete process.env.AGENTOPS_REPORTS;
    });

    it('still generates index.md', async () => {
      const stat = await fs.stat(path.join(outDir, 'index.md'));
      expect(stat.isFile()).toBe(true);
    });

    it('index.md contains "not measured" when no reports dir', async () => {
      const content = await fs.readFile(path.join(outDir, 'index.md'), 'utf-8');
      expect(content).toMatch(/not measured/i);
    });

    it('logs "repo health not measured" when reports dir absent', () => {
      expect(capturedLog).toMatch(/repo health not measured/i);
    });

    it('flow report contains "not measured" for repo health section', async () => {
      const content = await fs.readFile(path.join(outDir, 'FEAT-FIXTURE-A.md'), 'utf-8');
      expect(content).toMatch(/not measured/i);
    });
  });

  // -------------------------------------------------------------------------
  // T-017: HTML generation — index.html + FEAT-NNN.html produced (AC-001, AC-011, AC-012)
  // -------------------------------------------------------------------------

  describe('T-017: HTML files generated alongside MD files (AC-001, AC-011, AC-012)', () => {
    let outDir: string;

    beforeAll(async () => {
      outDir = path.join(tmpDir, 'html-run1');
      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir;
      const { main } = await import('../src/index');
      await main();
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;
    });

    it('generates index.html', async () => {
      const stat = await fs.stat(path.join(outDir, 'index.html'));
      expect(stat.isFile()).toBe(true);
    });

    it('generates FEAT-FIXTURE-A.html', async () => {
      const stat = await fs.stat(path.join(outDir, 'FEAT-FIXTURE-A.html'));
      expect(stat.isFile()).toBe(true);
    });

    it('index.md still exists alongside index.html (AC-011 — MD not deleted)', async () => {
      const stat = await fs.stat(path.join(outDir, 'index.md'));
      expect(stat.isFile()).toBe(true);
    });

    it('FEAT-FIXTURE-A.md still exists alongside FEAT-FIXTURE-A.html (AC-011)', async () => {
      const stat = await fs.stat(path.join(outDir, 'FEAT-FIXTURE-A.md'));
      expect(stat.isFile()).toBe(true);
    });

    it('index.html is a valid HTML document', async () => {
      const content = await fs.readFile(path.join(outDir, 'index.html'), 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('<html');
      expect(content).toContain('</html>');
    });

    it('FEAT-FIXTURE-A.html is a valid HTML document', async () => {
      const content = await fs.readFile(path.join(outDir, 'FEAT-FIXTURE-A.html'), 'utf-8');
      expect(content).toContain('<!DOCTYPE html>');
      expect(content).toContain('<html');
      expect(content).toContain('</html>');
    });

    it('FEAT-FIXTURE-A.html contains MD content from the same run (AC-012)', async () => {
      const content = await fs.readFile(path.join(outDir, 'FEAT-FIXTURE-A.html'), 'utf-8');
      // MD content is embedded in the html raw-data section
      expect(content).toContain('md-embed');
    });
  });

  // -------------------------------------------------------------------------
  // T-017: AGENTOPS_HTML_DIR env var override (NFR-006)
  // -------------------------------------------------------------------------

  describe('T-017: AGENTOPS_HTML_DIR env var overrides HTML output dir (NFR-006)', () => {
    let outDir: string;
    let htmlDir: string;

    beforeAll(async () => {
      outDir = path.join(tmpDir, 'html-dir-md');
      htmlDir = path.join(tmpDir, 'html-dir-html');
      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir;
      process.env.AGENTOPS_HTML_DIR = htmlDir;
      const { main } = await import('../src/index');
      await main();
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;
      delete process.env.AGENTOPS_HTML_DIR;
    });

    it('MD files go to AGENTOPS_OUT', async () => {
      const stat = await fs.stat(path.join(outDir, 'index.md'));
      expect(stat.isFile()).toBe(true);
    });

    it('HTML files go to AGENTOPS_HTML_DIR', async () => {
      const stat = await fs.stat(path.join(htmlDir, 'index.html'));
      expect(stat.isFile()).toBe(true);
    });

    it('HTML does not appear in AGENTOPS_OUT when AGENTOPS_HTML_DIR is set', async () => {
      await expect(fs.stat(path.join(outDir, 'index.html'))).rejects.toThrow();
    });

    it('MD does not appear in AGENTOPS_HTML_DIR', async () => {
      await expect(fs.stat(path.join(htmlDir, 'index.md'))).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // T-022: RepoHealth integration — partial reports/ (mutation + type-cov only)
  // AC-028, AC-034
  // -------------------------------------------------------------------------

  describe('T-022: repo health partial — mutation + type-cov present, no dep-cruiser', () => {
    let outDir: string;
    let partialReportsDir: string;

    beforeAll(async () => {
      outDir = path.join(tmpDir, 'partial-reports-run');
      // Build a partial reports dir: mutation + type-coverage only
      partialReportsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-partial-reports-'));
      const FIXTURES_REPORTS = path.resolve(__dirname, 'repo-health-fixtures');
      await fs.mkdir(path.join(partialReportsDir, 'mutation'), { recursive: true });
      await fs.copyFile(
        path.join(FIXTURES_REPORTS, 'mutation', 'mutation.json'),
        path.join(partialReportsDir, 'mutation', 'mutation.json'),
      );
      await fs.mkdir(path.join(partialReportsDir, 'type-coverage'), { recursive: true });
      await fs.copyFile(
        path.join(FIXTURES_REPORTS, 'type-coverage', 'type-coverage.json'),
        path.join(partialReportsDir, 'type-coverage', 'type-coverage.json'),
      );
      // No dep-cruiser dir — intentionally absent

      const ls = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const ws = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      process.env.AGENTOPS_ROOT = FIXTURES_ROOT;
      process.env.AGENTOPS_OUT = outDir;
      process.env.AGENTOPS_REPORTS = partialReportsDir;
      const { main } = await import('../src/index');
      await main();
      ls.mockRestore();
      ws.mockRestore();
      delete process.env.AGENTOPS_ROOT;
      delete process.env.AGENTOPS_OUT;
      delete process.env.AGENTOPS_REPORTS;
    });

    afterAll(async () => {
      await fs.rm(partialReportsDir, { recursive: true, force: true });
    });

    it('generates index.md with repo health section (partial data)', async () => {
      const content = await fs.readFile(path.join(outDir, 'index.md'), 'utf-8');
      // Should have repo health section with real mutation score
      expect(content).toContain('## Repo health');
    });

    it('index.md shows mutation score from partial data', async () => {
      const content = await fs.readFile(path.join(outDir, 'index.md'), 'utf-8');
      // Fixture mutation score is 75.5%
      expect(content).toContain('75.5');
    });

    it('flow report shows repo health section with partial data', async () => {
      const content = await fs.readFile(path.join(outDir, 'FEAT-FIXTURE-A.md'), 'utf-8');
      expect(content).toContain('## Repo health');
    });
  });
});

