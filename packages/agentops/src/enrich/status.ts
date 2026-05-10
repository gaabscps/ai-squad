/**
 * Status derivation and escalation metrics extraction (Plan D2 + spec T-009).
 */

import type { Session } from '../types';

import { isRecord } from './guards';

export function deriveStatus(
  currentPhase: Session['currentPhase'],
  manifest: unknown,
  sessionYml: unknown,
): Session['status'] {
  if (currentPhase === 'done') return 'done';
  if (currentPhase === 'escalated') return 'escalated';
  // Check escalation_metrics.pending_human_tasks
  if (isRecord(sessionYml)) {
    const em = sessionYml.escalation_metrics;
    if (isRecord(em)) {
      const pht = em.pending_human_tasks;
      if (typeof pht === 'number' && pht > 0) return 'escalated';
    }
  }
  if (currentPhase === 'paused') return 'paused';
  if (currentPhase === 'specify' && !manifest) return 'specify-only';
  return 'running';
}

export function extractEscalationMetrics(sessionYml: unknown): Session['escalationMetrics'] {
  if (!isRecord(sessionYml)) return null;
  const em = sessionYml.escalation_metrics;
  if (!isRecord(em)) return null;
  const rate = em.escalation_rate;
  if (typeof rate !== 'number') return null;
  return { escalationRate: rate };
}
