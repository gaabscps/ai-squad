/**
 * Dispatch normalisation, QA results aggregation, and output packet attachment.
 *
 * FEAT-006 T-008 (AC-005..010): warn-on-unknown + deprecation handling.
 * The silent drop at the original line 140 is replaced by structured warning
 * emission. normaliseDispatchesWithWarnings is the new primary API; the legacy
 * normaliseDispatches delegates to it for backward compatibility.
 */

import { ANTHROPIC_PRICING_2026 } from '../constants';
import { computeUsageCost } from '../measure/cost';
import type { RawSession, Session, TierCalibration, Usage } from '../types';
import { VALID_ROLES, VALID_STATUSES, DEPRECATED_STATUSES } from '../canonical-statuses';

import { isRecord, isArray, isRole, isDispatchStatus, isQaStatus, isUsage, isTierCalibration } from './guards';

// ---------------------------------------------------------------------------
// Warning types (FEAT-006 T-008 / AC-007)
// ---------------------------------------------------------------------------

/** Emitted when a dispatch_id references a role string not in VALID_ROLES.
 *  The dispatch is dropped — no bucket possible. */
export interface UnknownRoleWarning {
  kind: 'unknown_role';
  dispatch_id: string;
  task_id: string;
  role: string;
  valid: readonly string[];
}

/** Emitted when the role is valid but the status string is not in VALID_STATUSES
 *  and not in DEPRECATED_STATUSES. The dispatch is placed in the 'unknown_status'
 *  bucket to preserve count (AC-009). */
export interface UnknownStatusWarning {
  kind: 'unknown_status';
  dispatch_id: string;
  task_id: string;
  role: string;
  status: string;
  valid: readonly string[];
}

/** Emitted when status === 'partial' (or any future deprecated value).
 *  The dispatch is processed normally (AC-010). */
export interface DeprecatedStatusWarning {
  kind: 'deprecated_status';
  dispatch_id: string;
  task_id: string;
  status: string;
  note: string;
}

export type DispatchWarning = UnknownRoleWarning | UnknownStatusWarning | DeprecatedStatusWarning;

/** Return shape of normaliseDispatchesWithWarnings. */
export interface NormaliseDispatchesResult {
  dispatches: Session['dispatches'];
  warnings: DispatchWarning[];
}

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

/**
 * Normalise actual_dispatches from a manifest with full warning emission.
 *
 * FEAT-006 T-008 (AC-005..010):
 * - Unknown role     → UnknownRoleWarning + dispatch dropped (AC-007, AC-009)
 * - Unknown status   → UnknownStatusWarning + dispatch placed in 'unknown_status'
 *                      bucket (AC-007, AC-008, AC-009)
 * - Deprecated status (e.g. "partial") → DeprecatedStatusWarning + dispatch
 *                      processed normally (AC-010)
 * - Canonical status → processed as before (AC-006)
 */
