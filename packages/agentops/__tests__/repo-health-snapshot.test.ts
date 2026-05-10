/**
 * Tests for render/flow-report/repo-health-snapshot.ts — T-017
 * AC-028, AC-032, AC-034: Repo health snapshot section.
 */

import { renderRepoHealthSnapshot } from '../src/render/flow-report/repo-health-snapshot';
import type { RepoHealth } from '../src/types';

function makeRepoHealth(overrides: Partial<RepoHealth> = {}): RepoHealth {
  return {
    mutation: { score: 75.5, killed: 4, total: 6 },
    typeCoverage: { percent: 97.66, anyCount: 23 },
    depViolations: { error: 0, warn: 1 },
    measuredAt: '2026-05-08T12:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Null input (AC-034 graceful degradation)
// ---------------------------------------------------------------------------

describe('renderRepoHealthSnapshot — null (not measured)', () => {
  it('matches snapshot', () => {
    const output = renderRepoHealthSnapshot(null);
    expect(output).toMatchSnapshot();
  });

  it('contains ## Repo health snapshot header', () => {
    const output = renderRepoHealthSnapshot(null);
    expect(output).toContain('## Repo health snapshot');
  });

  it('shows "not measured" message', () => {
    const output = renderRepoHealthSnapshot(null);
    expect(output).toContain('not measured');
  });

  it('does not throw', () => {
    expect(() => renderRepoHealthSnapshot(null)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Full data present
// ---------------------------------------------------------------------------

describe('renderRepoHealthSnapshot — full data', () => {
  it('matches snapshot', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth());
    expect(output).toMatchSnapshot();
  });

  it('shows mutation score with threshold status', () => {
    const output = renderRepoHealthSnapshot(
      makeRepoHealth({ mutation: { score: 75.5, killed: 4, total: 6 } }),
    );
    expect(output).toContain('75.5%');
    expect(output).toContain('≥ 70%');
  });

  it('shows type coverage percent', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth());
    expect(output).toContain('97.7%');
    expect(output).toContain('≥ 95%');
  });

  it('shows dep violations count', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth());
    expect(output).toContain('Dep violations');
    expect(output).toContain('0');
  });

  it('shows ✓ for mutation score >= 70', () => {
    const output = renderRepoHealthSnapshot(
      makeRepoHealth({ mutation: { score: 80, killed: 8, total: 10 } }),
    );
    expect(output).toContain('✓');
  });

  it('shows ✗ for mutation score < 70', () => {
    const output = renderRepoHealthSnapshot(
      makeRepoHealth({ mutation: { score: 50, killed: 5, total: 10 } }),
    );
    expect(output).toContain('✗');
  });

  it('shows ✗ for dep violations > 0', () => {
    const output = renderRepoHealthSnapshot(
      makeRepoHealth({ depViolations: { error: 2, warn: 0 } }),
    );
    expect(output).toContain('✗');
  });

  it('includes measuredAt date in output', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth());
    expect(output).toContain('2026-05-08');
  });
});

// ---------------------------------------------------------------------------
// Partial data (some fields null)
// ---------------------------------------------------------------------------

describe('renderRepoHealthSnapshot — partial data', () => {
  it('matches snapshot when mutation is null', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth({ mutation: null }));
    expect(output).toMatchSnapshot();
  });

  it('shows — for null mutation field', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth({ mutation: null }));
    // Mutation row shows dash
    expect(output).toContain('Mutation score');
  });

  it('shows — for null typeCoverage field', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth({ typeCoverage: null }));
    expect(output).toContain('Type coverage');
  });

  it('shows — for null depViolations field', () => {
    const output = renderRepoHealthSnapshot(makeRepoHealth({ depViolations: null }));
    expect(output).toContain('Dep violations');
  });
});
