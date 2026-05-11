/**
 * AgentOps observability extractor — enrich.ts
 * Thin orchestrator: normalises a RawSession into a Session.
 *
 * Sub-modules (not public surface):
 *   enrich/guards.ts      — type guards and VALID_* constants
 *   enrich/dispatches.ts  — dispatch normalisation, QA aggregation, output attachment
 *   enrich/phases.ts      — phase history and expected pipeline normalisation
 *   enrich/status.ts      — status derivation and escalation metrics
 */

import fs from 'fs';
import path from 'path';

import { complianceForFlow } from './constants';
import { normaliseDispatches, aggregateQaResults, attachOutputPackets } from './enrich/dispatches';
import { isRecord, isArray, isCurrentPhase } from './enrich/guards';
import { normalisePhases, normaliseExpectedPipeline } from './enrich/phases';
import { deriveStatus, extractEscalationMetrics } from './enrich/status';
import type { RawSession, Session } from './types';

// ---------------------------------------------------------------------------
// AC-009 — warnings.json reader
// ---------------------------------------------------------------------------

export interface SessionWarning {
  reason: string;
  timestamp: string;
  session_id: string;
}

/**
 * Load .agent-session/<taskId>/warnings.json and return entries mapped to
 * the PmSessionWarning shape (reason + timestamp + session_id).
 * Returns [] if the file is absent, empty, or malformed — caller always gets
 * a valid array without throwing.
 */
export function loadSessionWarnings(sessionDirPath: string): SessionWarning[] {
  const warningsPath = path.join(sessionDirPath, 'warnings.json');
  if (!fs.existsSync(warningsPath)) return [];
  try {
    const raw = fs.readFileSync(warningsPath, 'utf-8').trim();
    if (!raw) return [];
    const doc = JSON.parse(raw) as unknown;
    if (!isRecord(doc)) return [];
    const entries = doc.warnings;
    if (!isArray(entries)) return [];
    const out: SessionWarning[] = [];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const reason = typeof entry.reason === 'string' ? entry.reason : 'unknown';
      const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString();
      const session_id =
        isRecord(entry.metadata) && typeof entry.metadata.session_id === 'string'
          ? entry.metadata.session_id
          : 'unknown';
      out.push({ reason, timestamp, session_id });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// AC extraction from spec.md
// ---------------------------------------------------------------------------

const AC_REGEX = /^- AC-(\d+):/gm;

function extractAcs(specMd: string | null): string[] {
  if (!specMd) return [];
  const acs: string[] = [];
  let m: RegExpExecArray | null;
  AC_REGEX.lastIndex = 0;
  while ((m = AC_REGEX.exec(specMd)) !== null) {
    acs.push(`AC-${m[1]}`);
  }
  return acs;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function enrich(
  raw: RawSession,
  priorFlows: readonly string[] = [],
  bypassFlows: readonly string[] = [],
): Session {
  const sessionYml = raw.sessionYml;

  // currentPhase
  let currentPhase: Session['currentPhase'] = 'specify';
  if (isRecord(sessionYml)) {
    const cp = sessionYml.current_phase;
    if (isCurrentPhase(cp)) currentPhase = cp;
  }

  // featureName
  let featureName = raw.taskId;
  if (isRecord(sessionYml)) {
    const fn = sessionYml.feature_name;
    if (typeof fn === 'string' && fn.length > 0) featureName = fn;
  }

  // startedAt
  let startedAt = '';
  if (isRecord(sessionYml)) {
    const sa = sessionYml.started_at;
    if (typeof sa === 'string') startedAt = sa;
  }

  // completedAt
  let completedAt: string | null = null;
  if (isRecord(sessionYml)) {
    const ca = sessionYml.completed_at;
    if (typeof ca === 'string') completedAt = ca;
  }

  const phases = normalisePhases(sessionYml);
  const rawDispatches = normaliseDispatches(raw.manifest);
  const dispatches = attachOutputPackets(rawDispatches, raw.outputs);
  const acs = extractAcs(raw.specMd);
  const qaResults = aggregateQaResults(raw.outputs);
  const expectedPipeline = normaliseExpectedPipeline(raw.manifest);
  const escalationMetrics = extractEscalationMetrics(sessionYml);

  const status = deriveStatus(currentPhase, raw.manifest, sessionYml);

  // AC-009: load warnings.json from session dir — no external param needed.
  const warnings = loadSessionWarnings(raw.sessionDirPath);

  return {
    taskId: raw.taskId,
    featureName,
    compliance: complianceForFlow(raw.taskId, priorFlows, bypassFlows),
    currentPhase,
    status,
    startedAt,
    completedAt,
    phases,
    dispatches,
    acs,
    qaResults,
    expectedPipeline,
    escalationMetrics,
    warnings,
  };
}