export function normaliseDispatchesWithWarnings(manifest: unknown): NormaliseDispatchesResult {
  if (!isRecord(manifest)) return { dispatches: [], warnings: [] };
  const actualDispatches = manifest.actual_dispatches;
  if (!isArray(actualDispatches)) return { dispatches: [], warnings: [] };

  // AC-022: build backfill lookup so dispatches without real usage can fall back
  const backfillLookup = buildBackfillLookup(manifest);
  const warnings: DispatchWarning[] = [];

  const subagentDispatches = actualDispatches.flatMap((raw): Session['dispatches'] => {
    if (!isRecord(raw)) return [];
    const role = raw.role;
    const status = raw.status;
    const dispatchId = typeof raw.dispatch_id === 'string' ? raw.dispatch_id : '(unknown)';
    const taskId = typeof raw.task_id === 'string' ? raw.task_id : '';
    const startedAt = raw.started_at;

    // --- Role validation (AC-007 unknown_role) ---
    if (!isRole(role)) {
      warnings.push({
        kind: 'unknown_role',
        dispatch_id: dispatchId,
        task_id: taskId,
        role: typeof role === 'string' ? role : String(role),
        valid: VALID_ROLES,
      });
      return []; // drop — no bucket possible for unknown role
    }

    // From here: role is valid. Check status.
    const statusStr = typeof status === 'string' ? status : String(status);

    // --- Deprecated status (AC-010, AC-005) ---
    const isDeprecated = typeof status === 'string' && (DEPRECATED_STATUSES as string[]).includes(status);
    if (isDeprecated) {
      warnings.push({
        kind: 'deprecated_status',
        dispatch_id: dispatchId,
        task_id: taskId,
        status: statusStr,
        note: `deprecated; will be removed in vNext+1`,
      });
      // Fall through to process normally — effective status is the deprecated value
    } else if (!isDispatchStatus(status)) {
      // --- Unknown status (AC-007, AC-008) ---
      warnings.push({
        kind: 'unknown_status',
        dispatch_id: dispatchId,
        task_id: taskId,
        role: role as string,
        status: statusStr,
        valid: VALID_STATUSES,
      });
      // Place in unknown_status bucket (AC-008) — startedAt required
      if (typeof raw.dispatch_id !== 'string' || typeof startedAt !== 'string') return [];
      // Build minimal dispatch entry with status='unknown_status'
      const completedAt = typeof raw.completed_at === 'string' ? raw.completed_at : null;
      const loop =
        typeof raw.loop === 'number'
          ? raw.loop
          : typeof raw.review_loop === 'number'
            ? raw.review_loop
            : null;
      const pmNote = typeof raw.pm_note === 'string' ? raw.pm_note : null;
      const unknownEntry: Session['dispatches'][number] = {
        dispatchId,
        role: role as Session['dispatches'][number]['role'],
        status: 'unknown_status' as Session['dispatches'][number]['status'],
        startedAt,
        completedAt,
        outputPacket: null,
        loop,
        pmNote,
      };
      if (typeof raw.task_id === 'string' && raw.task_id.length > 0) {
        unknownEntry.taskId = raw.task_id;
      }
      return [unknownEntry];
    }

    // --- dispatch_id / startedAt guard ---
    // dispatchId was set above: raw.dispatch_id if string, else '(unknown)'.
    // If raw.dispatch_id was not a string, it would equal '(unknown)' — but the
    // actual raw.dispatch_id would be undefined/non-string, so the equality check
    // below drops it. Also guard startedAt is a string.
    if (typeof raw.dispatch_id !== 'string' || typeof startedAt !== 'string') {
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
    // Normalise partial usage shapes before the type guard:
    //   - model: null (Python None) or absent → 'unknown'
    //   - tool_uses / duration_ms absent → 0 (some manifests emit token-only entries)
    //   - cost_usd: 0 is a placeholder in early manifests; remove so attachCostUsd recomputes
    const rawUsage = isRecord(raw.usage)
      ? {
          tool_uses: 0,
          duration_ms: 0,
          ...raw.usage,
          model: raw.usage.model == null ? 'unknown' : String(raw.usage.model),
          ...(raw.usage.cost_usd === 0 ? { cost_usd: undefined } : {}),
        }
      : raw.usage;
    if (isUsage(rawUsage)) {
      // Normalize model string: manifest may emit long-form "claude-sonnet-4-6"
      // but pricing table keys are short-form "sonnet-4-6" etc.
      usage = { ...rawUsage, model: normalizeModel(rawUsage.model) };
      // Manifest may emit flat breakdown fields (input_tokens, output_tokens, cache_*)
      // alongside total_tokens. Map them into breakdown so computeUsageCost uses accurate
      // cache pricing instead of the 70/30 split assumption.
      if (
        !usage.breakdown &&
        typeof rawUsage.input_tokens === 'number' &&
        typeof rawUsage.output_tokens === 'number' &&
        typeof rawUsage.cache_creation_input_tokens === 'number' &&
        typeof rawUsage.cache_read_input_tokens === 'number'
      ) {
        usage = {
          ...usage,
          breakdown: {
            input_tokens: rawUsage.input_tokens as number,
            output_tokens: rawUsage.output_tokens as number,
            cache_creation_input_tokens: rawUsage.cache_creation_input_tokens as number,
            cache_read_input_tokens: rawUsage.cache_read_input_tokens as number,
          },
        };
      }
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
    if (typeof raw.task_id === 'string' && raw.task_id.length > 0) {
      dispatchEntry.taskId = raw.task_id;
    }
    if (usage !== undefined) {
      dispatchEntry.usage = attachCostUsd(usage);
    }
    if (tierCalibration !== undefined) {
      dispatchEntry.tierCalibration = tierCalibration;
    }

    return [dispatchEntry];
  });

  return {
    dispatches: [...subagentDispatches, ...synthesizePmDispatches(manifest)],
    warnings,
  };
}

/**
 * Legacy export: normaliseDispatches returns only the dispatches array.
 * Delegates to normaliseDispatchesWithWarnings; warnings are silently discarded.
 * Callers that need warnings should use normaliseDispatchesWithWarnings instead.
 *
 * Preserved for backward compatibility with enrich.ts, cost-rollups, and
 * manifest-backward-compat tests which are outside T-008 scope_files.
 */
export function normaliseDispatches(manifest: unknown): Session['dispatches'] {
  return normaliseDispatchesWithWarnings(manifest).dispatches;
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
      // Keys may be namespace-qualified ("FEAT-005/AC-001") — strip prefix for lookup.
      for (const [rawAc, value] of Object.entries(acCoverage)) {
        const ac = rawAc.includes('/') ? rawAc.slice(rawAc.lastIndexOf('/') + 1) : rawAc;
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
      let updatedDispatch: Session['dispatches'][number] = { ...d, outputPacket: match.data };
      // Fallback: if dispatch has no usage but output packet carries usage, populate from packet.
      if (!updatedDispatch.usage && isRecord(match.data)) {
        const packetUsage = match.data.usage;
        if (packetUsage !== null && packetUsage !== undefined && isRecord(packetUsage)) {
          const normalized = {
            tool_uses: 0,
            duration_ms: 0,
            ...packetUsage,
            model: (packetUsage.model == null ? 'unknown' : String(packetUsage.model)),
            ...(packetUsage.cost_usd === 0 ? { cost_usd: undefined } : {}),
          };
          if (isUsage(normalized)) {
            let finalUsage = { ...normalized, model: normalizeModel(normalized.model) };
            if (
              !finalUsage.breakdown &&
              typeof normalized.input_tokens === 'number' &&
              typeof normalized.output_tokens === 'number' &&
              typeof normalized.cache_creation_input_tokens === 'number' &&
              typeof normalized.cache_read_input_tokens === 'number'
            ) {
              finalUsage = {
                ...finalUsage,
                breakdown: {
                  input_tokens: normalized.input_tokens as number,
                  output_tokens: normalized.output_tokens as number,
                  cache_creation_input_tokens: normalized.cache_creation_input_tokens as number,
                  cache_read_input_tokens: normalized.cache_read_input_tokens as number,
                },
              };
            }
            updatedDispatch = { ...updatedDispatch, usage: attachCostUsd(finalUsage) };
          }
        }
      }
      return updatedDispatch;
    }
    return d;
  });
}
