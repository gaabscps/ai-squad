import type { spawn as realSpawn } from "node:child_process";
import { runAgent, buildClaudeAdapter, type AgentHandle, type ModelAlias } from "../ai/run.js";

export interface NarrativeCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null, modelId: string | null) => void;
  onError: (message: string) => void;
}
export type NarrativeHandle = AgentHandle;
export interface NarrativeServiceDeps { spawnFn?: typeof realSpawn; cwd?: string; model?: ModelAlias }

export function runNarrative(prompt: string, cb: NarrativeCallbacks, deps: NarrativeServiceDeps = {}): NarrativeHandle {
  const adapter = buildClaudeAdapter(deps.model ?? "sonnet");
  return runAgent(prompt, cb, { adapter, spawnFn: deps.spawnFn, cwd: deps.cwd });
}
