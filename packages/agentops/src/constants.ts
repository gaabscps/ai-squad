/**
 * AgentOps observability extractor — industrial threshold constants.
 * Each constant cites its source reference.
 */

/**
 * Anthropic model pricing for 2026 (verified Apr 2026).
 * Source: https://platform.claude.com/docs/en/about-claude/pricing
 * Units: USD per million tokens (input / output).
 * Review quarterly — pricing may change.
 *
 * Covers AC-019 (FEAT-003).
 */
export const ANTHROPIC_PRICING_2026 = {
  'opus-4-7': { input_per_mtok_usd: 5, output_per_mtok_usd: 25 },
  'sonnet-4-6': { input_per_mtok_usd: 3, output_per_mtok_usd: 15 },
  'haiku-4-5': { input_per_mtok_usd: 1, output_per_mtok_usd: 5 },
} as const;

/**
 * Cache pricing multipliers (vs base input rate).
 * Source: https://docs.claude.com/en/docs/build-with-claude/prompt-caching
 *   - cache write (5m TTL): 1.25x base input
 *   - cache write (1h TTL): 2x base input
 *   - cache read: 0.1x base input
 * For mixed/unknown TTL we use 1.25x (conservative, matches Anthropic's default 5m).
 */
export const CACHE_PRICING_MULTIPLIERS = {
  cache_write: 1.25,
  cache_read: 0.1,
} as const;

// Galileo healthy escalation band (ref: Galileo blog, 2026 — "10–15% escalation rate is healthy")
export const GALILEO_HEALTHY_ESCALATION_BAND = { lower: 0.1, upper: 0.15 } as const;

// Project heuristic: task success rate (trust score) below 60% warrants investigation
export const TRUST_SCORE_INVESTIGATE_THRESHOLD = 0.6;

// Project heuristic: task success rate at or above 80% is considered healthy/positive signal
export const TRUST_SCORE_HEALTHY_THRESHOLD = 0.8;

// Project heuristic: loop rate above 50% suggests systemic re-work — investigate preflight contract
export const LOOP_RATE_INVESTIGATE_THRESHOLD = 0.5;

export type Compliance = 'pre-standard' | 'pm-bypass' | 'standard';

/**
 * Classifies a session's compliance status based on injected flow lists.
 * Priority: priorFlows > bypassFlows > standard.
 * If taskId appears in both priorFlows and bypassFlows, priorFlows wins.
 *
 * priorFlows e bypassFlows são injetados pelo caller (via ResolvedConfig)
 * em vez de serem hardcoded — satisfaz AC-002.
 * Default: [] para ambos, resultando em compliance='standard' para qualquer taskId.
 */
export function complianceForFlow(
  taskId: string,
  priorFlows: readonly string[] = [],
  bypassFlows: readonly string[] = [],
): Compliance {
  if (priorFlows.includes(taskId)) return 'pre-standard';
  if (bypassFlows.includes(taskId)) return 'pm-bypass';
  return 'standard';
}

/**
 * Flows excluídos de trends/health (união pré-padrão + pm-bypass).
 * priorFlows e bypassFlows são injetados pelo caller (via ResolvedConfig).
 * Default: [] para ambos — nenhum flow excluído se não configurado.
 */
export function isExcludedFromHealth(
  taskId: string,
  priorFlows: readonly string[] = [],
  bypassFlows: readonly string[] = [],
): boolean {
  return complianceForFlow(taskId, priorFlows, bypassFlows) !== 'standard';
}

/**
 * Paths to scan for token usage within each Output Packet JSON object.
 * Ordered by preference (most standard first).
 * Ref: OpenTelemetry GenAI Semantic Conventions (https://opentelemetry.io/docs/specs/semconv/gen-ai/)
 */
export const TOKEN_PATHS: readonly (readonly string[])[] = [
  // OTel GenAI semconv — preferred standard namespace
  ['gen_ai', 'usage', 'total_tokens'],
  // Common usage block — total tokens (sum of input + output)
  ['usage', 'total_tokens'],
  // OTel GenAI semconv — input tokens (combined with output_tokens when total absent)
  ['usage', 'input_tokens'],
  // OTel GenAI semconv — output tokens (combined with input_tokens when total absent)
  ['usage', 'output_tokens'],
  // Legacy / custom metadata block
  ['metadata', 'tokens'],
] as const;
