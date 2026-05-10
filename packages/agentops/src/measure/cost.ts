/**
 * measure/cost.ts — token cost metric sub-function.
 * All functions are pure (no I/O, no Date.now(), no random).
 * Uses TOKEN_PATHS from constants.ts for best-effort scan (Plan D14, AC-022).
 * FEAT-003: adds computeCostUsd (AC-020..AC-023).
 */

import { TOKEN_PATHS, ANTHROPIC_PRICING_2026, CACHE_PRICING_MULTIPLIERS } from '../constants';
import type { Session, CostMetric, Usage } from '../types';

interface TokenCost {
  total: number | null;
  perAc: number | null;
}

/**
 * Deep-reads a nested path from an object.
 * Returns the value if found and it is a number, otherwise undefined.
 */
function getNestedNumber(
  obj: Record<string, unknown>,
  pathArr: readonly string[],
): number | undefined {
  let current: unknown = obj;
  for (const key of pathArr) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'number' ? current : undefined;
}

/**
 * Extracts total token count from a single Output Packet.
 * Scans TOKEN_PATHS in order.
 *
 * Special handling for split tokens (input + output, no total):
 * when 'usage.input_tokens' and 'usage.output_tokens' are both present but
 * 'usage.total_tokens' is absent, we sum them.
 */
function extractTokensFromPacket(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  // Try each TOKEN_PATH in order
  for (const tokenPath of TOKEN_PATHS) {
    // Skip the individual input/output paths in the first pass — handled below
    const pathKey = tokenPath.join('.');
    if (pathKey === 'usage.input_tokens' || pathKey === 'usage.output_tokens') {
      continue;
    }
    const value = getNestedNumber(obj, tokenPath);
    if (value !== undefined) return value;
  }

  // Fallback: try summing input_tokens + output_tokens
  const inputTokens = getNestedNumber(obj, ['usage', 'input_tokens']);
  const outputTokens = getNestedNumber(obj, ['usage', 'output_tokens']);
  if (inputTokens !== undefined && outputTokens !== undefined) {
    return inputTokens + outputTokens;
  }

  return null;
}

/**
 * Computes USD cost for a single Usage record.
 * Uses fine-grained breakdown (input/output/cache) when available (FEAT-005);
 * falls back to the 70/30 split applied to total_tokens otherwise.
 */
export function computeUsageCost(
  usage: Usage,
  modelPricing: { input_per_mtok_usd: number; output_per_mtok_usd: number },
  inputRatio: number,
  outputRatio: number,
): number {
  if (usage.breakdown) {
    const b = usage.breakdown;
    const inputUsd = (b.input_tokens / 1_000_000) * modelPricing.input_per_mtok_usd;
    const outputUsd = (b.output_tokens / 1_000_000) * modelPricing.output_per_mtok_usd;
    const cacheWriteUsd =
      (b.cache_creation_input_tokens / 1_000_000) *
      modelPricing.input_per_mtok_usd *
      CACHE_PRICING_MULTIPLIERS.cache_write;
    const cacheReadUsd =
      (b.cache_read_input_tokens / 1_000_000) *
      modelPricing.input_per_mtok_usd *
      CACHE_PRICING_MULTIPLIERS.cache_read;
    return inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd;
  }
  const inputTokens = usage.total_tokens * inputRatio;
  const outputTokens = usage.total_tokens * outputRatio;
  return (
    (inputTokens / 1_000_000) * modelPricing.input_per_mtok_usd +
    (outputTokens / 1_000_000) * modelPricing.output_per_mtok_usd
  );
}

/**
 * FEAT-003 — computeCostUsd: converts per-dispatch usage data to USD.
 *
 * Algorithm (Plan D8, AC-020..AC-023):
 *   - For each dispatch with usage and a known model in pricing table:
 *     input_tokens = total_tokens × 0.7 (assumption: 70/30 input/output split)
 *     output_tokens = total_tokens × 0.3
 *     cost = (input_tokens / 1_000_000 × input_per_mtok_usd)
 *           + (output_tokens / 1_000_000 × output_per_mtok_usd)
 *   - Dispatches with missing usage OR model='unknown' are excluded (AC-022).
 *   - If zero dispatches have includable usage → total_usd = null (AC-023).
 *
 * @param session - Enriched session with dispatches[].usage fields (FEAT-003+).
 * @param pricing - Pricing table (defaults to ANTHROPIC_PRICING_2026 if omitted).
 */
export function computeCostUsd(
  session: Session,
  pricing: Partial<typeof ANTHROPIC_PRICING_2026> = ANTHROPIC_PRICING_2026,
): CostMetric {
  const INPUT_RATIO = 0.7;
  const OUTPUT_RATIO = 0.3;

  let totalUsd = 0;
  let included = 0;
  const total = session.dispatches.length;

  for (const d of session.dispatches) {
    if (!d.usage) continue;
    const { model } = d.usage;
    // AC-022: exclude dispatches with model='unknown' or not in pricing table
    if (model === 'unknown') continue;
    // pricing is Partial<typeof ANTHROPIC_PRICING_2026>; model from Usage is string
    // after 'unknown' exclusion, use bracket access with runtime null-check
    const modelPricing =
      pricing['opus-4-7' as const] !== undefined && model === 'opus-4-7'
        ? pricing['opus-4-7']
        : pricing['sonnet-4-6' as const] !== undefined && model === 'sonnet-4-6'
          ? pricing['sonnet-4-6']
          : pricing['haiku-4-5' as const] !== undefined && model === 'haiku-4-5'
            ? pricing['haiku-4-5']
            : undefined;
    if (!modelPricing) continue;

    totalUsd += computeUsageCost(d.usage, modelPricing, INPUT_RATIO, OUTPUT_RATIO);
    included++;
  }

  // AC-023: no usage data available
  if (included === 0) {
    return {
      total_usd: null,
      per_ac_usd: null,
      per_dispatch_avg_usd: null,
      coverage: { included: 0, total },
      assumption_note: `no usage data available — dispatch count fallback: ${total} dispatches`,
    };
  }

  const totalAcs = session.acs.length;
  const per_ac_usd = totalAcs > 0 ? totalUsd / totalAcs : null;
  const per_dispatch_avg_usd = totalUsd / included;

  const coverageNote =
    included < total
      ? `${included} of ${total} dispatches included in cost`
      : `${included} of ${total} dispatches included in cost`;

  return {
    total_usd: totalUsd,
    per_ac_usd,
    per_dispatch_avg_usd,
    coverage: { included, total },
    assumption_note: `70/30 input/output split assumed; harness reports only total_tokens; ${coverageNote}`,
  };
}

/**
 * Computes total token cost across all dispatches with output packets.
 * Returns null for total/perAc if no output packet has token data (AC-023).
 */
export function computeTokenCost(session: Session): TokenCost {
  let total = 0;
  let hasAnyTokenData = false;

  for (const d of session.dispatches) {
    if (!d.outputPacket) continue;
    const tokens = extractTokensFromPacket(d.outputPacket);
    if (tokens !== null) {
      total += tokens;
      hasAnyTokenData = true;
    }
  }

  if (!hasAnyTokenData) {
    return { total: null, perAc: null };
  }

  const totalAcs = session.acs.length;
  const perAc = totalAcs > 0 ? total / totalAcs : null;
  return { total, perAc };
}
