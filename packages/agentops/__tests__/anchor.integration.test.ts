/**
 * Anchor integration test for T-015 — AC-014, AC-015.
 * Validates the extractor against the real FEAT-001 session data in this repo.
 *
 * Skipped in CI clean envs (no .agent-session/FEAT-001 present).
 * Runs locally where the real session data exists.
 *
 * Key assertions (from spec AC-014, AC-015):
 *   - FEAT-001 totalDispatches >= 14
 *   - FEAT-001 acClosure.total === 39
 *   - FEAT-001 escalationRate === 0
 *   - FEAT-001 dispatchesByRole.dev >= 4
 *   - index.md lists both FEAT-001 and FEAT-002
 */

import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { enrich } from '../src/enrich';
import { applyInsightRules } from '../src/insights';
import { measure } from '../src/measure';
import { parse } from '../src/parse';
import { renderIndexReport } from '../src/render/index-report';
import { scan } from '../src/scan';
import type { Metrics, Session } from '../src/types';

// ---------------------------------------------------------------------------
// Environment check — skip when real session data is absent
// ---------------------------------------------------------------------------

const REAL_SESSION_ROOT = path.join(process.cwd(), '.agent-session');
const FEAT_001_DIR = path.join(REAL_SESSION_ROOT, 'FEAT-001');

const SKIP = !existsSync(FEAT_001_DIR);

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

interface Processed {
  session: Session;
  metrics: Metrics;
}

async function processSession(sessionPath: string): Promise<Processed> {
  const raw = await parse(sessionPath);
  const session = enrich(raw);
  const baseMetrics = measure(session);
  const insights = applyInsightRules(baseMetrics);
  return { session, metrics: { ...baseMetrics, insights } };
}

// ---------------------------------------------------------------------------
// Anchor tests
// ---------------------------------------------------------------------------

const maybeDescribe = SKIP ? describe.skip : describe;

maybeDescribe('anchor — real FEAT-001 session validation (AC-014, AC-015)', () => {
  let metricsMap: Record<string, Metrics>;
  let allProcessed: Processed[];
  let tmpDir: string;
  let indexMdContent: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentops-anchor-'));

    // Scan real .agent-session/
    const sessionPaths = await scan(REAL_SESSION_ROOT);

    // Process all sessions (skip on parse error — same as index.ts behavior)
    const results: Processed[] = [];
    for (const sessionPath of sessionPaths) {
      try {
        const processed = await processSession(sessionPath);
        results.push(processed);
      } catch {
        // Skip corrupted sessions — mirrors index.ts behavior
      }
    }

    allProcessed = results.sort((a, b) => a.metrics.taskId.localeCompare(b.metrics.taskId));
    metricsMap = Object.fromEntries(allProcessed.map((p) => [p.metrics.taskId, p.metrics]));

    // Generate index.md for AC-015 assertion
    const generatedAt = new Date().toISOString();
    indexMdContent = renderIndexReport(allProcessed, [], generatedAt);
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // AC-014: FEAT-001 specific metric assertions
  it('FEAT-001 totalDispatches >= 14 (AC-014)', () => {
    expect(metricsMap['FEAT-001']).toBeDefined();
    expect(metricsMap['FEAT-001']!.totalDispatches).toBeGreaterThanOrEqual(14);
  });

  it('FEAT-001 acClosure.total === 39 (AC-014)', () => {
    expect(metricsMap['FEAT-001']).toBeDefined();
    expect(metricsMap['FEAT-001']!.acClosure.total).toBe(39);
  });

  it('FEAT-001 escalationRate === 0 (AC-014)', () => {
    expect(metricsMap['FEAT-001']).toBeDefined();
    expect(metricsMap['FEAT-001']!.escalationRate).toBe(0);
  });

  it('FEAT-001 dispatchesByRole.dev >= 4 (AC-014)', () => {
    expect(metricsMap['FEAT-001']).toBeDefined();
    expect(metricsMap['FEAT-001']!.dispatchesByRole['dev']).toBeGreaterThanOrEqual(4);
  });

  // AC-015: index.md lists ≥ 2 flows — FEAT-001 (done) and FEAT-002 (running)
  it('index.md lists FEAT-001 (AC-015)', () => {
    expect(indexMdContent).toContain('FEAT-001');
  });

  it('index.md lists FEAT-002 (AC-015)', () => {
    expect(indexMdContent).toContain('FEAT-002');
  });

  it('index.md contains ≥ 2 flows (AC-015)', () => {
    expect(allProcessed.length).toBeGreaterThanOrEqual(2);
    expect(indexMdContent).toContain(`Total flows: ${allProcessed.length}`);
  });

  it('FEAT-001 is marked as done (✓) in index.md', () => {
    // The done symbol ✓ should appear in the index
    expect(indexMdContent).toContain('✓');
    // FEAT-001 row should have ✓
    const feat001Line = indexMdContent.split('\n').find((line) => line.includes('FEAT-001'));
    expect(feat001Line).toBeDefined();
    expect(feat001Line).toContain('✓');
  });

  it('FEAT-001 dispatchesPerAc is a reasonable ratio (14+ dispatches / 39 ACs ≈ 0.36)', () => {
    const dpa = metricsMap['FEAT-001']!.dispatchesPerAc;
    // With 14+ dispatches and 39 ACs: dispatches/AC >= 14/39 ≈ 0.358
    expect(dpa).toBeGreaterThan(0);
    expect(dpa).toBeLessThan(1); // sanity: < 1 dispatch per AC
  });
});
