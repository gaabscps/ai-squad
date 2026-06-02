import type { spawn as realSpawn } from "node:child_process";
import { runAgent, claudeAdapter, type AgentHandle } from "../ai/run.js";

export interface SummaryCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null) => void;
  onError: (message: string) => void;
}

export type SummaryHandle = AgentHandle;

export interface SummaryDeps {
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

/** Resumo de task = runAgent com o adaptador do Claude. Mantém a assinatura antiga. */
export function runSummary(prompt: string, cb: SummaryCallbacks, deps: SummaryDeps = {}): SummaryHandle {
  return runAgent(prompt, cb, { adapter: claudeAdapter, spawnFn: deps.spawnFn, cwd: deps.cwd });
}
