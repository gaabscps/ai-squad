/**
 * AgentOps observability extractor — shared type definitions.
 * Types: FEAT-001 ConfigResolver (AgentOpsConfig, ResolvedConfig, ClaudeHookEntry, ClaudeSettings); FEAT-002 DM-1..DM-5; FEAT-003 DM-1..DM-4.
 */

// FEAT-003 DM-1 — Usage: per-dispatch token usage captured from <usage> annotation
export interface Usage {
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
  /** Model identifier; 'unknown' when not determinable */
  model: 'opus-4-7' | 'sonnet-4-6' | 'haiku-4-5' | 'unknown';
  /**
   * Optional fine-grained breakdown (FEAT-005 — PM session capture via Stop hook).
   * When present, cost computation uses these values + cache pricing instead of
   * the 70/30 split assumption applied to total_tokens.
   */
  breakdown?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  /** Pre-computed USD cost for this dispatch (FEAT-005+; may be absent). */
  cost_usd?: number;
}

// FEAT-003 DM-4 — BackfillEntry: retroactive usage estimate from conversation log
export interface BackfillEntry {
  dispatch_id: string;
  total_tokens: number;
  tool_uses: number;
  duration_ms: number;
  model: string;
  backfill_source: 'conversation_log_estimate' | 'manual';
}

// FEAT-003 DM-2 — RepoHealth: snapshot of quality metrics from reports/
export interface RepoHealth {
  mutation: { score: number; killed: number; total: number } | null;
  typeCoverage: { percent: number; anyCount: number } | null;
  depViolations: { error: number; warn: number } | null;
  measuredAt: string;
}

// FEAT-003 DM-3 — CostMetric: USD cost estimate for a session
export interface CostMetric {
  total_usd: number | null;
  per_ac_usd: number | null;
  per_dispatch_avg_usd: number | null;
  coverage: { included: number; total: number };
  assumption_note: string;
}

// DM-5 — Role: all known dispatch roles in the SDD framework
export type Role =
  | 'dev'
  | 'code-reviewer'
  | 'logic-reviewer'
  | 'qa'
  | 'blocker-specialist'
  | 'audit-agent'
  /** PM/orchestrator session — populated from Stop hook (FEAT-005). Virtual dispatch. */
  | 'pm-orchestrator';

// DM-5 — DispatchStatus: possible status values for a dispatch
export type DispatchStatus = 'done' | 'needs_review' | 'blocked' | 'escalate' | 'partial';

// DM-5 — PhaseName: known SDD pipeline phases
export type PhaseName = 'specify' | 'plan' | 'tasks' | 'implementation';

// DM-1 — RawSession: raw output of parse.ts — data aggregated without normalisation
export interface RawSession {
  taskId: string;
  /** Parsed YAML from session.yml; type-guarded downstream */
  sessionYml: unknown;
  /** Parsed JSON from dispatch-manifest.json; null if absent or malformed */
  manifest: unknown;
  /** All outputs/*.json files; data is parsed JSON (unknown until type-guarded) */
  outputs: { filename: string; data: unknown }[];
  /** Raw markdown content of spec.md; null if absent */
  specMd: string | null;
  /** Absolute filesystem path of the session directory */
  sessionDirPath: string;
}

// Re-export Compliance type from constants for downstream consumers
export type { Compliance } from './constants';

