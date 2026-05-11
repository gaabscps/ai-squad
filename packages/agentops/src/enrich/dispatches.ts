/**
 * Dispatch normalisation, QA results aggregation, and output packet attachment.
 */

import { ANTHROPIC_PRICING_2026 } from '../constants';
import { computeUsageCost } from '../measure/cost';
import type { RawSession, Session, TierCalibration, Usage } from '../types';

import { isRecord, isArray, isRole, isDispatchStatus, isQaStatus, isUsage, isTierCalibration } from './guards';

const INPUT_RATIO = 0.7;
const OUTPUT_RATIO = 0.3;

/** Map long-form model IDs (as emitted by Claude Code harness) to short-form pricing keys. */
const MODEL_NORMALIZE: Record<string, Usage['model']> = {
  'claude-opus-4-7': 'opus-4-7',
  'claude-sonnet-4-6': 'sonnet-4-6',
  'claude-haiku-4-5': 'haiku-4-5',
};

/**
 * Normalize a raw model string to the short-form key used in ANTHROPIC_PRICING_2026.
 * Falls back to fuzzy matching on model family, then 'unknown'.
 */
function normalizeModel(raw: string): Usage['model'] {
  if (MODEL_NORMALIZE[raw]) return MODEL_NORMALIZE[raw];
  if (raw === 'opus-4-7' || raw === 'sonnet-4-6' || raw === 'haiku-4-5') return raw;
  if (raw.includes('opus')) return 'opus-4-7';
  if (raw.includes('sonnet')) return 'sonnet-4-6';
  if (raw.includes('haiku')) return 'haiku-4-5';
  return 'unknown';
}

/** Attach cost_usd to a Usage object if not already set and model is known. */
function attachCostUsd(usage: Usage): Usage {
  if (usage.cost_usd !== undefined) return usage;
  if (usage.model === 'unknown') return usage;
  const pricing = ANTHROPIC_PRICING_2026[usage.model];
  if (!pricing) return usage;
  const cost = computeUsageCost(usage, pricing, INPUT_RATIO, OUTPUT_RATIO);
  return { ...usage, cost_usd: Number(cost.toFixed(6)) };
}

/**
 * Synthesize virtual `pm-orchestrator` dispatches from `pm_orchestrator_sessions[]`.
 * Each entry from the Stop hook becomes one dispatch row with role='pm-orchestrator',
 * carrying real (non-70/30) input/output/cache usage in `usage.breakdown`.
 */
function synthesizePmDispatches(manifest: Record<string, unknown>): Session['dispatches'] {
  const raw = manifest.pm_orchestrator_sessions;
  if (!isArray(raw)) return [];
  const out: Session['dispatches'] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const sessionId = typeof entry.session_id === 'string' ? entry.session_id : null;
    const startedAt = typeof entry.started_at === 'string' ? entry.started_at : null;
    if (!sessionId || !startedAt) continue;
    const completedAt = typeof entry.completed_at === 'string' ? entry.completed_at : null;
    const model = typeof entry.model === 'string' ? entry.model : 'unknown';
    const u = isRecord(entry.usage) ? entry.usage : {};
    const inputTokens = typeof u.input_tokens === 'number' ? u.input_tokens : 0;
    const outputTokens = typeof u.output_tokens === 'number' ? u.output_tokens : 0;
    const cacheCreate =
      typeof u.cache_creation_input_tokens === 'number' ? u.cache_creation_input_tokens : 0;
    const cacheRead = typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0;
    const toolUses = typeof u.tool_uses === 'number' ? u.tool_uses : 0;
    const totalTokens = inputTokens + outputTokens + cacheCreate + cacheRead;
    const durationMs =
      completedAt && startedAt
        ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
        : 0;
    const usage: Usage = {
      total_tokens: totalTokens,
      tool_uses: toolUses,
      duration_ms: durationMs,
      model:
        model === 'opus-4-7' || model === 'sonnet-4-6' || model === 'haiku-4-5' ? model : 'unknown',
      breakdown: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreate,
        cache_read_input_tokens: cacheRead,
      },
    };
    out.push({
      dispatchId: `pm-orchestrator-${sessionId.slice(0, 8)}`,
      role: 'pm-orchestrator',
      status: 'done',
      startedAt,
      completedAt,
      outputPacket: null,
      loop: null,
      pmNote:
        typeof entry.note === 'string' ? entry.note : 'PM/orchestrator session (Stop hook capture)',
      usage: attachCostUsd(usage),
    });
  }
  return out;
}

/**
 * Build a Map<dispatch_id, Usage> from all backfill sections in the manifest.
 * Matches any top-level key matching /^pre_feat_\d+_backfilled_usage$/.
 * Real capture (actual_dispatches[].usage) takes precedence over backfill.
 */
function buildBackfillLookup(manifest: Record<string, unknown>): Map<string, Usage> {
  const lookup = new Map<string, Usage>();
  const backfillKeyPattern = /^pre_feat_\d+_backfilled_usage$/;
  for (const key of Object.keys(manifest)) {
    if (!backfillKeyPattern.test(key)) continue;
    const entries = manifest[key];
    if (!isArray(entries)) continue;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const dispatchId = entry.dispatch_id;
      if (typeof dispatchId !== 'string') continue;
      if (isUsage(entry)) {
        lookup.set(dispatchId, entry);
      }
    }
  }
  return lookup;
}

