/**
 * capture-pm-session.ts — Stop hook: aggregates Claude Code session usage
 * (the PM/orchestrator) and upserts it into the active SDD task's manifest.
 * Also detects SDD phase coverage (specify/plan/tasks/implementation/mixed).
 * Task selection: AGENTOPS_TASK_ID env > .current pointer > most-recent non-done yml.
 * Idempotent: rewrites the entry for (session_id × model) on each run.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { loadConfig } from '../config';
import { detectPhaseCoverage, readPhaseHistory, type PhaseEntry } from './phase-coverage';

interface HookInput {
  transcript_path?: string;
  session_id?: string;
  cwd?: string;
}

interface UsageBlock {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface AssistantTurn {
  type: string;
  timestamp?: string;
  message?: {
    model?: string;
    content?: { type: string }[];
    usage?: UsageBlock;
  };
}

export interface ModelAgg {
  inputTokens: number;
  outputTokens: number;
  cacheCreate: number;
  cacheRead: number;
  toolUses: number;
  firstTs: string | null;
  lastTs: string | null;
  turns: number;
}

const MODEL_NORMALIZE: Record<string, string> = {
  'claude-opus-4-7': 'opus-4-7',
  'claude-sonnet-4-6': 'sonnet-4-6',
  'claude-haiku-4-5': 'haiku-4-5',
};

function normalizeModel(raw: string | undefined): string {
  if (!raw) return 'unknown';
  if (MODEL_NORMALIZE[raw]) return MODEL_NORMALIZE[raw];
  if (raw.includes('opus')) return 'opus-4-7';
  if (raw.includes('sonnet')) return 'sonnet-4-6';
  if (raw.includes('haiku')) return 'haiku-4-5';
  return 'unknown';
}

/* istanbul ignore next */
async function readStdinAsync(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    // Safety timeout — if no data piped (e.g. manual invocation), resolve empty
    setTimeout(() => resolve(data), 200);
  });
}

function parseTranscript(transcriptPath: string): Record<string, ModelAgg> {
  const byModel: Record<string, ModelAgg> = {};
  if (!fs.existsSync(transcriptPath)) return byModel;
  const raw = fs.readFileSync(transcriptPath, 'utf-8');
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let entry: AssistantTurn;
    try {
      entry = JSON.parse(line) as AssistantTurn;
    } catch {
      continue;
    }
    if (entry.type !== 'assistant' || !entry.message) continue;
    const model = normalizeModel(entry.message.model);
    const u = entry.message.usage ?? {};
    const ts = entry.timestamp ?? null;
    const agg = byModel[model] ?? {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreate: 0,
      cacheRead: 0,
      toolUses: 0,
      firstTs: null,
      lastTs: null,
      turns: 0,
    };
    agg.inputTokens += u.input_tokens ?? 0;
    agg.outputTokens += u.output_tokens ?? 0;
    agg.cacheCreate += u.cache_creation_input_tokens ?? 0;
    agg.cacheRead += u.cache_read_input_tokens ?? 0;
    agg.turns += 1;
    if (Array.isArray(entry.message.content)) {
      for (const c of entry.message.content) {
        if (c.type === 'tool_use') agg.toolUses += 1;
      }
    }
    if (ts) {
      if (!agg.firstTs || ts < agg.firstTs) agg.firstTs = ts;
      if (!agg.lastTs || ts > agg.lastTs) agg.lastTs = ts;
    }
    byModel[model] = agg;
  }
  return byModel;
}

function pickActiveTaskId(repoRoot: string): string | null {
  if (process.env.AGENTOPS_TASK_ID) return process.env.AGENTOPS_TASK_ID;
  const pointer = path.join(repoRoot, '.agent-session', '.current');
  if (fs.existsSync(pointer)) {
    const id = fs.readFileSync(pointer, 'utf-8').trim();
    if (id) return id;
  }
  const sessionsDir = path.join(repoRoot, '.agent-session');
  if (!fs.existsSync(sessionsDir)) return null;
  let best: { id: string; mtime: number } | null = null;
  for (const name of fs.readdirSync(sessionsDir)) {
    const ymlPath = path.join(sessionsDir, name, 'session.yml');
    if (!fs.existsSync(ymlPath)) continue;
    const yml = fs.readFileSync(ymlPath, 'utf-8');
    if (/current_phase:\s*"?done"?/.test(yml)) continue;
    const mtime = fs.statSync(ymlPath).mtimeMs;
    if (!best || mtime > best.mtime) best = { id: name, mtime };
  }
  return best?.id ?? null;
}

export function isSessionDone(sessionYmlPath: string): boolean {
  if (!fs.existsSync(sessionYmlPath)) return false;
  const yml = fs.readFileSync(sessionYmlPath, 'utf-8');
  return /^\s*current_phase:\s*"?done"?\s*$/m.test(yml);
}

/**
 * Detects done sessions whose AgentOps report is missing or older than their
 * manifest, and triggers `npm run agentops:report` (detached, non-blocking)
 * if any are found. Idempotent: subsequent runs after the report is up-to-date
 * are no-ops. Disable via AGENTOPS_AUTO_REPORT=0.
 *
 * Independent from pickActiveTaskId because that picker skips done sessions
 * — exactly the ones we need to regenerate for.
 */
