/**
 * Pipeline-line renderer — FEAT-005 T-008.
 * Renders roles as inline text with → and ‖ separators.
 * Covers: AC-006.
 */

import type { Role } from '../../../../../types';

const REVIEWER_ROLES = new Set<Role>(['code-reviewer', 'logic-reviewer']);

/**
 * Renders the roles pipeline as an inline <span>.
 *
 * Separator heuristic (AC-006):
 *   - Adjacent pair where BOTH are reviewer roles → joined with ‖ (parallel)
 *   - All other transitions → →
 *
 * Empty array → empty span.
 */
export function renderPipelineLine(rolesPipeline: Role[]): string {
  if (rolesPipeline.length === 0) {
    return `<span class="story-card__pipeline"></span>`;
  }

  const parts: string[] = [];
  for (let i = 0; i < rolesPipeline.length; i++) {
    const role = rolesPipeline[i]!;
    parts.push(role);
    if (i < rolesPipeline.length - 1) {
      const next = rolesPipeline[i + 1]!;
      // Both current and next are reviewer roles → parallel marker
      const sep = REVIEWER_ROLES.has(role) && REVIEWER_ROLES.has(next) ? ' ‖ ' : ' → ';
      parts.push(sep);
    }
  }

  return `<span class="story-card__pipeline">${parts.join('')}</span>`;
}
