/**
 * Type guards for enrich pipeline (Plan D11).
 * No `as` casts on uncertain shapes.
 */

import type { Role, DispatchStatus, PhaseName, Session, Usage, TierCalibration, PmSessionSource } from '../types';

export function isRecord(o: unknown): o is Record<string, unknown> {
  return typeof o === 'object' && o !== null && !Array.isArray(o);
}

export function isArray(o: unknown): o is unknown[] {
  return Array.isArray(o);
}

export const VALID_ROLES: Role[] = [
  'dev',
  'code-reviewer',
  'logic-reviewer',
  'qa',
  'blocker-specialist',
  'audit-agent',
  'pm-orchestrator',
];

export const VALID_STATUSES: DispatchStatus[] = [
  'done',
  'needs_review',
  'blocked',
  'escalate',
  'partial',
];

export const VALID_PHASES: Session['currentPhase'][] = [
  'specify',
  'plan',
  'tasks',
  'implementation',
  'paused',
  'done',
  'escalated',
];

export const VALID_QA_STATUS = ['pass', 'partial', 'fail'] as const;

export const VALID_PHASE_NAMES: PhaseName[] = ['specify', 'plan', 'tasks', 'implementation'];

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (VALID_ROLES as string[]).includes(v);
}

export function isDispatchStatus(v: unknown): v is DispatchStatus {
  return typeof v === 'string' && (VALID_STATUSES as string[]).includes(v);
}

export function isCurrentPhase(v: unknown): v is Session['currentPhase'] {
  return typeof v === 'string' && (VALID_PHASES as string[]).includes(v);
}

export function isQaStatus(v: unknown): v is 'pass' | 'partial' | 'fail' {
  return typeof v === 'string' && (VALID_QA_STATUS as readonly string[]).includes(v);
}

export function isPhaseName(v: unknown): v is PhaseName {
  return typeof v === 'string' && (VALID_PHASE_NAMES as string[]).includes(v);
}

/**
 * FEAT-003 DM-1 — isUsage type guard.
 * Validates that an unknown value has the shape of a Usage object.
 * Requires: total_tokens, tool_uses, duration_ms are numbers; model is a string.
 */
export function isUsage(o: unknown): o is Usage {
  if (!isRecord(o)) return false;
  return (
    typeof o.total_tokens === 'number' &&
    typeof o.tool_uses === 'number' &&
    typeof o.duration_ms === 'number' &&
    typeof o.model === 'string'
  );
}

// FEAT-004 T-019 — PM session source guard (AC-013/AC-015)
export const VALID_SOURCES: PmSessionSource[] = ['platform_captured', 'self_reported'];

export function isPmSessionSource(v: unknown): v is PmSessionSource {
  return typeof v === 'string' && (VALID_SOURCES as string[]).includes(v);
}

export const VALID_TIERS: TierCalibration['tier'][] = ['T1', 'T2', 'T3', 'T4'];

const VALID_EFFORTS: TierCalibration['effort'][] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * FEAT-004 T-018 — isTierCalibration type guard (AC-016).
 * Validates that an unknown value has the required shape for TierCalibration.
 * Requires: tier ∈ T1–T4; model is string; effort ∈ low|medium|high|xhigh|max;
 * loop_kind is string (all four required per dispatch-manifest.schema.json).
 * JSON uses snake_case; camelCase mapping to loopKind happens in normaliseDispatches.
 */
export function isTierCalibration(o: unknown): o is TierCalibration & { loop_kind: string } {
  if (!isRecord(o)) return false;
  return (
    typeof o.tier === 'string' &&
    (VALID_TIERS as string[]).includes(o.tier) &&
    typeof o.model === 'string' &&
    typeof o.effort === 'string' &&
    (VALID_EFFORTS as string[]).includes(o.effort) &&
    typeof o.loop_kind === 'string'
  );
}