// DM-2 — Session: normalised session produced by enrich.ts
export interface Session {
  taskId: string;
  featureName: string;
  /** Conformidade do flow com o contrato canônico ai-squad + extensões locais. */
  compliance: import('./constants').Compliance;
  currentPhase: 'specify' | 'plan' | 'tasks' | 'implementation' | 'paused' | 'done' | 'escalated';
  status: 'running' | 'done' | 'paused' | 'escalated' | 'specify-only';
  /** ISO 8601 string */
  startedAt: string;
  /** ISO 8601 string or null if still running */
  completedAt: string | null;
  phases: {
    name: string;
    startedAt: string | null;
    completedAt: string | null;
    status: string;
  }[];
  dispatches: {
    dispatchId: string;
    role: Role;
    status: DispatchStatus;
    startedAt: string;
    completedAt: string | null;
    outputPacket: Record<string, unknown> | null;
    loop: number | null;
    pmNote: string | null;
    /** Per-dispatch token usage from <usage> annotation (FEAT-003+). Optional for back-compat. */
    usage?: Usage;
  }[];
  /** AC identifiers extracted from spec.md via regex (e.g. 'AC-001') */
  acs: string[];
  qaResults: { ac: string; status: 'pass' | 'partial' | 'fail' }[];
  expectedPipeline: {
    batchId?: string;
    taskId?: string;
    /** Human-readable title from dispatch-manifest.json (FEAT-005 T-003). */
    title?: string;
    /** AC identifiers this batch covers, from dispatch-manifest.json (FEAT-005 T-003). */
    acScope?: string[];
    /** Task IDs covered by this batch, from dispatch-manifest.json (FEAT-005 T-003). */
    tasksCovered?: string[];
    requiredRoles: Role[];
  }[];
  escalationMetrics: {
    escalationRate: number;
  } | null;
  /**
   * Structured warning entries from .agent-session/<taskId>/warnings.json (AC-009).
   * Empty array when warnings.json is absent, empty, or malformed.
   * Optional for backward compatibility with pre-AC-009 Session objects.
   */
  warnings?: { reason: string; timestamp: string; session_id: string }[];
}

// DM-3 — Metrics: all computed metrics for a session
export interface Metrics {
  taskId: string;
  featureName: string;
  /** Propagado de Session.compliance — usado por trends/health para exclusão. */
  compliance: import('./constants').Compliance;
  currentPhase: Session['currentPhase'];
  status: Session['status'];
  startedAt: string;
  totalDispatches: number;
  dispatchesByRole: Record<Role, number>;
  taskSuccessRate: Record<Role, number | null>;
  loopRate: number;
  escalationRate: number;
  phaseDurations: Record<string, number | 'running' | 'not_started'>;
  acClosure: {
    total: number;
    pass: number;
    partial: number;
    fail: number;
    missing: number;
  };
  reviewerFindings: { critical: number; major: number; minor: number } | null;
  dispatchesPerAc: number;
  tokenCost: { total: number | null; perAc: number | null };
  /** FEAT-003: USD cost estimate derived from usage data + pricing constants */
  cost?: CostMetric;
  /** FEAT-003: Repo health snapshot from reports/ (mutation, type-coverage, dep-violations) */
  repoHealth?: RepoHealth | null;
  /** Reserved hook for future rework-rate metric; null in MVP */
  reworkRate: null;
  insights: Insight[];
}

// DM-4 — Insight: output of an insights rule
export interface Insight {
  ruleId: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  /** Source framework or reference for the heuristic, e.g. 'Galileo healthy band' */
  source: string | null;
}

// ============================================================
// ConfigResolver types (FEAT-001)
// ============================================================

/** Schema for .agentops.json in consumer project root. */
export interface AgentOpsConfig {
  sessionPrefix: string | string[];
  reportCommand?: string | null;
  priorFlows?: string[];
  bypassFlows?: string[];
  rootDir?: string;
}

/** Source of a resolved config field. */
export type ConfigSource = 'env' | 'config' | 'default';

/** A resolved config field with its value and provenance. */
export interface ResolvedField<T> {
  value: T;
  source: ConfigSource;
}

/** Fully resolved configuration with per-field provenance. */
export interface ResolvedConfig {
  sessionPrefix: ResolvedField<string | string[]>;
  reportCommand: ResolvedField<string | null>;
  priorFlows: ResolvedField<string[]>;
  bypassFlows: ResolvedField<string[]>;
  rootDir: ResolvedField<string>;
}

/** Single hook command within a Stop hook entry. */
export interface ClaudeHookCommand {
  type: 'command';
  command: string;
}

/** Entry in .claude/settings.local.json hooks.Stop array. */
export interface ClaudeHookEntry {
  matcher: string;
  hooks: ClaudeHookCommand[];
}

/** Partial shape of .claude/settings.local.json relevant to install-hooks. */
export interface ClaudeSettings {
  hooks?: {
    Stop?: ClaudeHookEntry[];
    [key: string]: ClaudeHookEntry[] | undefined;
  };
}
