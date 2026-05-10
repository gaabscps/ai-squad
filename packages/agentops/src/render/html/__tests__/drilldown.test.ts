import type { RepoHealth, Session } from '../../../types';
import { drilldown } from '../components/drilldown';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-001',
    featureName: 'Foundation',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'done',
    startedAt: '2026-01-01T10:00:00Z',
    completedAt: '2026-01-01T12:00:00Z',
    phases: [
      {
        name: 'implementation',
        startedAt: '2026-01-01T10:00:00Z',
        completedAt: '2026-01-01T12:00:00Z',
        status: 'done',
      },
    ],
    dispatches: [
      {
        dispatchId: 'feat-001-dev',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T10:00:00Z',
        completedAt: '2026-01-01T11:00:00Z',
        outputPacket: null,
        loop: 0,
        pmNote: 'Done!',
      },
    ],
    acs: ['AC-001', 'AC-002'],
    qaResults: [
      { ac: 'AC-001', status: 'pass' },
      { ac: 'AC-002', status: 'pass' },
    ],
    expectedPipeline: [],
    escalationMetrics: null,
    ...overrides,
  };
}

function makeRepoHealth(): RepoHealth {
  return {
    mutation: { score: 72.5, killed: 145, total: 200 },
    typeCoverage: { percent: 97.8, anyCount: 5 },
    depViolations: { error: 0, warn: 2 },
    measuredAt: '2026-01-01T16:00:00Z',
  };
}

describe('drilldown', () => {
  it('renders section with drilldown class', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('<section class="drilldown">');
    expect(result).toContain('</section>');
  });

  it('renders h2 Drilldown heading', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('<h2>Drilldown</h2>');
  });

  it('has exactly 5 details elements', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    const detailsMatches = result.match(/<details>/g);
    expect(detailsMatches).toHaveLength(5);
  });

  it('all details are closed by default (no open attribute)', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    // Should not contain <details open>
    expect(result).not.toContain('<details open');
    expect(result).not.toContain('<details open>');
  });

  it('contains Per-AC closure detail summary', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('Per-AC closure detail');
  });

  it('contains Per-dispatch breakdown summary', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('Per-dispatch breakdown');
  });

  it('contains Repo health snapshot summary', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('Repo health snapshot');
  });

  it('contains Reviewer findings summary', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('Reviewer findings');
  });

  it('contains Phase durations summary', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('Phase durations');
  });

  it('per-AC table has correct headers', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('AC ID');
    expect(result).toContain('Status');
    expect(result).toContain('Validator');
    expect(result).toContain('Evidence');
  });

  it('per-AC table lists session ACs', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('AC-001');
    expect(result).toContain('AC-002');
  });

  it('reviewer findings shows (none) when no dispatches have findings', () => {
    const session = makeSession();
    const result = drilldown(session, makeRepoHealth());
    expect(result).toContain('(none)');
  });

  it('repo health null → shows not measured message', () => {
    const result = drilldown(makeSession(), null);
    expect(result).toContain('not measured');
  });

  it('per-dispatch table has correct headers', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('Dispatch ID');
    expect(result).toContain('Role');
  });

  it('mutation score shown in repo health section', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('72.5');
  });

  it('renders table elements (semantic HTML)', () => {
    const result = drilldown(makeSession(), makeRepoHealth());
    expect(result).toContain('<table>');
    expect(result).toContain('<thead>');
    expect(result).toContain('<tbody>');
    expect(result).toContain('<th>');
    expect(result).toContain('<td>');
  });

  it('shows "(no ACs defined)" when session has no ACs', () => {
    const session = makeSession({ acs: [], qaResults: [] });
    const result = drilldown(session, makeRepoHealth());
    expect(result).toContain('(no ACs defined)');
  });

  it('shows "(no dispatches)" when session has no dispatches', () => {
    const session = makeSession({ dispatches: [] });
    const result = drilldown(session, makeRepoHealth());
    expect(result).toContain('(no dispatches)');
  });

  it('shows "(no phase data available)" when session has no phases with startedAt', () => {
    const session = makeSession({ phases: [] });
    const result = drilldown(session, makeRepoHealth());
    expect(result).toContain('(no phase data available)');
  });

  it('shows null mutation/typeCoverage as dashes in repo health section', () => {
    const nullHealth: RepoHealth = {
      mutation: null,
      typeCoverage: null,
      depViolations: { error: 0, warn: 0 },
      measuredAt: '2026-01-01T00:00:00Z',
    };
    const result = drilldown(makeSession(), nullHealth);
    expect(result).toContain('—');
  });

  it('renders reviewer findings as list when dispatches have findings', () => {
    const session = makeSession({
      dispatches: [
        {
          dispatchId: 'rev-1',
          role: 'code-reviewer',
          status: 'done',
          startedAt: '2026-01-01T10:00:00Z',
          completedAt: '2026-01-01T11:00:00Z',
          outputPacket: {
            findings: ['Critical: fix this bug', { message: 'Minor: improve naming' }],
          },
          loop: null,
          pmNote: null,
        },
      ],
    });
    const result = drilldown(session, makeRepoHealth());
    expect(result).toContain('Critical: fix this bug');
    expect(result).toContain('Minor: improve naming');
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>');
  });
});
