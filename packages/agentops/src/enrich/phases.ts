/**
 * Phase history and expected pipeline normalisation.
 */

import type { Session } from '../types';

import { isRecord, isArray, isRole, isPhaseName } from './guards';

export function normalisePhases(sessionYml: unknown): Session['phases'] {
  if (!isRecord(sessionYml)) return [];
  const history = sessionYml.phase_history;

  const phases: Session['phases'] = [];

  if (isArray(history)) {
    // Legacy array format: [{phase, started_at, completed_at, artifact_status}]
    for (const entry of history) {
      if (!isRecord(entry)) continue;
      const name = entry.phase;
      if (!isPhaseName(name)) continue;
      const startedAt = typeof entry.started_at === 'string' ? entry.started_at : null;
      const completedAt = typeof entry.completed_at === 'string' ? entry.completed_at : null;
      const status = typeof entry.artifact_status === 'string' ? entry.artifact_status : 'unknown';
      phases.push({ name, startedAt, completedAt, status });
    }
  } else if (isRecord(history)) {
    // Dict format (current): {specify: {started_at, completed_at}, plan: {...}, ...}
    for (const [key, value] of Object.entries(history)) {
      if (!isPhaseName(key)) continue;
      if (!isRecord(value)) continue;
      const startedAt = typeof value.started_at === 'string' ? value.started_at : null;
      const completedAt = typeof value.completed_at === 'string' ? value.completed_at : null;
      phases.push({ name: key, startedAt, completedAt, status: completedAt ? 'done' : 'running' });
    }
  }

  // Synthesize implementation phase from pipeline_started_at / pipeline_completed_at
  // if not already present in phase_history.
  if (!phases.some((p) => p.name === 'implementation')) {
    const pStart = typeof sessionYml.pipeline_started_at === 'string' ? sessionYml.pipeline_started_at : null;
    const pEnd = typeof sessionYml.pipeline_completed_at === 'string' ? sessionYml.pipeline_completed_at : null;
    if (pStart) {
      phases.push({ name: 'implementation', startedAt: pStart, completedAt: pEnd, status: pEnd ? 'done' : 'running' });
    }
  }

  return phases;
}

export function normaliseExpectedPipeline(manifest: unknown): Session['expectedPipeline'] {
  if (!isRecord(manifest)) return [];
  const pipeline = manifest.expected_pipeline;
  if (!isArray(pipeline)) return [];
  return pipeline.flatMap((entry): Session['expectedPipeline'] => {
    if (!isRecord(entry)) return [];
    const requiredRoles = isArray(entry.required_roles) ? entry.required_roles.filter(isRole) : [];
    // Use exactOptionalPropertyTypes-compatible spread: only include optional fields when defined
    const item: Session['expectedPipeline'][number] = { requiredRoles };
    if (typeof entry.batch_id === 'string') item.batchId = entry.batch_id;
    if (typeof entry.task_id === 'string') item.taskId = entry.task_id;
    // FEAT-005 T-003: read title, ac_scope, tasks_covered (optional — older manifests omit them)
    if (typeof entry.title === 'string') item.title = entry.title;
    if (isArray(entry.ac_scope)) {
      item.acScope = entry.ac_scope.filter((v): v is string => typeof v === 'string');
    }
    if (isArray(entry.tasks_covered)) {
      item.tasksCovered = entry.tasks_covered.filter((v): v is string => typeof v === 'string');
    }
    return [item];
  });
}