export function normaliseDispatches(manifest: unknown): Session['dispatches'] {
  if (!isRecord(manifest)) return [];
  const actualDispatches = manifest.actual_dispatches;
  if (!isArray(actualDispatches)) return [];

  // AC-022: build backfill lookup so dispatches without real usage can fall back
  const backfillLookup = buildBackfillLookup(manifest);

  const subagentDispatches = actualDispatches.flatMap((raw): Session['dispatches'] => {
    if (!isRecord(raw)) return [];
    const role = raw.role;
    const status = raw.status;
    const dispatchId = raw.dispatch_id;
    const startedAt = raw.started_at;

    if (!isRole(role) || !isDispatchStatus(status)) return [];
    if (typeof dispatchId !== 'string' || typeof startedAt !== 'string') {
      return [];
    }

    const completedAt = typeof raw.completed_at === 'string' ? raw.completed_at : null;
    const loop =
      typeof raw.loop === 'number'
        ? raw.loop
        : typeof raw.review_loop === 'number'
          ? raw.review_loop
          : null;
    const pmNote = typeof raw.pm_note === 'string' ? raw.pm_note : null;
    // FEAT-003: real capture takes precedence; backfill is fallback (AC-017, AC-022)
    let usage: Usage | undefined;
    if (isUsage(raw.usage)) {
      // Normalize model string: manifest may emit long-form "claude-sonnet-4-6"
      // but pricing table keys are short-form "sonnet-4-6" etc.
      usage = { ...raw.usage, model: normalizeModel(raw.usage.model) };
    } else {
      usage = backfillLookup.get(dispatchId);
    }

    // FEAT-004 T-018 / AC-016: read tier_calibration (snake_case in JSON → camelCase in TS).
    // AC-016 contract: present-or-absent dichotomy — if guard fails, leave undefined (unknown bucket).
    // Guard enforces all four required fields + effort enum before any field is trusted.
    let tierCalibration: TierCalibration | undefined;
    if (isTierCalibration(raw.tier_calibration)) {
      const tc = raw.tier_calibration;
      tierCalibration = {
        tier: tc.tier,
        model: tc.model,
        effort: tc.effort,
        loopKind: tc.loop_kind,
      };
    }

    const dispatchEntry: Session['dispatches'][number] = {
      dispatchId,
      role,
      status,
      startedAt,
      completedAt,
      outputPacket: null, // resolved later by caller if needed
      loop,
      pmNote,
    };
    if (usage !== undefined) {
      dispatchEntry.usage = attachCostUsd(usage);
    }
    if (tierCalibration !== undefined) {
      dispatchEntry.tierCalibration = tierCalibration;
    }

    return [dispatchEntry];
  });

  return [...subagentDispatches, ...synthesizePmDispatches(manifest)];
}

/**
 * Derive a QA status from an object-map value.
 * - string that is a valid QaStatus → use directly
 * - "deferred" string → treat as 'partial' (closest valid status)
 * - non-empty array → treat as 'pass' (array of evidence IDs)
 * - anything else → null (skip)
 */
function deriveQaStatusFromValue(value: unknown): 'pass' | 'partial' | 'fail' | null {
  if (typeof value === 'string') {
    if (isQaStatus(value)) return value;
    if (value === 'deferred') return 'partial';
    return null;
  }
  if (isArray(value) && value.length > 0) return 'pass';
  return null;
}

export function aggregateQaResults(outputs: RawSession['outputs']): Session['qaResults'] {
  const results: Session['qaResults'] = [];
  for (const output of outputs) {
    if (!isRecord(output.data)) continue;
    const role = output.data.role;
    if (role !== 'qa') continue;
    const acCoverage = output.data.ac_coverage;

    if (isArray(acCoverage)) {
      // Legacy format: array of { ac, status } objects
      for (const entry of acCoverage) {
        if (!isRecord(entry)) continue;
        const ac = entry.ac;
        const status = entry.status;
        if (typeof ac === 'string' && isQaStatus(status)) {
          results.push({ ac, status });
        }
      }
    } else if (isRecord(acCoverage)) {
      // Current format: object map { "AC-XXX": "pass" | "fail" | "deferred" | string[] }
      for (const [ac, value] of Object.entries(acCoverage)) {
        const status = deriveQaStatusFromValue(value);
        if (status !== null) {
          results.push({ ac, status });
        }
      }
    }
  }
  return results;
}

export function attachOutputPackets(
  dispatches: Session['dispatches'],
  outputs: RawSession['outputs'],
): Session['dispatches'] {
  return dispatches.map((d) => {
    const match = outputs.find((o) => {
      if (!isRecord(o.data)) return false;
      return o.data.dispatch_id === d.dispatchId;
    });
    if (match && isRecord(match.data)) {
      return { ...d, outputPacket: match.data };
    }
    return d;
  });
}
