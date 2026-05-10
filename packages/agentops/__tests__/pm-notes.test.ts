/**
 * Tests for render/flow-report/pm-notes.ts — T-019
 * AC-030: PM notes log section.
 */

import { renderPmNotesLog } from '../src/render/flow-report/pm-notes';
import type { Session } from '../src/types';

function makeMinimalSession(overrides: Partial<Session> = {}): Session {
  return {
    taskId: 'FEAT-TEST',
    featureName: 'Test',
    compliance: 'standard',
    currentPhase: 'implementation',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    completedAt: null,
    phases: [],
    dispatches: [],
    acs: [],
    qaResults: [],
    expectedPipeline: [],
    escalationMetrics: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// No PM notes
// ---------------------------------------------------------------------------

describe('renderPmNotesLog — no notes', () => {
  it('matches snapshot', () => {
    const output = renderPmNotesLog(makeMinimalSession());
    expect(output).toMatchSnapshot();
  });

  it('shows "(no PM notes recorded)" when no pmNotes', () => {
    const output = renderPmNotesLog(makeMinimalSession());
    expect(output).toContain('(no PM notes recorded)');
  });

  it('contains ## PM notes log header', () => {
    const output = renderPmNotesLog(makeMinimalSession());
    expect(output).toContain('## PM notes log');
  });
});

// ---------------------------------------------------------------------------
// With PM notes
// ---------------------------------------------------------------------------

describe('renderPmNotesLog — with notes', () => {
  const session = makeMinimalSession({
    dispatches: [
      {
        dispatchId: 'dev-1',
        role: 'dev',
        status: 'done',
        startedAt: '2026-01-01T09:00:00Z',
        completedAt: null,
        outputPacket: null,
        loop: null,
        pmNote: 'Decided to split the module for clarity.',
      },
      {
        dispatchId: 'qa-1',
        role: 'qa',
        status: 'done',
        startedAt: '2026-01-01T10:00:00Z',
        completedAt: null,
        outputPacket: null,
        loop: null,
        pmNote: 'All ACs verified with snapshot tests.',
      },
      {
        dispatchId: 'no-note',
        role: 'code-reviewer',
        status: 'done',
        startedAt: '2026-01-01T08:00:00Z',
        completedAt: null,
        outputPacket: null,
        loop: null,
        pmNote: null, // should be excluded
      },
    ],
  });

  it('matches snapshot', () => {
    const output = renderPmNotesLog(session);
    expect(output).toMatchSnapshot();
  });

  it('includes bullets for dispatches with non-null pmNote', () => {
    const output = renderPmNotesLog(session);
    expect(output).toContain('Decided to split the module for clarity.');
    expect(output).toContain('All ACs verified with snapshot tests.');
  });

  it('excludes dispatches with null pmNote', () => {
    const output = renderPmNotesLog(session);
    // The no-note dispatch should not create a bullet
    const bulletCount = (output.match(/^- \[/gm) ?? []).length;
    expect(bulletCount).toBe(2);
  });

  it('orders bullets by started_at ascending', () => {
    const output = renderPmNotesLog(session);
    const devPos = output.indexOf('Decided to split');
    const qaPos = output.indexOf('All ACs verified');
    expect(devPos).toBeLessThan(qaPos);
  });

  it('formats bullets as "- [YYYY-MM-DD HH:MM role] note"', () => {
    const output = renderPmNotesLog(session);
    expect(output).toMatch(/^- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2} \w/m);
  });

  it('includes role in bullet format', () => {
    const output = renderPmNotesLog(session);
    expect(output).toContain('dev]');
    expect(output).toContain('qa]');
  });
});

// ---------------------------------------------------------------------------
// Note truncation
// ---------------------------------------------------------------------------

describe('renderPmNotesLog — note truncation', () => {
  it('truncates notes longer than 200 chars with dispatch ref', () => {
    const longNote = 'B'.repeat(250);
    const session = makeMinimalSession({
      dispatches: [
        {
          dispatchId: 'dev-long',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: longNote,
        },
      ],
    });
    const output = renderPmNotesLog(session);
    expect(output).toContain('...');
    expect(output).toContain('dev-long');
    expect(output).not.toContain('B'.repeat(250));
  });

  it('does not truncate notes <= 200 chars', () => {
    const exactNote = 'C'.repeat(200);
    const session = makeMinimalSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: exactNote,
        },
      ],
    });
    const output = renderPmNotesLog(session);
    expect(output).toContain(exactNote);
    expect(output).not.toContain('...');
  });
});

// ---------------------------------------------------------------------------
// Filters empty strings
// ---------------------------------------------------------------------------

describe('renderPmNotesLog — filters empty notes', () => {
  it('excludes dispatches with empty string pmNote', () => {
    const session = makeMinimalSession({
      dispatches: [
        {
          dispatchId: 'd1',
          role: 'dev',
          status: 'done',
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: null,
          outputPacket: null,
          loop: null,
          pmNote: '', // empty — should be excluded
        },
      ],
    });
    const output = renderPmNotesLog(session);
    expect(output).toContain('(no PM notes recorded)');
  });
});