export async function maybeRegenerateReport(repoRoot: string): Promise<void> {
  if (process.env.AGENTOPS_AUTO_REPORT === '0') return;
  const sessionsDir = path.join(repoRoot, '.agent-session');
  if (!fs.existsSync(sessionsDir)) return;
  const reportsDir = path.join(repoRoot, 'docs', 'agentops');
  const stale: string[] = [];
  for (const name of fs.readdirSync(sessionsDir)) {
    if (name.startsWith('.')) continue;
    const ymlPath = path.join(sessionsDir, name, 'session.yml');
    const manifestPath = path.join(sessionsDir, name, 'dispatch-manifest.json');
    if (!fs.existsSync(ymlPath) || !fs.existsSync(manifestPath)) continue;
    if (!isSessionDone(ymlPath)) continue;
    const reportPath = path.join(reportsDir, `${name}.md`);
    const manifestMtime = fs.statSync(manifestPath).mtimeMs;
    const reportMtime = fs.existsSync(reportPath) ? fs.statSync(reportPath).mtimeMs : 0;
    if (manifestMtime > reportMtime) stale.push(name);
  }
  if (stale.length === 0) return;

  try {
    const config = await loadConfig(repoRoot);
    const reportCommand = config.reportCommand.value;

    if (reportCommand === null || reportCommand.trim() === '') return;

    process.stderr.write(
      `[capture-pm-session] stale agentops reports for ${stale.join(', ')} — regenerating (detached)\n`,
    );
    const [cmd, ...args] = reportCommand.trim().split(/\s+/);
    const child = spawn(cmd!, args, {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // config unavailable or spawn failed — skip report, capture proceeds
  }
}

export function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.agent-session'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return start;
}

function upsertEntry(
  manifestPath: string,
  sessionId: string,
  model: string,
  agg: ModelAgg,
  phases: PhaseEntry[] | undefined,
): void {
  const raw = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as Record<string, unknown>;
  const existing = Array.isArray(manifest.pm_orchestrator_sessions)
    ? (manifest.pm_orchestrator_sessions as Record<string, unknown>[])
    : [];
  const filtered = existing.filter((e) => !(e.session_id === sessionId && e.model === model));
  const startedAt = agg.firstTs ?? new Date().toISOString();
  const completedAt = agg.lastTs ?? new Date().toISOString();
  const { phase_coverage, phase_split } = detectPhaseCoverage(startedAt, completedAt, phases ?? []);
  const entry: Record<string, unknown> = {
    session_id: sessionId,
    model,
    started_at: startedAt,
    completed_at: completedAt,
    note: `PM/orchestrator session (Stop hook): ${agg.turns} turns`,
    usage: {
      input_tokens: agg.inputTokens,
      output_tokens: agg.outputTokens,
      cache_creation_input_tokens: agg.cacheCreate,
      cache_read_input_tokens: agg.cacheRead,
      tool_uses: agg.toolUses,
    },
    phase_coverage,
  };
  if (phase_split !== undefined) entry.phase_split = phase_split;
  filtered.push(entry);
  manifest.pm_orchestrator_sessions = filtered;
  const tmp = manifestPath + '.pm-session.tmp';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, manifestPath);
}

/* istanbul ignore next */
async function main(): Promise<void> {
  const stdin = await readStdinAsync();
  let input: HookInput = {};
  try {
    input = JSON.parse(stdin) as HookInput;
  } catch {
    // ignore — fall back to env-only mode
  }
  const transcriptPath = input.transcript_path ?? process.env.CLAUDE_TRANSCRIPT_PATH;
  const sessionId = input.session_id ?? process.env.CLAUDE_SESSION_ID ?? 'unknown';
  const cwd = input.cwd ?? process.cwd();
  if (!transcriptPath) {
    process.stderr.write('[capture-pm-session] no transcript_path; skipping\n');
    return;
  }
  const repoRoot = findRepoRoot(cwd);
  // Run regardless of active-task lookup: this catches the case where the
  // orchestrator just transitioned the task to current_phase=done (which
  // pickActiveTaskId then skips, leading to early-return without report regen).
  await maybeRegenerateReport(repoRoot);
  const taskId = pickActiveTaskId(repoRoot);
  if (!taskId) {
    process.stderr.write('[capture-pm-session] no active SDD task; skipping\n');
    return;
  }
  const manifestPath = path.join(repoRoot, '.agent-session', taskId, 'dispatch-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    process.stderr.write(`[capture-pm-session] manifest not found: ${manifestPath}\n`);
    return;
  }
  const byModel = parseTranscript(transcriptPath);
  const models = Object.keys(byModel);
  if (models.length === 0) {
    process.stderr.write('[capture-pm-session] no assistant turns in transcript; skipping\n');
    return;
  }
  const phases = readPhaseHistory(path.join(repoRoot, '.agent-session', taskId, 'session.yml'));
  for (const model of models) {
    upsertEntry(manifestPath, sessionId, model, byModel[model]!, phases);
  }
  process.stderr.write(
    `[capture-pm-session] ${taskId}: upserted ${models.length} model entr${models.length === 1 ? 'y' : 'ies'} for session ${sessionId.slice(0, 8)}\n`,
  );
}

/* istanbul ignore next */
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  void main();
}

export {
  parseTranscript,
  pickActiveTaskId,
  upsertEntry,
  normalizeModel,
};
