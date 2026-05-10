/**
 * phase-coverage.ts — wall-clock-proportional phase attribution for PM sessions.
 * (agentops-cost-tracking-patch)
 */

import fs from 'fs';

export type PhaseCoverageLabel = 'specify' | 'plan' | 'tasks' | 'implementation' | 'mixed';

export interface PhaseEntry {
  phase: string;
  started_at: string;
  completed_at?: string;
}

export interface PhaseCoverageResult {
  phase_coverage: PhaseCoverageLabel;
  /** Present only when phase_coverage === 'mixed'. Ratios sum to 1.0. */
  phase_split?: Partial<Record<string, number>>;
}

const KNOWN_PHASES = new Set(['specify', 'plan', 'tasks', 'implementation']);

/**
 * Given a session window [sessionStart, sessionEnd] and the phase_history array,
 * determines which SDD phase(s) the session overlaps and returns the coverage label.
 *
 * Algorithm:
 *  - For each phase entry, compute the wall-clock overlap with the session window.
 *  - Phases with 0 overlap are ignored.
 *  - 0 overlapping phases → fallback 'implementation'
 *  - 1 overlapping phase → return that phase name
 *  - 2+ overlapping phases → 'mixed' + proportional split (sum = 1.0)
 */
export function detectPhaseCoverage(
  sessionStart: string,
  sessionEnd: string,
  phases: PhaseEntry[],
): PhaseCoverageResult {
  const sStart = new Date(sessionStart).getTime();
  const sEnd = new Date(sessionEnd).getTime();
  const sessionDuration = Math.max(sEnd - sStart, 1);

  const overlaps: { phase: string; ms: number }[] = [];

  for (const p of phases) {
    if (!KNOWN_PHASES.has(p.phase)) continue;
    const pStart = new Date(p.started_at).getTime();
    const pEnd = p.completed_at ? new Date(p.completed_at).getTime() : Number.POSITIVE_INFINITY;

    const overlapStart = Math.max(sStart, pStart);
    const overlapEnd = Math.min(sEnd, pEnd);
    const ms = overlapEnd - overlapStart;
    if (ms > 0) overlaps.push({ phase: p.phase, ms });
  }

  if (overlaps.length === 0) {
    return { phase_coverage: 'implementation' };
  }

  if (overlaps.length === 1) {
    return { phase_coverage: overlaps[0]!.phase as PhaseCoverageLabel };
  }

  // mixed — proportional split
  const totalMs = overlaps.reduce((sum, o) => sum + o.ms, 0) || sessionDuration;
  const split: Partial<Record<string, number>> = {};
  for (const { phase, ms } of overlaps) {
    split[phase] = ms / totalMs;
  }
  return { phase_coverage: 'mixed', phase_split: split };
}

/**
 * Parses phase_history from a session.yml file without a YAML dependency.
 * Returns an array of PhaseEntry (only entries with a recognized phase name).
 * Falls back to [] on any read/parse error.
 */
export function readPhaseHistory(sessionYmlPath: string): PhaseEntry[] {
  if (!fs.existsSync(sessionYmlPath)) return [];
  const text = fs.readFileSync(sessionYmlPath, 'utf-8');
  const entries: PhaseEntry[] = [];
  // Split on "  - phase:" which starts each phase_history entry (2 leading spaces)
  const blocks = text.split(/\n {2}- phase:/);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]!;
    const phaseMatch = /^\s*["']?([a-z]+)["']?/.exec(block);
    if (!phaseMatch) continue;
    const phase = phaseMatch[1]!;
    const startMatch = /started_at:\s*["']?([^"'\n]+)["']?/.exec(block);
    const endMatch = /completed_at:\s*["']?([^"'\n]+)["']?/.exec(block);
    if (!startMatch) continue;
    const entry: PhaseEntry = { phase, started_at: startMatch[1]!.trim() };
    if (endMatch) entry.completed_at = endMatch[1]!.trim();
    entries.push(entry);
  }
  return entries;
}
