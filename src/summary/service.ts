import type { spawn as realSpawn } from "node:child_process";
import { runAgent, buildClaudeAdapter, type AgentHandle, type ModelAlias } from "../ai/run.js";

export interface SummaryCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null, modelId: string | null) => void;
  onError: (message: string) => void;
}

export type SummaryHandle = AgentHandle;

export interface SummaryDeps {
  spawnFn?: typeof realSpawn;
  cwd?: string;
  model?: ModelAlias;
}

export function runSummary(prompt: string, cb: SummaryCallbacks, deps: SummaryDeps = {}): SummaryHandle {
  const adapter = buildClaudeAdapter(deps.model ?? "sonnet");
  return runAgent(prompt, cb, { adapter, spawnFn: deps.spawnFn, cwd: deps.cwd });
}
