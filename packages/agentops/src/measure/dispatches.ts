/**
 * measure/dispatches.ts — dispatch-related metric sub-functions.
 * All functions are pure (no I/O, no Date.now(), no random).
 */

import type { Session, Role } from '../types';

const ALL_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
  'pm-orchestrator',
];

/**
 * Returns count of dispatches per role. All roles present in the enum are
 * included; roles with no dispatches get 0.
 */
export function computeDispatchesByRole(session: Session): Record<Role, number> {
  const counts = Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<Role, number>;
  for (const d of session.dispatches) {
    counts[d.role] = (counts[d.role] ?? 0) + 1;
  }
  return counts;
}

/**
 * Returns the task success rate for a given role:
 *   dispatches with status "done" / total dispatches for that role.
 * Returns null if the role has 0 dispatches (avoid division by zero).
 */
export function computeTaskSuccessRate(session: Session, role: Role): number | null {
  const roleDispatches = session.dispatches.filter((d) => d.role === role);
  if (roleDispatches.length === 0) return null;
  const done = roleDispatches.filter((d) => d.status === 'done').length;
  return done / roleDispatches.length;
}

/**
 * Returns the loop rate: fraction of dispatches where loop > 0.
 * Also considers task_states from session.yml (via session derived fields).
 * If there are no dispatches, returns 0.
 */
export function computeLoopRate(session: Session): number {
  if (session.dispatches.length === 0) return 0;
  const withLoop = session.dispatches.filter((d) => d.loop !== null && d.loop > 0).length;
  return withLoop / session.dispatches.length;
}

/**
 * Returns the escalation rate from escalationMetrics.
 * Falls back to 0 if metrics absent.
 */
export function computeEscalationRate(session: Session): number {
  return session.escalationMetrics?.escalationRate ?? 0;
}

/**
 * Returns dispatches / total ACs.
 * If ACs = 0, returns 0 to avoid division by zero.
 */
export function computeDispatchesPerAc(session: Session): number {
  if (session.acs.length === 0) return 0;
  return session.dispatches.length / session.acs.length;
}
