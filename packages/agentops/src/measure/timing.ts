/**
 * measure/timing.ts — phase duration metric sub-function.
 * All functions are pure (no I/O, no Date.now(), no random).
 */

import type { Session, PhaseName } from '../types';

const ALL_PHASES: PhaseName[] = ['specify', 'plan', 'tasks', 'implementation'];

/**
 * Returns a duration in minutes for each known phase.
 * - If phase has both startedAt and completedAt: returns integer minutes.
 * - If phase has startedAt but no completedAt: returns 'running'.
 * - If phase is not present in session.phases: returns 'not_started'.
 */
export function computePhaseDurations(
  session: Session,
): Record<PhaseName, number | 'running' | 'not_started'> {
  const result = Object.fromEntries(ALL_PHASES.map((p) => [p, 'not_started'])) as Record<
    PhaseName,
    number | 'running' | 'not_started'
  >;

  for (const phase of session.phases) {
    if (!ALL_PHASES.includes(phase.name as PhaseName)) continue;
    const name = phase.name as PhaseName;
    if (!phase.startedAt) {
      result[name] = 'not_started';
    } else if (!phase.completedAt) {
      result[name] = 'running';
    } else {
      const startMs = new Date(phase.startedAt).getTime();
      const endMs = new Date(phase.completedAt).getTime();
      const diffMs = endMs - startMs;
      // Round to nearest minute, minimum 0
      result[name] = Math.max(0, Math.round(diffMs / 60000));
    }
  }

  return result;
}
