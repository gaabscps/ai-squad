import { readFileSync } from "node:fs";
import type { spawn as realSpawn } from "node:child_process";
import { runAgent, buildClaudeAdapter, type AgentHandle, type ModelAlias } from "../ai/run.js";
import { buildSpecSummaryPrompt } from "./prompt.js";

export interface SpecSummaryCallbacks {
  onChunk: (delta: string) => void;
  onDone: (fullText: string, costUsd: number | null, modelId: string | null) => void;
  onError: (message: string) => void;
}

export type SpecSummaryHandle = AgentHandle;

export interface SpecSummaryDeps {
  spawnFn?: typeof realSpawn;
  cwd?: string;
}

export interface RunSpecSummaryOptions {
  specPath: string;
  model: ModelAlias;
  projectId: string;
  specId: string;
  callbacks: SpecSummaryCallbacks;
  deps?: SpecSummaryDeps;
}

/** Lê spec.md do disco, monta o prompt e invoca o Claude via runAgent. */
export function runSpecSummary(opts: RunSpecSummaryOptions): SpecSummaryHandle {
  let content: string;
  try {
    content = readFileSync(opts.specPath, "utf-8");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    opts.callbacks.onError(message);
    return { cancel: () => {} };
  }
  const prompt = buildSpecSummaryPrompt(content);
  const adapter = buildClaudeAdapter(opts.model);
  return runAgent(prompt, opts.callbacks, { adapter, spawnFn: opts.deps?.spawnFn, cwd: opts.deps?.cwd });
}
